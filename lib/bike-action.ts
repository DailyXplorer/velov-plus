import { type Outcome, bookResultSchema, unlockResultSchema } from "./models.ts";
import { noAnswer, routeFailure } from "./outcome.ts";

export const BIKE_ACTION_TIMEOUT = 60_000;

export type BikeAction = "book" | "unlock";
type Target = { stationNumber: number; standNumber: number; bikeNumber: number };

export async function sendBikeAction(action: BikeAction, target: Target, send: typeof fetch = fetch): Promise<Outcome & { ongoing?: { id: string }[] | null }> {
  const body = action === "book" ? { stationNumber: target.stationNumber, bikeNumber: target.bikeNumber } : { stationNumber: target.stationNumber, standNumber: target.standNumber, bikeNumber: target.bikeNumber };
  try {
    const response = await send(action === "book" ? "/api/bookings" : "/api/unlock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(BIKE_ACTION_TIMEOUT) });
    const raw: unknown = await response.json().catch(() => null);
    const parsed = action === "book" ? bookResultSchema.safeParse(raw) : unlockResultSchema.safeParse(raw);
    return response.ok && parsed.success ? parsed.data : routeFailure(response.status, raw, "Réponse inattendue.");
  } catch {
    return noAnswer("Le serveur ne répond pas.");
  }
}
