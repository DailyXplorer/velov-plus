// The parts of the Cyclocity client that need no server secret, kept free of "server-only" so tests can import them.
import { z } from "zod";
import { type RateBody, type Station, type Trip, stationTitle } from "./models.ts";
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

/** Cyclocity dates are UTC without a zone designator. */
export function utcDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function stationNumber(value: string | number | null | undefined) {
  const number = Number(value);
  return value != null && value !== "" && Number.isSafeInteger(number) ? number : null;
}

export function normalizeTrip(value: z.infer<typeof rawTrip>, stations: Map<number, Station>): Trip {
  const start = stationNumber(value.startStation);
  const end = stationNumber(value.endStation);
  const station = (name: string | null | undefined, number: number | null, raw: unknown) => name ? stationTitle(name) : number != null ? stations.get(number)?.name ?? `Station ${number}` : raw != null ? `Station ${raw}` : null;
  const from = start != null ? stations.get(start) : undefined;
  const to = end != null ? stations.get(end) : undefined;
  return {
    id: value.id, status: value.status ?? "FINISHED", startedAt: utcDate(value.startDateTime), endedAt: utcDate(value.endDateTime),
    startStation: station(value.startStationName, start, value.startStation), endStation: station(value.endStationName, end, value.endStation),
    startStationNumber: start, endStationNumber: end, startStand: value.startStand ?? null, endStand: value.endStand ?? null,
    distance: from && to && start !== end ? Math.round(haversine(from, to)) : null,
    bikeNumber: value.bikeNumber ?? null, bikeType: value.bikeType === 1 ? "electrical" : value.bikeType === 0 ? "mechanical" : "unknown",
    duration: value.duration ?? 0, price: value.reducedPrice ?? (value.price != null ? value.price - (value.discount ?? 0) : 0),
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
  if (response.status !== 200) throw new VelovError("unavailable", "Vélo’v n’a pas enregistré la note. Réessayez dans un instant.");
}
