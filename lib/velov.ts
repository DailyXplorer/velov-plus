import { completeRenewalChange, renewalStateOf, type AutoRenewalBody } from "./renewal-models";

import { postContactMail } from "./contact-mail";
import "server-only";
import { postVia } from "./cyclocity";
import { VIA_STATION_IDENTIFIER, VIA_MEDIA_TYPE } from "./guesses";
import type { ViaBody } from "./via-models";

import { postPromoCode } from "./promo";
import { PROMOCODE_ACCEPT, PROMOCODE_REWARD } from "./guesses";
import { z } from "zod";
import { type AutoSpendResult, type BookBody, type BookResult, type Bike, type Booking, type Dashboard, type Outcome, type ProfileBody, type RateBody, type Receipt, type Station, type UnlockBody, type UnlockResult, dashboardSchema } from "./models";
import { API, BASE, BROWSER_AGENT, bookingRows, lenient, normalizeTrip, patchAutoRenewal, patchAutoSpend, patchProfile, postBooking, postPeriodReport, postRating, postRelease, putStationBookmark, rawBooking, rawTrip, refusal, utcDate } from "./cyclocity";
import { VelovError } from "./auth-protocol";
import { memo } from "./memo";
import { type TripCheck, latestFinished } from "./trip-end";
import { buildStats, collectPages, statsTtl, type Stats } from "./stats";
import { type RewardsHistory, historySince, signedAmount } from "./operations";
import { appToken, fetchTransient, getStations, getWithAppToken } from "./upstream";
import { type Session, beforeSend } from "./session";

const date = z.string().nullish();
const text = lenient(z.string());
const bookmark = z.union([z.number(), z.string(), z.object({ number: z.union([z.number(), z.string()]) }).transform((value) => value.number), z.object({ stationNumber: z.union([z.number(), z.string()]) }).transform((value) => value.stationNumber)]).catch(0);
const rawProfile = z.object({ firstName: z.string().nullish(), lastName: z.string().nullish(), email: z.string(), isLocked: z.boolean().optional(), completion: z.number().optional(), phoneNumber: text, address: lenient(z.object({ name: text, complement: text })), zipCode: text, city: text, country: text, stations: lenient(z.array(bookmark)) });
const rawRewards = z.object({ balance: z.number(), total: z.number().optional(), autoSpend: z.boolean().optional() });
const rawMovement = z.object({ id: z.string(), createdAt: date, direction: z.string().optional(), amount: z.number(), reason: z.string().optional() });
const rawPeriod = z.object({ id: lenient(z.string()), offerId: z.number().optional(), validityStart: date, validityEnd: date, renewalDetails: lenient(z.object({ autoRenewalValue: lenient(z.boolean()), autoRenewalBtn: lenient(z.boolean()) })) });
const rawSubscription = z.object({ id: z.string().optional(), type: z.string(), isLocked: z.boolean().optional(), periods: z.array(rawPeriod).optional() });
const offerSchema = z.object({ id: z.number(), title: z.string() });
const ruleSchema = z.object({ name: z.string(), enable: z.boolean(), reward: z.number(), type: z.string() });
const rawBike = z.object({ id: lenient(z.string()), number: z.number(), type: lenient(z.string()), frameId: lenient(z.string()), standNumber: lenient(z.number()), status: lenient(z.string()), statusLabel: lenient(z.string()), isReserved: lenient(z.boolean()), rating: lenient(z.object({ value: lenient(z.number()), count: lenient(z.number()), lastRatingDateTime: lenient(z.string()) })), battery: lenient(z.object({ percentage: lenient(z.number()) })), lastTripDateTime: lenient(z.string()), lastControlDateTime: lenient(z.string()), nextCheck: lenient(z.string()), nextReview: lenient(z.string()), lastDataFrameDate: lenient(z.string()) });

const publicToken = appToken(async () => {
  const response = await fetchTransient(`${API}/auth/environments/PRD/client_tokens`, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": BROWSER_AGENT }, body: JSON.stringify({ code: "vls.web.lyon:PRD", key: "c3d9f5c22a9157a7cc7fe0e38269573bdd2f13ec48f867360ecdcbd35b196f87" }), cache: "no-store" });
  if (!response.ok) throw new VelovError("unavailable", "Vélo’v ne répond pas pour le moment.");
  const value: unknown = await response.json();
  return z.object({ accessToken: z.string() }).parse(value).accessToken;
});

async function read<T>(path: string, schema: z.ZodType<T>, session: Session, accept = "application/json"): Promise<T> {
  const response = await getWithAppToken(publicToken, `${BASE}${path}`, (token) => ({ Authorization: `Taknv1 ${token}`, Identity: session.accessToken, Accept: accept, "User-Agent": BROWSER_AGENT }));
  if (response.status === 401) throw new VelovError("expired", "Votre session a expiré. Reconnectez-vous.");
  if (!response.ok) throw new VelovError("unavailable", "Certaines informations Vélo’v ne sont pas disponibles pour le moment.");
  const value: unknown = await response.json();
  return schema.parse(value);
}

const reasons: Record<string, string> = { RATE_BIKE: "Vélo évalué", START_STATION_FULL: "Départ d’une station pleine", END_STATION_EMPTY: "Arrivée dans une station vide", TRIP_BONUS: "Bonus de trajet", START_TRIP_OVERFLOW: "Départ en station virtuelle", REDUCTION: "Réduction sur un trajet", BIKE_BOOKING: "Réservation d’un vélo", PROMOCODE: "Invitation d’un proche" };

function normalizeBike(value: z.infer<typeof rawBike>): Bike {
  const type = value.type === "ELECTRICAL" ? "electrical" : value.type === "MECHANICAL" ? "mechanical" : "other";
  const percent = value.battery?.percentage;
  const rating = value.rating?.value != null && value.rating.count ? { value: Math.round(value.rating.value * 10) / 10, count: value.rating.count, lastAt: utcDate(value.rating.lastRatingDateTime) } : null;
  return { number: value.number, type, standNumber: value.standNumber ?? null, status: value.status ?? null, statusLabel: value.statusLabel ?? null, isReserved: value.isReserved ?? false, rating, batteryPercent: type === "electrical" && percent != null ? Math.min(100, Math.max(0, Math.round(percent))) : null, frameId: value.frameId && value.frameId !== "0" ? value.frameId : null, lastTripAt: utcDate(value.lastTripDateTime), lastControlAt: utcDate(value.lastControlDateTime), nextCheckAt: utcDate(value.nextCheck), lastSignalAt: utcDate(value.lastDataFrameDate), nextReviewAt: utcDate(value.nextReview) };
}

async function getRawBikes(query: string, unavailable: string): Promise<z.infer<typeof rawBike>[]> {
  const response = await getWithAppToken(publicToken, `${BASE}/bikes?${query}`, (token) => ({ Authorization: `Taknv1 ${token}`, Accept: "application/vnd.bikes.v4+json", "User-Agent": BROWSER_AGENT }));
  if (!response.ok) throw new VelovError("unavailable", unavailable);
  const value: unknown = await response.json();
  return z.array(z.unknown()).parse(value).flatMap((item) => { const bike = rawBike.safeParse(item); return bike.success ? [bike.data] : []; });
}

async function getBikes(query: string, unavailable: string): Promise<Bike[]> {
  return (await getRawBikes(query, unavailable)).map(normalizeBike);
}

const stationBikes = memo<Bike[]>(15_000);
export function getStationBikes(station: number): Promise<Bike[]> {
  return stationBikes(String(station), async () => (await getBikes(`stationNumber=${station}`, "Les vélos de cette station sont momentanément indisponibles."))
    .sort((left, right) => (left.standNumber ?? Infinity) - (right.standNumber ?? Infinity) || left.number - right.number));
}

export async function getBike(number: number): Promise<Bike | null> {
  return (await getBikes(`number=${number}`, "Ce vélo est momentanément indisponible.")).find((bike) => bike.number === number) ?? null;
}

export { getStations };

const accountIds = memo<string>(10 * 60_000);
function accountIdOf(session: Session) {
  return accountIds(session.email, () => read(`/accounts/${encodeURIComponent(session.email)}/id`, z.string().uuid(), session));
}

const offers = memo<z.infer<typeof offerSchema>[]>(10 * 60_000);
const rules = memo<z.infer<typeof ruleSchema>[]>(10 * 60_000);

async function currentSubscriptionId(account: string, session: Session) {
  const subscriptions = await read(`${account}/subscriptions?periods=CURRENT&typeList=ST&typeList=LT&isLocked=false`, z.array(rawSubscription), session, "application/vnd.subscription.v6+json");
  return subscriptions.find((subscription) => subscription.id && !subscription.isLocked && (subscription.periods?.length ?? 0) > 0)?.id ?? null;
}

const noSubscription = () => refusal("local.no.subscription", "Aucun abonnement valide : achetez un ticket ou un abonnement dans l’app Vélo’v.");

async function stationsByNumber() {
  try { return new Map((await getStations()).stations.map((station) => [station.number, station])); }
  catch { return new Map<number, Station>(); }
}

function toBooking(value: z.infer<typeof rawBooking>, stations: Map<number, Station>, bikeNumbers: Map<string, number>): Booking {
  const station = stations.get(value.stationNumber);
  return {
    id: value.id, stationNumber: value.stationNumber, stationName: station?.name ?? `Station ${value.stationNumber}`, standNumber: value.standNumber ?? null,
    bikeNumber: value.bikeId ? bikeNumbers.get(value.bikeId) ?? null : null, endsAt: utcDate(value.endTime), lat: station?.lat ?? null, lon: station?.lon ?? null
  };
}

export async function getBookings(session: Session): Promise<Booking[]> {
  const accountId = await accountIdOf(session);
  const bookings = bookingRows(await read(`/accounts/${accountId}/bookings`, z.unknown(), session, "*/*"));
  if (!bookings.length) return [];
  const numbers = [...new Set(bookings.map((booking) => booking.stationNumber))];
  const [stations, ...bikes] = await Promise.all([stationsByNumber(), ...numbers.map((number) => getRawBikes(`stationNumber=${number}`, "").catch(() => []))]);
  const bikeNumbers = new Map(bikes.flat().flatMap((bike) => bike.id ? [[bike.id, bike.number] as const] : []));
  return bookings.map((booking) => toBooking(booking, stations, bikeNumbers));
}

export async function bookBike(session: Session, body: BookBody): Promise<BookResult> {
  const { accountId, token, subscriptionId, station, bikes } = await beforeSend(async () => {
    const accountId = await accountIdOf(session);
    const [subscriptionId, station, bikes, token] = await Promise.all([
      currentSubscriptionId(`/accounts/${accountId}`, session),
      getWithAppToken(publicToken, `${BASE}/stations/${body.stationNumber}`, (token) => ({ Authorization: `Taknv1 ${token}`, Accept: "application/vnd.station.v4+json", "User-Agent": BROWSER_AGENT }))
        .then(async (response) => response.ok ? z.object({ id: z.string() }).safeParse(await response.json()).data?.id ?? null : null),
      getRawBikes(`stationNumber=${body.stationNumber}`, "Les vélos de cette station sont momentanément indisponibles."),
      publicToken.get()
    ]);
    return { accountId, token, subscriptionId, station, bikes };
  });
  const stop = (outcome: ReturnType<typeof refusal>): BookResult => ({ ...outcome, booking: null });
  const bike = bikes.find((item) => item.number === body.bikeNumber);
  if (!subscriptionId) return stop(noSubscription());
  if (!bike || bike.status !== "AVAILABLE") return stop(refusal("local.bike.gone", "Ce vélo n’est plus disponible à cette station."));
  if (bike.isReserved) return stop(refusal("local.bike.reserved", "Ce vélo est déjà réservé."));
  if (bike.standNumber == null) return stop(refusal("local.bike.no.stand", "Ce vélo n’est pas accroché à une borne : il ne peut pas être réservé."));
  if (!bike.id || !station) return stop(refusal("local.missing.id", "Ce vélo ne peut pas être réservé pour le moment. Réessayez dans un instant."));
  const { outcome, booking } = await postBooking({ accountId, token, identity: session.accessToken, body: { stationId: station, stationNumber: body.stationNumber, standNumber: bike.standNumber, subscriptionId, bikeId: bike.id } });
  return { ...outcome, booking: booking ? toBooking(booking, await stationsByNumber(), new Map([[bike.id, bike.number]])) : null };
}

export async function unlockBike(session: Session, body: UnlockBody): Promise<UnlockResult> {
  const { accountId, subscriptionId, token } = await beforeSend(async () => {
    const accountId = await accountIdOf(session);
    const [subscriptionId, token] = await Promise.all([currentSubscriptionId(`/accounts/${accountId}`, session), publicToken.get()]);
    return { accountId, subscriptionId, token };
  });
  const account = `/accounts/${accountId}`;
  if (!subscriptionId) return { ...noSubscription(), ongoing: null };
  const outcome = await postRelease({ accountId, subscriptionId, body, token, identity: session.accessToken });
  if (outcome.httpStatus === 0) return { ...outcome, ongoing: null };
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const [ongoing, stations] = await Promise.all([read(`${account}/trips/ongoing`, z.array(rawTrip), session, "application/vnd.trip.v6+json").catch(() => null), stationsByNumber()]);
  return { ...outcome, ongoing: ongoing?.map((trip) => normalizeTrip(trip, stations)) ?? null };
}

export async function getTripCheck(session: Session): Promise<TripCheck> {
  const account = `/accounts/${await accountIdOf(session)}`;
  const trips = (path: string) => read(`${account}/${path}`, z.array(rawTrip), session, "application/vnd.trip.v6+json");
  const ongoing = await trips("trips/ongoing").catch((error) => { if (error instanceof VelovError && error.code === "expired") throw error; return null; });
  if (ongoing === null || ongoing.length) {
    const stations = ongoing?.length ? await stationsByNumber() : new Map<number, Station>();
    return { ongoing: ongoing?.map((trip) => normalizeTrip(trip, stations)) ?? null, latest: null };
  }
  const [history, stations] = await Promise.all([trips("trips?status=FINISHED").catch(() => null), stationsByNumber()]);
  if (!history) return { ongoing: null, latest: null };
  return { ongoing: [], latest: latestFinished(history.map((trip) => normalizeTrip(trip, stations))) };
}

export async function rateTrip(session: Session, tripId: string, body: RateBody): Promise<Outcome> {
  const { accountId, token } = await writer(session);
  return postRating({ accountId, tripId, body, token, identity: session.accessToken });
}

function writer(session: Session) {
  return beforeSend(async () => ({ accountId: await accountIdOf(session), token: await publicToken.get(), identity: session.accessToken }));
}

export async function setAutoSpend(session: Session, autoSpend: boolean): Promise<AutoSpendResult> {
  return patchAutoSpend({ ...(await writer(session)), autoSpend });
}

export async function setFavorite(session: Session, stationNumber: number, on: boolean): Promise<Outcome> {
  return putStationBookmark({ ...(await writer(session)), stationNumber, on });
}

export async function getReceipt(session: Session, subscriptionId: string, periodId: string) {
  return postPeriodReport({ ...(await writer(session)), subscriptionId, periodId });
}

export async function updateProfile(session: Session, body: ProfileBody): Promise<Outcome> {
  return patchProfile({ ...(await writer(session)), body });
}

function receiptsOf(subscriptions: z.infer<typeof rawSubscription>[], offerList: z.infer<typeof offerSchema>[]): Receipt[] {
  return subscriptions.flatMap((subscription) => (subscription.periods ?? []).flatMap((period) => subscription.id && period.id ? [{
    subscriptionId: subscription.id, periodId: period.id, start: utcDate(period.validityStart), end: utcDate(period.validityEnd),
    title: offerList.find((offer) => offer.id === period.offerId)?.title ?? (subscription.type === "LT" ? "Abonnement longue durée" : "Ticket Vélo’v")
  }] : [])).sort((left, right) => (right.start ?? "").localeCompare(left.start ?? "")).slice(0, 12);
}

export async function getDashboard(session: Session): Promise<Dashboard> {
  const account = `/accounts/${await accountIdOf(session)}`;
  const warnings: string[] = [];
  const optional = async <T>(promise: Promise<T>, fallback: T, warning: string): Promise<T> => {
    try { return await promise; } catch (error) { if (error instanceof VelovError && error.code === "expired") throw error; warnings.push(warning); return fallback; }
  };
  const [profile, rewards, subscriptions, history, ongoing, payment, movements, offerList, ruleList, stationData, bookings, allSubscriptions] = await Promise.all([
    read(account, rawProfile, session, "application/vnd.account.v4+json"),
    optional(read(`${account}/rewards`, rawRewards, session, "application/vnd.rewards.v5+json"), null, "Le solde de points est momentanément indisponible."),
    optional(read(`${account}/subscriptions?periods=CURRENT&typeList=ST&typeList=LT&isLocked=false`, z.array(rawSubscription), session, "application/vnd.subscription.v6+json"), null, "L’abonnement n’a pas pu être actualisé."),
    optional(read(`${account}/trips?status=FINISHED&status=ERROR&status=REVERSED`, z.array(rawTrip), session, "application/vnd.trip.v6+json"), null, "L’historique des trajets est momentanément indisponible."),
    optional(read(`${account}/trips/ongoing`, z.array(rawTrip), session, "application/vnd.trip.v6+json"), null, "Le trajet en cours n’a pas pu être vérifié."),
    optional(read(`${account}/payment`, z.object({ paymentValid: z.boolean() }), session, "application/vnd.payment.v3+json"), null, "Le moyen de paiement n’a pas pu être vérifié."),
    optional(read(`${account}/rewards/history?page=0`, z.object({ content: z.array(rawMovement) }), session, "application/vnd.rewards.v5+json"), { content: [] }, "L’historique des points est momentanément indisponible."),
    optional(offers("all", () => read("/offers", z.array(offerSchema), session, "application/vnd.offer.v2+json")), [], "Le nom de la formule n’a pas pu être actualisé."),
    optional(rules("all", () => read("/rewards/configurations", z.array(ruleSchema), session, "application/vnd.rewards.v5+json")), [], "Les règles de fidélité n’ont pas pu être actualisées."),
    optional(getStations(), { stations: [], updatedAt: new Date().toISOString() }, "Les noms des stations sont momentanément indisponibles."),
    optional(read(`${account}/bookings`, z.array(z.unknown()).nullable(), session), null, "Les réservations en cours n’ont pas pu être actualisées."),
    optional(read(`${account}/subscriptions?periods=PAST,CURRENT,FUTURE&sort=DESC`, z.array(rawSubscription), session, "application/vnd.subscription.v6+json"), null, "Les reçus d’abonnement sont momentanément indisponibles.")
  ]);
  const stationsByNumber = new Map(stationData.stations.map((station) => [station.number, station]));
  const currentSubscription = subscriptions?.find((subscription) => !subscription.isLocked && (subscription.periods?.length ?? 0) > 0);
  const period = currentSubscription?.periods?.at(-1);
  return dashboardSchema.parse({
    profile: {
      firstName: profile.firstName ?? "", lastName: profile.lastName ?? "", email: profile.email, locked: profile.isLocked ?? false, complete: (profile.completion ?? 0) >= 1,
      phoneNumber: profile.phoneNumber || null, address: profile.address?.name || null, addressComplement: profile.address?.complement || null,
      zipCode: profile.zipCode || null, city: profile.city || null, country: profile.country || null,
      favorites: [...new Set((profile.stations ?? []).map(Number).filter((number) => Number.isSafeInteger(number) && number > 0))]
    },
    rewards: {
      balance: rewards?.balance ?? null, total: rewards ? rewards.total ?? rewards.balance : null, autoSpend: rewards ? rewards.autoSpend ?? false : null,
      movements: movements.content.map((movement) => ({ id: movement.id, date: utcDate(movement.createdAt), label: reasons[movement.reason ?? ""] ?? "Mouvement de points", amount: movement.amount * (movement.direction === "DEBIT" ? -1 : 1) })),
      rules: ruleList.filter((rule) => rule.enable && reasons[rule.name]).map((rule) => ({ name: rule.name, label: reasons[rule.name], points: rule.reward, kind: rule.type === "RULE" ? "earn" : "spend" }))
    },
    subscription: !subscriptions ? "unavailable" : currentSubscription ? { id: currentSubscription.id ?? null, autoRenewal: period?.renewalDetails?.autoRenewalValue ?? null, autoRenewalAllowed: period?.renewalDetails?.autoRenewalBtn === true, title: offerList.find((offer) => offer.id === period?.offerId)?.title ?? (currentSubscription.type === "LT" ? "Abonnement longue durée" : "Ticket Vélo’v"), type: currentSubscription.type, validUntil: utcDate(period?.validityEnd), active: !currentSubscription.isLocked } : null,
    paymentValid: payment?.paymentValid ?? null, receipts: allSubscriptions ? receiptsOf(allSubscriptions, offerList) : null,
    trips: history?.map((trip) => normalizeTrip(trip, stationsByNumber)) ?? null, ongoing: ongoing?.map((trip) => normalizeTrip(trip, stationsByNumber)) ?? null,
    bookings: bookings?.length ?? null, updatedAt: new Date().toISOString(), warnings
  });
}


export async function setAutoRenewal(session: Session, body: AutoRenewalBody) {
  const auth = await writer(session);
  const path = `/accounts/${encodeURIComponent(auth.accountId)}/subscriptions?periods=CURRENT&typeList=ST&typeList=LT&isLocked=false`;
  const readState = async () => renewalStateOf((await read(path, z.array(rawSubscription), session, "application/vnd.subscription.v6+json")).find((item) => item.id === body.subscriptionId));
  const before = await beforeSend(readState);
  if (!before.autoRenewalAllowed || before.autoRenewal === null) return { ...refusal("local.renewal.not.allowed", "Le renouvellement automatique ne peut pas être modifié pour cet abonnement."), ...before, verified: true };
  return completeRenewalChange(() => patchAutoRenewal({ ...auth, ...body }), readState, body.autoRenewal);
}

export async function requestExtraTime(session: Session, body: ViaBody): Promise<Outcome> {
  const auth = await writer(session);
  const account = `/accounts/${auth.accountId}`;
  const active = await beforeSend(async () => {
    const subscriptions = await read(`${account}/subscriptions?periods=CURRENT&typeList=ST&typeList=LT&isLocked=false`, z.array(rawSubscription), session, VIA_MEDIA_TYPE);
    const renting = await Promise.all(subscriptions.filter((item) => item.id && !item.isLocked).map(async (item) => ({
      id: item.id!, ongoing: await read(`${account}/subscriptions/${encodeURIComponent(item.id!)}/rentbike`, z.boolean(), session, VIA_MEDIA_TYPE)
    })));
    return renting.filter((item) => item.ongoing);
  });
  if (active.length !== 1) return refusal("local.via.trip", active.length ? "Vous avez plusieurs trajets en cours. Utilisez l’app Vélo’v." : "Vous n’avez aucun trajet en cours.");
  const station = await beforeSend(() => read(`/stations/${body.stationNumber}`, z.object({ id: z.string(), number: z.number(), open: z.boolean(), availabilities: z.object({ main: z.object({ stands: z.number() }) }) }), session, "application/vnd.station.v4+json"));
  if (station.number !== body.stationNumber || !station.open || station.availabilities.main.stands !== 0) return refusal("local.via.not.full", "Cette station n’est plus pleine ou est fermée. Choisissez-en une autre.");
  return postVia({ ...auth, subscriptionId: active[0].id, stationId: VIA_STATION_IDENTIFIER === "uuid" ? station.id : station.number });
}

export async function contactSupport(session: Session, body: import("./contact-models").ContactBody): Promise<Outcome> {
  return postContactMail({ ...(await writer(session)), body });
}

export async function getRewardsSince(session: Session, since: number): Promise<RewardsHistory> {
  const account = `/accounts/${await accountIdOf(session)}`;
  return historySince(async (page) => {
    const value = await read(`${account}/rewards/history?page=${page}`, z.object({ content: z.array(rawMovement), last: lenient(z.boolean()) }), session, "application/vnd.rewards.v5+json");
    return { last: value.last === true, movements: value.content.map((movement) => ({ id: movement.id, date: utcDate(movement.createdAt), amount: signedAmount(movement.direction, movement.amount) })) };
  }, since);
}

export async function consumePromoCode(session: Session, expectedCost: number) {
  const auth = await writer(session);
  const [config, rewards] = await beforeSend(() => Promise.all([
    read("/rewards/configurations", z.array(ruleSchema), session, PROMOCODE_ACCEPT),
    read(`/accounts/${auth.accountId}/rewards`, rawRewards, session, PROMOCODE_ACCEPT)
  ]));
  const rule = config.find((entry) => entry.name === PROMOCODE_REWARD && entry.enable);
  if (!rule || rule.reward !== expectedCost) return { ...refusal("local.promo.price.changed", "L’offre a changé. Actualisez la page avant de confirmer."), promoCode: null };
  if (rewards.balance < rule.reward) return { ...refusal("local.promo.balance", "Votre solde de points est insuffisant."), promoCode: null };
  return postPromoCode(auth);
}

const TRIP_PAGE_SIZE = 100;
const stats = memo<Stats>(statsTtl);

export function getStats(session: Session): Promise<Stats> {
  return stats(session.email, async () => {
    const account = `/accounts/${await accountIdOf(session)}`;
    const history = await collectPages((page) => read(`${account}/trips?status=FINISHED&status=ERROR&status=REVERSED&page=${page}&size=${TRIP_PAGE_SIZE}`, z.array(rawTrip), session, "application/vnd.trip.v6+json"), (trip) => trip.id);
    const movements = await collectPages((page) => read(`${account}/rewards/history?page=${page}`, z.object({ content: z.array(rawMovement) }), session, "application/vnd.rewards.v5+json").then((value) => value.content), (movement) => movement.id).catch(() => null);
    const balance = await read(`${account}/rewards`, rawRewards, session, "application/vnd.rewards.v5+json").then((value) => value.balance, () => null);
    const stationList = await getStations().then((value) => value.stations, () => []);
    const byNumber = new Map(stationList.map((station) => [station.number, station]));
    return buildStats({
      trips: history.items.map((trip) => normalizeTrip(trip, byNumber)), coords: byNumber, balance,
      movements: movements?.items.map((movement) => ({ date: utcDate(movement.createdAt), amount: movement.amount * (movement.direction === "DEBIT" ? -1 : 1) })) ?? null,
      now: new Date(), complete: history.complete && movements !== null && movements.complete
    });
  });
}
