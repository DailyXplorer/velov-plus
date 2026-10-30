import { type Booking, type Outcome, bookResultSchema, unlockResultSchema } from "./models.ts";
import { type Check, networkFailure, routeFailure } from "./outcome.ts";
import type { TripCheck } from "./trip-end.ts";

export const BIKE_ACTION_TIMEOUT = 60_000;
const MAYBE: Record<BikeAction, string> = {
  unlock: "Le vélo est peut-être déverrouillé.",
  book: "Le vélo est peut-être réservé : actualisez la page avant de réessayer."
};

export type BikeAction = "book" | "unlock";
type Target = { stationNumber: number; standNumber: number; bikeNumber: number };

export async function sendBikeAction(action: BikeAction, target: Target, send: typeof fetch = fetch, now: () => number = Date.now): Promise<Outcome & { ongoing?: { id: string }[] | null }> {
  const body = action === "book" ? { stationNumber: target.stationNumber, bikeNumber: target.bikeNumber } : { stationNumber: target.stationNumber, standNumber: target.standNumber, bikeNumber: target.bikeNumber };
  const startedAt = now();
  try {
    const response = await send(action === "book" ? "/api/bookings" : "/api/unlock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(BIKE_ACTION_TIMEOUT) });
    const raw: unknown = await response.json().catch(() => null);
    const parsed = action === "book" ? bookResultSchema.safeParse(raw) : unlockResultSchema.safeParse(raw);
    return response.ok && parsed.success ? parsed.data : routeFailure(response.status, raw, `Réponse inattendue. ${MAYBE[action]}`);
  } catch (error) {
    return networkFailure(`Le serveur ne répond pas. ${MAYBE[action]}`, error, startedAt, now());
  }
}

export const START_SLACK = 5 * 60_000;

export function unlockCheck(trips: TripCheck, bikeNumber: number, at: number): { check: Check; tripId: string | null } {
  if (trips.ongoing === null) return { check: "unknown", tripId: null };
  const riding = trips.ongoing.find((trip) => trip.bikeNumber === bikeNumber);
  if (riding) return { check: "applied", tripId: riding.id };
  const latest = trips.latest;
  if (!trips.ongoing.length && latest?.bikeNumber === bikeNumber && latest.startedAt && Date.parse(latest.startedAt) >= at - START_SLACK) return { check: "applied", tripId: null };
  return { check: "unchanged", tripId: null };
}

export function bookingCheck(bookings: Booking[] | null, bikeNumber: number): Check {
  if (bookings === null) return "unknown";
  if (bookings.some((booking) => booking.bikeNumber === bikeNumber)) return "applied";
  return bookings.some((booking) => booking.bikeNumber === null) ? "unknown" : "unchanged";
}
