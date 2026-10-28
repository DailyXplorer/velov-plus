import "server-only";
import { z } from "zod";
import { type Bike, type Dashboard, type Station, type Trip, dashboardSchema, stationTitle } from "./models";
import { VelovError } from "./auth-protocol";
import type { Session } from "./session";

const API = "https://api.cyclocity.fr";
const BASE = `${API}/contracts/lyon`;
const scalar = z.union([z.number(), z.string()]).nullish();
const date = z.string().nullish();
const rawTrip = z.object({ id: z.string(), status: z.string().optional(), startDateTime: date, endDateTime: date, startStation: scalar, endStation: scalar, startStationName: date, endStationName: date, bikeNumber: z.number().nullish(), bikeType: z.number().nullish(), duration: z.number().nullish(), price: z.number().nullish(), reducedPrice: z.number().nullish(), rewardsEarned: z.number().nullish(), rewardsSpent: z.number().nullish() });
const rawProfile = z.object({ firstName: z.string().nullish(), lastName: z.string().nullish(), email: z.string(), isLocked: z.boolean().optional(), completion: z.number().optional() });
const rawRewards = z.object({ balance: z.number(), total: z.number().optional(), autoSpend: z.boolean().optional() });
const rawMovement = z.object({ id: z.string(), createdAt: date, direction: z.string().optional(), amount: z.number(), reason: z.string().optional() });
const rawSubscription = z.object({ type: z.string(), isLocked: z.boolean().optional(), periods: z.array(z.object({ offerId: z.number().optional(), validityEnd: date })).optional() });
const offerSchema = z.object({ id: z.number(), title: z.string() });
const ruleSchema = z.object({ name: z.string(), enable: z.boolean(), reward: z.number(), type: z.string() });
const localizedName = z.union([z.string(), z.array(z.object({ text: z.string(), language: z.string() }))]);
const infoSchema = z.object({ data: z.object({ stations: z.array(z.object({ station_id: z.string(), name: localizedName, lat: z.number(), lon: z.number(), address: z.string().optional() })) }) });
const statusSchema = z.object({ last_updated: z.union([z.string(), z.number()]), data: z.object({ stations: z.array(z.object({ station_id: z.string(), num_vehicles_available: z.number().optional(), num_bikes_available: z.number().optional(), num_docks_available: z.number(), is_renting: z.union([z.boolean(), z.number()]), vehicle_types_available: z.array(z.object({ vehicle_type_id: z.string(), count: z.number() })).optional() })) }) });
// The bikes endpoint sits behind a WAF that answers non-browser user agents with an HTML 403.
const BROWSER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const lenient = <T extends z.ZodType>(schema: T) => schema.nullish().catch(null);
const rawBike = z.object({ number: z.number(), type: lenient(z.string()), frameId: lenient(z.string()), standNumber: lenient(z.number()), status: lenient(z.string()), statusLabel: lenient(z.string()), isReserved: lenient(z.boolean()), rating: lenient(z.object({ value: lenient(z.number()), count: lenient(z.number()), lastRatingDateTime: lenient(z.string()) })), battery: lenient(z.object({ percentage: lenient(z.number()) })), createdAt: lenient(z.string()), lastRevisionDateTime: lenient(z.string()), lastTripDateTime: lenient(z.string()), lastControlDateTime: lenient(z.string()), nextReview: lenient(z.string()) });
let publicToken: { token: string; expiresAt: number } | null = null;
let stationCache: { stations: Station[]; updatedAt: string; expiresAt: number } | null = null;

async function clientToken() {
  if (publicToken && publicToken.expiresAt > Date.now()) return publicToken.token;
  const response = await fetch(`${API}/auth/environments/PRD/client_tokens`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "vls.web.lyon:PRD", key: "c3d9f5c22a9157a7cc7fe0e38269573bdd2f13ec48f867360ecdcbd35b196f87" }), cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new VelovError("unavailable", "Vélo’v ne répond pas pour le moment.");
  const value: unknown = await response.json();
  const result = z.object({ accessToken: z.string() }).parse(value);
  publicToken = { token: result.accessToken, expiresAt: Date.now() + 100 * 60_000 };
  return result.accessToken;
}

async function read<T>(path: string, schema: z.ZodType<T>, token: string, session: Session, accept = "application/json"): Promise<T> {
  const response = await fetch(`${BASE}${path}`, { headers: { Authorization: `Taknv1 ${token}`, Identity: session.accessToken, Accept: accept }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (response.status === 401) throw new VelovError("expired", "Votre session doit être renouvelée. Reconnectez-vous pour continuer.");
  if (!response.ok) throw new VelovError("unavailable", "Certaines informations Vélo’v ne sont pas disponibles pour le moment.");
  const value: unknown = await response.json();
  return schema.parse(value);
}

const reasons: Record<string, string> = { RATE_BIKE: "Vélo évalué", START_STATION_FULL: "Départ d’une station pleine", END_STATION_EMPTY: "Arrivée dans une station vide", TRIP_BONUS: "Bonus de trajet", START_TRIP_OVERFLOW: "Départ en station virtuelle", REDUCTION: "Réduction sur un trajet", BIKE_BOOKING: "Réservation d’un vélo", PROMOCODE: "Invitation d’un proche" };

function normalizeTrip(value: z.infer<typeof rawTrip>, stations: Map<string, string>): Trip {
  const station = (name: string | null | undefined, number: string | number | null | undefined) => name ? stationTitle(name) : number != null ? stations.get(String(number)) ?? `Station ${number}` : null;
  return { id: value.id, status: value.status ?? "FINISHED", startedAt: value.startDateTime ?? null, endedAt: value.endDateTime ?? null, startStation: station(value.startStationName, value.startStation), endStation: station(value.endStationName, value.endStation), bikeNumber: value.bikeNumber ?? null, bikeType: value.bikeType === 1 ? "electrical" : value.bikeType === 0 ? "mechanical" : "unknown", duration: value.duration ?? 0, price: value.reducedPrice ?? value.price ?? 0, pointsEarned: value.rewardsEarned ?? 0, pointsSpent: value.rewardsSpent ?? 0 };
}

/** Bike dates are UTC without a zone designator. */
function utcDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeBike(value: z.infer<typeof rawBike>): Bike {
  const type = value.type === "ELECTRICAL" ? "electrical" : value.type === "MECHANICAL" ? "mechanical" : "other";
  const percent = value.battery?.percentage;
  const rating = value.rating?.value != null && value.rating.count ? { value: Math.round(value.rating.value * 10) / 10, count: value.rating.count, lastAt: utcDate(value.rating.lastRatingDateTime) } : null;
  return { number: value.number, type, standNumber: value.standNumber ?? null, status: value.status ?? null, statusLabel: value.statusLabel ?? null, isReserved: value.isReserved ?? false, rating, batteryPercent: type === "electrical" && percent != null ? Math.min(100, Math.max(0, Math.round(percent))) : null, frameId: value.frameId && value.frameId !== "0" ? value.frameId : null, lastTripAt: utcDate(value.lastTripDateTime), lastRevisionAt: utcDate(value.lastRevisionDateTime), lastControlAt: utcDate(value.lastControlDateTime), nextReviewAt: utcDate(value.nextReview), createdAt: utcDate(value.createdAt) };
}

export async function getStationBikes(station: number, retry = true): Promise<Bike[]> {
  const response = await fetch(`${BASE}/bikes?stationNumber=${station}`, { headers: { Authorization: `Taknv1 ${await clientToken()}`, Accept: "application/vnd.bikes.v4+json", "User-Agent": BROWSER_AGENT }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (response.status === 401 && retry) { publicToken = null; return getStationBikes(station, false); }
  if (!response.ok) throw new VelovError("unavailable", "Les vélos de cette station sont momentanément indisponibles.");
  const value: unknown = await response.json();
  // One malformed bike should not hide the others.
  return z.array(z.unknown()).parse(value).flatMap((item) => { const bike = rawBike.safeParse(item); return bike.success ? [normalizeBike(bike.data)] : []; })
    .sort((left, right) => (left.standNumber ?? Infinity) - (right.standNumber ?? Infinity) || left.number - right.number);
}

export async function getStations() {
  if (stationCache && stationCache.expiresAt > Date.now()) return { stations: stationCache.stations, updatedAt: stationCache.updatedAt };
  const [informationResponse, statusResponse] = await Promise.all([
    fetch(`${BASE}/gbfs/v3/station_information.json`, { next: { revalidate: 45 }, signal: AbortSignal.timeout(15_000) }),
    fetch(`${BASE}/gbfs/v3/station_status.json`, { next: { revalidate: 45 }, signal: AbortSignal.timeout(15_000) })
  ]);
  if (!informationResponse.ok || !statusResponse.ok) throw new VelovError("unavailable", "Les disponibilités des stations sont momentanément indisponibles.");
  const information: unknown = await informationResponse.json();
  const statuses: unknown = await statusResponse.json();
  const info = infoSchema.parse(information);
  const status = statusSchema.parse(statuses);
  const availability = new Map(status.data.stations.map((station) => [station.station_id, station]));
  const stations = info.data.stations.flatMap((station): Station[] => {
    const current = availability.get(station.station_id);
    const number = Number(station.station_id);
    if (!current || !Number.isFinite(number)) return [];
    const name = typeof station.name === "string" ? station.name : station.name.find((name) => name.language.startsWith("fr"))?.text ?? station.name[0]?.text ?? `Station ${number}`;
    const types = current.vehicle_types_available ?? [];
    const electrical = types.filter((type) => /electri/i.test(type.vehicle_type_id)).reduce((sum, type) => sum + type.count, 0);
    const total = current.num_vehicles_available ?? current.num_bikes_available ?? 0;
    return [{ id: station.station_id, number, name: stationTitle(name), address: station.address ?? "", lat: station.lat, lon: station.lon, electrical, mechanical: Math.max(0, total - electrical), stands: current.num_docks_available, open: Boolean(current.is_renting) }];
  });
  const updatedAt = typeof status.last_updated === "number" ? new Date(status.last_updated * 1000).toISOString() : status.last_updated;
  stationCache = { stations, updatedAt, expiresAt: Date.now() + 45_000 };
  return { stations, updatedAt };
}

export async function getDashboard(session: Session): Promise<Dashboard> {
  const token = await clientToken();
  const accountId = await read(`/accounts/${encodeURIComponent(session.email)}/id`, z.string().uuid(), token, session);
  const account = `/accounts/${accountId}`;
  const warnings: string[] = [];
  const optional = async <T>(promise: Promise<T>, fallback: T, warning: string): Promise<T> => {
    try { return await promise; } catch (error) { if (error instanceof VelovError && error.code === "expired") throw error; warnings.push(warning); return fallback; }
  };
  const [profile, rewards, subscriptions, history, ongoing, payment, movements, offers, rules, stationData, bookings] = await Promise.all([
    read(account, rawProfile, token, session, "application/vnd.account.v4+json"),
    read(`${account}/rewards`, rawRewards, token, session, "application/vnd.rewards.v5+json"),
    read(`${account}/subscriptions?periods=CURRENT&typeList=ST&typeList=LT&isLocked=false`, z.array(rawSubscription), token, session, "application/vnd.subscription.v6+json"),
    read(`${account}/trips?status=FINISHED&status=ERROR&status=REVERSED`, z.array(rawTrip), token, session, "application/vnd.trip.v6+json"),
    read(`${account}/trips/ongoing`, z.array(rawTrip), token, session, "application/vnd.trip.v6+json"),
    read(`${account}/payment`, z.object({ paymentValid: z.boolean() }), token, session, "application/vnd.payment.v3+json"),
    optional(read(`${account}/rewards/history?page=0`, z.object({ content: z.array(rawMovement) }), token, session, "application/vnd.rewards.v5+json"), { content: [] }, "L’historique des points est momentanément indisponible."),
    optional(read("/offers", z.array(offerSchema), token, session, "application/vnd.offer.v2+json"), [], "Le nom de la formule n’a pas pu être actualisé."),
    optional(read("/rewards/configurations", z.array(ruleSchema), token, session, "application/vnd.rewards.v5+json"), [], "Les règles de fidélité n’ont pas pu être actualisées."),
    optional(getStations(), { stations: [], updatedAt: new Date().toISOString() }, "Les noms des stations sont momentanément indisponibles."),
    optional(read(`${account}/bookings`, z.array(z.unknown()).nullable(), token, session), null, "Les réservations en cours n’ont pas pu être actualisées.")
  ]);
  const stationNames = new Map(stationData.stations.map((station) => [String(station.number), station.name]));
  const currentSubscription = subscriptions.find((subscription) => !subscription.isLocked && (subscription.periods?.length ?? 0) > 0);
  const period = currentSubscription?.periods?.at(-1);
  return dashboardSchema.parse({
    profile: { firstName: profile.firstName ?? "", lastName: profile.lastName ?? "", email: profile.email, locked: profile.isLocked ?? false, complete: (profile.completion ?? 0) >= 1 },
    rewards: { balance: rewards.balance, total: rewards.total ?? rewards.balance, autoSpend: rewards.autoSpend ?? false, movements: movements.content.map((movement) => ({ id: movement.id, date: movement.createdAt ?? null, label: reasons[movement.reason ?? ""] ?? "Mouvement de points", amount: movement.amount * (movement.direction === "DEBIT" ? -1 : 1) })), rules: rules.filter((rule) => rule.enable && reasons[rule.name]).map((rule) => ({ name: rule.name, label: reasons[rule.name], points: rule.reward, kind: rule.type === "RULE" ? "earn" : "spend" })) },
    subscription: currentSubscription ? { title: offers.find((offer) => offer.id === period?.offerId)?.title ?? (currentSubscription.type === "LT" ? "Abonnement longue durée" : "Ticket Vélo’v"), type: currentSubscription.type, validUntil: period?.validityEnd ?? null, active: !currentSubscription.isLocked } : null,
    paymentValid: payment.paymentValid, trips: history.map((trip) => normalizeTrip(trip, stationNames)), ongoing: ongoing.map((trip) => normalizeTrip(trip, stationNames)), bookings: bookings?.length ?? null, updatedAt: new Date().toISOString(), warnings
  });
}
