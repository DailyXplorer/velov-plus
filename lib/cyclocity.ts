// The parts of the Cyclocity client that need no server secret, kept free of "server-only" so tests can import them.
import { z } from "zod";
import { type AutoSpendResult, type Outcome, type ProfileBody, type RateBody, type Station, type Trip, type UnlockBody, stationTitle } from "./models.ts";
import { haversine } from "./geo.ts";
import { VelovError } from "./auth-protocol.ts";

export const API = "https://api.cyclocity.fr";
export const BASE = `${API}/contracts/lyon`;
// The bikes endpoint sits behind a WAF that answers non-browser user agents with an HTML 403.
export const BROWSER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
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

/** Cyclocity date-times are UTC without a zone designator; a date alone ("2026-03-02") stays a calendar date. */
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

/** Rates the bike of a trip, once: the caller asked for exactly one attempt. */
export async function postRating({ accountId, tripId, body, token, identity }: { accountId: string; tripId: string; body: RateBody; token: string; identity: string }, send: typeof fetch = fetch) {
  const response = await send(`${BASE}/accounts/${encodeURIComponent(accountId)}/trips/${encodeURIComponent(tripId)}/rate`, {
    method: "POST",
    headers: { Authorization: `Taknv1 ${token}`, Identity: identity, "Content-Type": "application/vnd.trip.v6+json", "User-Agent": BROWSER_AGENT },
    body: JSON.stringify({ bikeId: body.bikeNumber, recommended: body.recommended, contract: "lyon", rating: body.rating }),
    cache: "no-store", signal: AbortSignal.timeout(15_000)
  });
  if (response.status === 401) throw new VelovError("expired", "Votre session doit être renouvelée. Reconnectez-vous pour continuer.");
  if (!response.ok) throw new VelovError("unavailable", "Vélo’v n’a pas enregistré la note. Réessayez dans un instant.");
}

/** Release refusals the official app translates (§ 5.6), plus the booking clash it shows with its generic message. */
const releaseCodes: Record<string, string> = {
  "trips.exception.bookings.already.reserved": "Vélo réservé par un autre usager. Vélo’v renvoie parfois ce refus pour un vélo que vous avez vous-même réservé : essayez un autre vélo.",
  "trips.exception.invalid.customer.maxBikesRented": "Impossible de libérer le vélo, un autre trajet est en cours.",
  "kiwi.exception.customer.rent.time.limit": "Délai entre deux courses non écoulé.",
  "kiwi.exception.customer.insuffisant.right": "Abonnement hors validité.",
  "kiwi.exception.customer.paymentmode.not.valid": "Veuillez mettre à jour votre mode de paiement.",
  "kiwi.exception.no.release.bike": "Problème technique lors de la libération du vélo.",
  "trips.exception.invalid.customer.credit": "Crédit du compte insuffisant pour libérer un vélo."
};
const releaseStates: Record<string, string> = {
  ABORT: "La libération du vélo a été annulée.",
  NOK: "La libération du vélo a échoué.",
  TIME_OUT: "La borne n’a pas répondu à temps pour libérer le vélo.",
  NOT_CONNECTED: "Aucun vélo n’est connecté à la borne : borne non connectée."
};
const bookingCodes: Record<string, string> = {
  "booking.exception.bike.already.reserved": "Ce vélo est déjà réservé par un autre usager.",
  "bookings.exception.not.authorized": "Réservation refusée : un compte n’a qu’une réservation à la fois, et il faut 10 points."
};
const releaseFailed = "La libération du vélo a échoué pour une raison inconnue.";
const bookingFailed = "La réservation de votre vélo n’a pas fonctionné.";
const sessionRefused = "Vélo’v n’a pas reconnu votre session. Reconnectez-vous puis réessayez.";
const errorBody = z.object({ code: lenient(z.string()), message: lenient(z.string()), transactionState: lenient(z.string()) }).catch({ code: null, message: null, transactionState: null });

export const rawBooking = z.object({ id: z.string(), stationNumber: z.number(), standNumber: lenient(z.number()), bikeId: lenient(z.string()), endTime: lenient(z.string()) });

export function refusal(code: string, message: string): Outcome {
  return { ok: false, httpStatus: 0, transactionState: null, code, message, detail: null };
}

async function answer(response: Response) {
  const text = await response.text().catch(() => "");
  let value: unknown = null;
  try { value = JSON.parse(text); } catch { /* A gateway error page is not JSON. */ }
  const body = errorBody.parse(value);
  return { value, code: body.code ?? response.headers.get("Bloot-Error-Code"), detail: body.message ?? (value === null && text ? text.slice(0, 160) : null), transactionState: body.transactionState ?? null };
}

/** Success is transactionState OK, never the HTTP status alone. */
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

/** Releases a bike, exactly once: the borne may already have opened, so a lost answer must never be retried. */
export async function postRelease({ accountId, subscriptionId, body, token, identity }: { accountId: string; subscriptionId: string; body: UnlockBody; token: string; identity: string }, send: typeof fetch = fetch): Promise<Outcome> {
  let response: Response;
  try {
    response = await send(`${BASE}/accounts/${encodeURIComponent(accountId)}/subscriptions/${encodeURIComponent(subscriptionId)}/trips`, {
      method: "POST",
      headers: { Authorization: `Taknv1 ${token}`, Identity: identity, "Content-Type": "application/vnd.trip.v6+json", Accept: "application/vnd.trip.v6+json", "Accept-Language": "fr", "User-Agent": BROWSER_AGENT },
      body: JSON.stringify({ stationNumber: body.stationNumber, standNumber: body.standNumber, bikeNumber: body.bikeNumber, typeFrom: "SMARTPHONE" }),
      cache: "no-store", signal: AbortSignal.timeout(30_000)
    });
  } catch (error) {
    return { ...refusal("network", "Vélo’v n’a pas répondu. Le vélo a peut-être été libéré : regardez la borne avant de réessayer."), detail: error instanceof Error ? error.name : null };
  }
  if (response.status === 401) throw new VelovError("expired", "Votre session doit être renouvelée. Reconnectez-vous pour continuer.");
  return releaseOutcome(response.status, await answer(response));
}

export type CreateBooking = { stationId: string; stationNumber: number; standNumber: number; subscriptionId: string; bikeId: string };

/** Books a bike, exactly once: it costs points, and a lost answer may hide a booking that went through. */
export async function postBooking({ accountId, body, token, identity }: { accountId: string; body: CreateBooking; token: string; identity: string }, send: typeof fetch = fetch): Promise<{ outcome: Outcome; booking: z.infer<typeof rawBooking> | null }> {
  let response: Response;
  try {
    response = await send(`${BASE}/accounts/${encodeURIComponent(accountId)}/bookings`, {
      method: "POST",
      headers: { Authorization: `Taknv1 ${token}`, Identity: identity, "Content-Type": "application/json; charset=UTF-8", "User-Agent": BROWSER_AGENT },
      // Field order of the app's CreateBooking constructor.
      body: JSON.stringify({ stationId: body.stationId, stationNumber: body.stationNumber, standNumber: body.standNumber, subscriptionId: body.subscriptionId, bikeId: body.bikeId }),
      cache: "no-store", signal: AbortSignal.timeout(30_000)
    });
  } catch (error) {
    return { outcome: { ...refusal("network", "Vélo’v n’a pas répondu. La réservation est peut-être passée : actualisez avant de réessayer."), detail: error instanceof Error ? error.name : null }, booking: null };
  }
  if (response.status === 401) throw new VelovError("expired", "Votre session doit être renouvelée. Reconnectez-vous pour continuer.");
  const reply = await answer(response);
  const outcome = bookingOutcome(response.status, reply);
  const booking = rawBooking.safeParse(reply.value);
  return { outcome, booking: outcome.ok && booking.success ? booking.data : null };
}

type Auth = { accountId: string; token: string; identity: string };
const accountCodes: Record<string, string> = {
  "accounts.exception.validation.failed": "Vélo’v a refusé ces coordonnées : vérifiez le numéro de téléphone et l’adresse.",
  "accounts.exception.notacceptable.account.phone.invalid": "Ce numéro de téléphone n’est pas valide."
};

/** One call that changes the account, exactly once: whatever happens, it is never sent again without a new confirmation. */
async function accountCall(url: string, init: { method: "POST" | "PATCH" | "DELETE"; headers: Record<string, string>; body?: string }, auth: Auth, failed: string, send: typeof fetch) {
  let response: Response;
  try {
    response = await send(url, { ...init, headers: { Authorization: `Taknv1 ${auth.token}`, Identity: auth.identity, ...init.headers, "User-Agent": BROWSER_AGENT }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    return { outcome: { ...refusal("network", "Vélo’v n’a pas répondu. La modification est peut-être passée : actualisez avant de réessayer."), detail: error instanceof Error ? error.name : null }, value: null };
  }
  if (response.status === 401) throw new VelovError("expired", "Votre session doit être renouvelée. Reconnectez-vous pour continuer.");
  const reply = await answer(response);
  const outcome: Outcome = { ok: response.ok, httpStatus: response.status, transactionState: null, code: reply.code, message: response.ok ? null : reply.code && accountCodes[reply.code] ? accountCodes[reply.code] : response.status === 403 ? sessionRefused : failed, detail: reply.detail };
  return { outcome, value: response.ok ? reply.value : null };
}

const accountUrl = (accountId: string) => `${BASE}/accounts/${encodeURIComponent(accountId)}`;

/** PATCH /rewards with the app's UpdateReward body; Vélo’v answers the whole rewards object. */
export async function patchAutoSpend({ autoSpend, ...auth }: Auth & { autoSpend: boolean }, send: typeof fetch = fetch): Promise<AutoSpendResult> {
  const { outcome, value } = await accountCall(`${accountUrl(auth.accountId)}/rewards`, { method: "PATCH", headers: { "Content-Type": "application/vnd.rewards.v5+json" }, body: JSON.stringify({ autoSpend }) }, auth, "Vélo’v n’a pas enregistré ce réglage.", send);
  const answered = z.object({ autoSpend: z.boolean() }).safeParse(value);
  return { ...outcome, autoSpend: answered.success ? answered.data.autoSpend : outcome.ok ? autoSpend : null };
}

/** Adds (POST) or removes (DELETE) a favourite station, with the app's trailing slash and Accept. */
export async function putStationBookmark({ stationNumber, on, ...auth }: Auth & { stationNumber: number; on: boolean }, send: typeof fetch = fetch): Promise<Outcome> {
  const { outcome } = await accountCall(`${accountUrl(auth.accountId)}/stationbookmarks/${stationNumber}/`, { method: on ? "POST" : "DELETE", headers: { Accept: "application/vnd.account.v4+json" } }, auth, on ? "Vélo’v n’a pas ajouté cette station aux favoris." : "Vélo’v n’a pas retiré cette station des favoris.", send);
  return outcome;
}

const report = z.object({ filename: lenient(z.string()), translations: z.object({ content: z.string().min(1) }) });

/** The receipt of one subscription period: a POST without body that only reads, answered as base64 under Accept: application/json. */
export async function postPeriodReport({ subscriptionId, periodId, ...auth }: Auth & { subscriptionId: string; periodId: string }, send: typeof fetch = fetch): Promise<{ outcome: Outcome; pdf: { filename: string; bytes: Buffer } | null }> {
  const { outcome, value } = await accountCall(`${accountUrl(auth.accountId)}/subscriptions/${encodeURIComponent(subscriptionId)}/periods/${encodeURIComponent(periodId)}/reports`, { method: "POST", headers: { Accept: "application/json" } }, auth, "Vélo’v n’a pas fourni ce reçu.", send);
  if (!outcome.ok) return { outcome, pdf: null };
  const parsed = report.safeParse(value);
  const bytes = parsed.success ? Buffer.from(parsed.data.translations.content, "base64") : null;
  if (!parsed.success || !bytes || bytes.subarray(0, 5).toString("latin1") !== "%PDF-") return { outcome: { ...outcome, ok: false, code: "local.receipt.unreadable", message: "Le reçu renvoyé par Vélo’v est illisible." }, pdf: null };
  return { outcome, pdf: { filename: parsed.data.filename?.replace(/[^\w.-]/g, "") || `recu-${periodId}.pdf`, bytes } };
}

/** PATCH /accounts/{id} with only the changed fields, in the order of the body the app sends. */
export async function patchProfile({ body, ...auth }: Auth & { body: ProfileBody }, send: typeof fetch = fetch): Promise<Outcome> {
  const ordered = { country: body.country, zipCode: body.zipCode, city: body.city, phoneNumber: body.phoneNumber, address: body.address };
  const { outcome } = await accountCall(accountUrl(auth.accountId), { method: "PATCH", headers: { "Content-Type": "application/vnd.account.v4+json" }, body: JSON.stringify(ordered) }, auth, "Vélo’v n’a pas enregistré ces coordonnées.", send);
  return outcome;
}
