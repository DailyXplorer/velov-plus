import { AUTO_RENEWAL_FIELD, SUBSCRIPTION_MEDIA_TYPE } from "./guesses.ts";
import { z } from "zod";
import { VIA_MEDIA_TYPE, VIA_STATION_FIELD, VIA_SUCCESS_STATE, VIA_STATE_FIELD } from "./guesses.ts";
import { type AutoSpendResult, type Outcome, type ProfileBody, type RateBody, type Station, type Trip, type UnlockBody, stationTitle } from "./models.ts";
import { haversine } from "./geo.ts";
import { VelovError } from "./auth-protocol.ts";

export const API = "https://api.cyclocity.fr";
export const BASE = `${API}/contracts/lyon`;
export const BROWSER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
export const ACTION_TIMEOUT_MS = 30_000;
export const lenient = <T extends z.ZodType>(schema: T) => schema.nullish().catch(null);

const scalar = z.union([z.number(), z.string()]).nullish();
const date = z.string().nullish();
export const rawTrip = z.object({
  id: z.string(), status: z.string().optional(), startDateTime: date, endDateTime: date,
  startStation: scalar, endStation: scalar, startStationName: date, endStationName: date,
  startStand: lenient(z.number()), endStand: lenient(z.number()),
  bikeNumber: z.number().nullish(), bikeType: z.number().nullish(), duration: z.number().nullish(),
  price: lenient(z.number()), discount: lenient(z.number()), reducedPrice: lenient(z.number()),
  rewardsEarned: lenient(z.number()), rewardsSpent: lenient(z.number()),
  litigious: lenient(z.boolean()), isRated: lenient(z.boolean()), token: lenient(z.string()), origin: lenient(z.number())
});

export function utcDate(value: string | null | undefined) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const day = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(day.getTime()) && day.toISOString().startsWith(value) ? value : null;
  }
  const date = new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function stationNumber(value: string | number | null | undefined) {
  const number = Number(value);
  return value != null && String(value).trim() !== "" && Number.isSafeInteger(number) ? number : null;
}

export function normalizeTrip(value: z.infer<typeof rawTrip>, stations: Map<number, Station>): Trip {
  const start = stationNumber(value.startStation);
  const end = stationNumber(value.endStation);
  const station = (name: string | null | undefined, number: number | null, raw: unknown) => name?.trim() ? stationTitle(name) : number != null ? stations.get(number)?.name ?? `Station ${number}` : raw != null && String(raw).trim() ? `Station ${String(raw).trim()}` : null;
  const from = start != null ? stations.get(start) : undefined;
  const to = end != null ? stations.get(end) : undefined;
  return {
    id: value.id, status: value.status ?? "FINISHED", startedAt: utcDate(value.startDateTime), endedAt: utcDate(value.endDateTime),
    startStation: station(value.startStationName, start, value.startStation), endStation: station(value.endStationName, end, value.endStation),
    startStationNumber: start, endStationNumber: end, startStand: value.startStand ?? null, endStand: value.endStand ?? null,
    distance: from && to && start !== end ? Math.round(haversine(from, to)) : null,
    bikeNumber: value.bikeNumber ?? null, bikeType: value.bikeType === 1 ? "electrical" : value.bikeType === 0 ? "mechanical" : "unknown",
    duration: value.duration ?? null, price: value.reducedPrice ?? (value.price != null ? value.price - (value.discount ?? 0) : null),
    fullPrice: value.price ?? null, discount: value.discount ?? 0,
    pointsEarned: value.rewardsEarned ?? 0, pointsSpent: value.rewardsSpent ?? 0,
    litigious: value.litigious === true, isRated: value.isRated ?? null, token: value.token ?? null, origin: value.origin ?? null
  };
}

export async function postRating({ accountId, tripId, body, token, identity }: { accountId: string; tripId: string; body: RateBody; token: string; identity: string }, send: typeof fetch = fetch) {
  const response = await send(`${BASE}/accounts/${encodeURIComponent(accountId)}/trips/${encodeURIComponent(tripId)}/rate`, {
    method: "POST",
    headers: { Authorization: `Taknv1 ${token}`, Identity: identity, "Content-Type": "application/vnd.trip.v6+json", "User-Agent": BROWSER_AGENT },
    body: JSON.stringify({ bikeId: body.bikeNumber, recommended: body.recommended, contract: "lyon", rating: body.rating }),
    cache: "no-store", signal: AbortSignal.timeout(15_000)
  });
  if (response.status === 401) throw new VelovError("expired", "Votre session a expiré. Reconnectez-vous.");
  if (!response.ok) throw new VelovError("unavailable", "Vélo’v n’a pas confirmé la note.");
}

const releaseCodes: Record<string, string> = {
  "trips.exception.bookings.already.reserved": "Vélo réservé par un autre usager. Choisissez-en un autre.",
  "trips.exception.invalid.customer.maxBikesRented": "Impossible de libérer le vélo, un autre trajet est en cours.",
  "kiwi.exception.customer.rent.time.limit": "Délai entre deux courses non écoulé.",
  "kiwi.exception.customer.insuffisant.right": "Abonnement hors validité.",
  "kiwi.exception.customer.paymentmode.not.valid": "Veuillez mettre à jour votre mode de paiement.",
  "kiwi.exception.no.release.bike": "Problème technique lors de la libération du vélo.",
  "trips.exception.invalid.customer.credit": "Crédit du compte insuffisant pour libérer un vélo."
};
const releaseStates: Record<string, string> = {
  ABORT: "Le déverrouillage a été annulé.",
  NOK: "Le vélo n’a pas pu être déverrouillé.",
  TIME_OUT: "La borne n’a pas répondu à temps.",
  NOT_CONNECTED: "Aucun vélo n’est accroché à cette borne."
};
const bookingCodes: Record<string, string> = {
  "booking.exception.bike.already.reserved": "Ce vélo est déjà réservé par un autre usager.",
  "bookings.exception.not.authorized": "Vous avez déjà une réservation en cours, ou moins de 10 points."
};
const releaseFailed = "Le déverrouillage n’a pas abouti.";
const bookingFailed = "La réservation de votre vélo n’a pas fonctionné.";
const sessionRefused = "Votre session n’est plus valide. Reconnectez-vous.";
const errorBody = z.object({ code: lenient(z.string()), message: lenient(z.string()), transactionState: lenient(z.string()) }).catch({ code: null, message: null, transactionState: null });

export const rawBooking = z.object({ id: z.string(), stationNumber: z.number(), standNumber: lenient(z.number()), bikeId: lenient(z.string()), endTime: lenient(z.string()) });

export function refusal(code: string, message: string): Outcome {
  return { ok: false, httpStatus: 0, transactionState: null, code, message, detail: null };
}

async function answer(response: Response) {
  const text = await response.text().catch(() => "");
  let value: unknown = null;
  try { value = JSON.parse(text); } catch {}
  const body = errorBody.parse(value);
  return { value, code: body.code ?? response.headers.get("Bloot-Error-Code"), detail: body.message ?? (value === null && text ? text.slice(0, 160) : null), transactionState: body.transactionState ?? null };
}

export function releaseOutcome(httpStatus: number, reply: { code: string | null; detail: string | null; transactionState: string | null }): Outcome {
  const { code, detail, transactionState } = reply;
  const ok = httpStatus === 200 && transactionState === "OK";
  const message = ok ? null : code && releaseCodes[code] ? releaseCodes[code] : transactionState && releaseStates[transactionState] ? releaseStates[transactionState] : httpStatus === 403 ? sessionRefused : releaseFailed;
  return { ok, httpStatus, transactionState, code, message, detail };
}

export function bookingOutcome(httpStatus: number, reply: { code: string | null; detail: string | null }): Outcome {
  const ok = httpStatus >= 200 && httpStatus < 300;
  const message = ok ? null : reply.code && bookingCodes[reply.code] ? bookingCodes[reply.code] : httpStatus === 403 ? sessionRefused : bookingFailed;
  return { ok, httpStatus, transactionState: null, code: reply.code, message, detail: reply.detail };
}

export async function postRelease({ accountId, subscriptionId, body, token, identity }: { accountId: string; subscriptionId: string; body: UnlockBody; token: string; identity: string }, send: typeof fetch = fetch): Promise<Outcome> {
  let response: Response;
  try {
    response = await send(`${BASE}/accounts/${encodeURIComponent(accountId)}/subscriptions/${encodeURIComponent(subscriptionId)}/trips`, {
      method: "POST",
      headers: { Authorization: `Taknv1 ${token}`, Identity: identity, "Content-Type": "application/vnd.trip.v6+json", Accept: "application/vnd.trip.v6+json", "Accept-Language": "fr", "User-Agent": BROWSER_AGENT },
      body: JSON.stringify({ stationNumber: body.stationNumber, standNumber: body.standNumber, bikeNumber: body.bikeNumber, typeFrom: "SMARTPHONE" }),
      cache: "no-store", signal: AbortSignal.timeout(ACTION_TIMEOUT_MS)
    });
  } catch (error) {
    return { ...refusal("network", "Vélo’v ne répond pas. Le vélo est peut-être déverrouillé : regardez la borne avant de réessayer."), detail: error instanceof Error ? error.name : null };
  }
  if (response.status === 401) throw new VelovError("expired", "Votre session a expiré. Reconnectez-vous.");
  return releaseOutcome(response.status, await answer(response));
}

export type CreateBooking = { stationId: string; stationNumber: number; standNumber: number; subscriptionId: string; bikeId: string };

export async function postBooking({ accountId, body, token, identity }: { accountId: string; body: CreateBooking; token: string; identity: string }, send: typeof fetch = fetch): Promise<{ outcome: Outcome; booking: z.infer<typeof rawBooking> | null }> {
  let response: Response;
  try {
    response = await send(`${BASE}/accounts/${encodeURIComponent(accountId)}/bookings`, {
      method: "POST",
      headers: { Authorization: `Taknv1 ${token}`, Identity: identity, "Content-Type": "application/json; charset=UTF-8", "User-Agent": BROWSER_AGENT },
      body: JSON.stringify({ stationId: body.stationId, stationNumber: body.stationNumber, standNumber: body.standNumber, subscriptionId: body.subscriptionId, bikeId: body.bikeId }),
      cache: "no-store", signal: AbortSignal.timeout(ACTION_TIMEOUT_MS)
    });
  } catch (error) {
    return { outcome: { ...refusal("network", "Vélo’v ne répond pas. Le vélo est peut-être réservé : actualisez la page avant de réessayer."), detail: error instanceof Error ? error.name : null }, booking: null };
  }
  if (response.status === 401) throw new VelovError("expired", "Votre session a expiré. Reconnectez-vous.");
  const reply = await answer(response);
  const outcome = bookingOutcome(response.status, reply);
  const booking = rawBooking.safeParse(reply.value);
  return { outcome, booking: outcome.ok && booking.success ? booking.data : null };
}

export type Auth = { accountId: string; token: string; identity: string };
const accountCodes: Record<string, string> = {
  "accounts.exception.validation.failed": "Vélo’v a refusé ces coordonnées : vérifiez le numéro de téléphone et l’adresse.",
  "accounts.exception.notacceptable.account.phone.invalid": "Ce numéro de téléphone n’est pas valide."
};

export async function accountCall(url: string, init: { method: "POST" | "PATCH" | "DELETE"; headers: Record<string, string>; body?: BodyInit }, auth: Auth, failed: string, send: typeof fetch, preserveUnauthorized = false) {
  let response: Response;
  try {
    response = await send(url, { ...init, headers: { Authorization: `Taknv1 ${auth.token}`, Identity: auth.identity, ...init.headers, "User-Agent": BROWSER_AGENT }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    return { outcome: { ...refusal("network", "Vélo’v ne répond pas. La modification a peut-être été prise en compte : actualisez la page avant de réessayer."), detail: error instanceof Error ? error.name : null }, value: null };
  }
  if (response.status === 401 && !preserveUnauthorized) throw new VelovError("expired", "Votre session a expiré. Reconnectez-vous.");
  const reply = await answer(response);
  const outcome: Outcome = { ok: response.ok, httpStatus: response.status, transactionState: null, code: reply.code, message: response.ok ? null : reply.code && accountCodes[reply.code] ? accountCodes[reply.code] : response.status === 403 ? sessionRefused : failed, detail: reply.detail };
  return { outcome, value: response.ok ? reply.value : null };
}

const accountUrl = (accountId: string) => `${BASE}/accounts/${encodeURIComponent(accountId)}`;

export async function patchAutoSpend({ autoSpend, ...auth }: Auth & { autoSpend: boolean }, send: typeof fetch = fetch): Promise<AutoSpendResult> {
  const { outcome, value } = await accountCall(`${accountUrl(auth.accountId)}/rewards`, { method: "PATCH", headers: { "Content-Type": "application/vnd.rewards.v5+json" }, body: JSON.stringify({ autoSpend }) }, auth, "Vélo’v n’a pas enregistré ce réglage.", send);
  const answered = z.object({ autoSpend: z.boolean() }).safeParse(value);
  return { ...outcome, autoSpend: answered.success ? answered.data.autoSpend : outcome.ok ? autoSpend : null };
}

export async function putStationBookmark({ stationNumber, on, ...auth }: Auth & { stationNumber: number; on: boolean }, send: typeof fetch = fetch): Promise<Outcome> {
  const { outcome } = await accountCall(`${accountUrl(auth.accountId)}/stationbookmarks/${stationNumber}/`, { method: on ? "POST" : "DELETE", headers: { Accept: "application/vnd.account.v4+json" } }, auth, on ? "Vélo’v n’a pas ajouté cette station aux favoris." : "Vélo’v n’a pas retiré cette station des favoris.", send);
  return outcome;
}

const report = z.object({ filename: lenient(z.string()), translations: z.object({ content: z.string().min(1) }) });

export async function postPeriodReport({ subscriptionId, periodId, ...auth }: Auth & { subscriptionId: string; periodId: string }, send: typeof fetch = fetch): Promise<{ outcome: Outcome; pdf: { filename: string; bytes: Buffer } | null }> {
  const { outcome, value } = await accountCall(`${accountUrl(auth.accountId)}/subscriptions/${encodeURIComponent(subscriptionId)}/periods/${encodeURIComponent(periodId)}/reports`, { method: "POST", headers: { Accept: "application/json" } }, auth, "Ce reçu n’est pas disponible.", send);
  if (!outcome.ok) return { outcome, pdf: null };
  const parsed = report.safeParse(value);
  const bytes = parsed.success ? Buffer.from(parsed.data.translations.content, "base64") : null;
  if (!parsed.success || !bytes || bytes.subarray(0, 5).toString("latin1") !== "%PDF-") return { outcome: { ...outcome, ok: false, code: "local.receipt.unreadable", message: "Ce reçu ne peut pas être ouvert." }, pdf: null };
  return { outcome, pdf: { filename: parsed.data.filename?.replace(/[^\w.-]/g, "") || `recu-${periodId}.pdf`, bytes } };
}

export async function patchProfile({ body, ...auth }: Auth & { body: ProfileBody }, send: typeof fetch = fetch): Promise<Outcome> {
  const ordered = { firstName: body.firstName, lastName: body.lastName, country: body.country, zipCode: body.zipCode, city: body.city, phoneNumber: body.phoneNumber, address: body.address };
  const { outcome } = await accountCall(accountUrl(auth.accountId), { method: "PATCH", headers: { "Content-Type": "application/vnd.account.v4+json" }, body: JSON.stringify(ordered) }, auth, "Vélo’v n’a pas enregistré ces coordonnées.", send);
  const renamed = body.firstName !== undefined || body.lastName !== undefined;
  return renamed && outcome.httpStatus >= 400 && outcome.httpStatus < 500 ? { ...outcome, message: "Vélo’v n’a pas accepté ce changement de nom." } : outcome;
}


export async function patchAutoRenewal({ subscriptionId, autoRenewal, ...auth }: Auth & { subscriptionId: string; autoRenewal: boolean }, send: typeof fetch = fetch): Promise<Outcome> {
  const { outcome } = await accountCall(`${accountUrl(auth.accountId)}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: "PATCH", headers: { "Content-Type": SUBSCRIPTION_MEDIA_TYPE }, body: JSON.stringify({ [AUTO_RENEWAL_FIELD]: autoRenewal })
  }, auth, "Vélo’v n’a pas enregistré le renouvellement automatique.", send, true);
  return outcome;
}

export async function postVia({ subscriptionId, stationId, ...auth }: Auth & { subscriptionId: string; stationId: string | number }, send: typeof fetch = fetch): Promise<Outcome> {
  const { outcome, value } = await accountCall(`${accountUrl(auth.accountId)}/subscriptions/${encodeURIComponent(subscriptionId)}/via`, {
    method: "POST", headers: { "Content-Type": VIA_MEDIA_TYPE }, body: JSON.stringify({ [VIA_STATION_FIELD]: stationId })
  }, auth, "Les 15 minutes supplémentaires n’ont pas été accordées.", send, true);
  if (!outcome.ok) return outcome;
  const parsed = z.union([z.string(), z.object({ [VIA_STATE_FIELD]: z.string() }).transform((reply) => reply[VIA_STATE_FIELD])]).safeParse(value);
  const transactionState = parsed.success ? parsed.data : null;
  const ok = transactionState === VIA_SUCCESS_STATE;
  return { ...outcome, ok, transactionState, message: ok ? null : "Vélo’v n’a pas confirmé les minutes supplémentaires. Vérifiez votre trajet avant de réessayer." };
}
