import { z } from "zod";
import { type RateBody, type Trip, canRate, tripSchema } from "./models.ts";

export type Stars = 1 | 2 | 3 | 4 | 5;
export type Vote = Omit<RateBody, "bikeNumber">;

export function starVote(stars: Stars): Vote {
  if (stars >= 4) return { recommended: true, rating: null };
  return { recommended: false, rating: stars === 1 ? 30 : 60 };
}

export const starLabels: Record<Stars, string> = { 5: "Parfait", 4: "Bien", 3: "Moyen", 2: "Décevant", 1: "À réparer" };

const errorSchema = z.object({ error: z.string(), code: z.string().optional() });
const notSent = "La note n’a pas pu être envoyée.";
export type RateFailure = { message: string; raw: string };

export async function sendStars(tripId: string, bikeNumber: number, stars: Stars, send: typeof fetch = fetch): Promise<RateFailure | null> {
  let response: Response;
  try {
    response = await send(`/api/trips/${encodeURIComponent(tripId)}/rate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bikeNumber, ...starVote(stars) }), signal: AbortSignal.timeout(25_000) });
  } catch {
    return { message: notSent, raw: "HTTP aucune réponse" };
  }
  if (response.ok) return null;
  const error = errorSchema.safeParse(await response.json().catch(() => null));
  return { message: error.success ? error.data.error : notSent, raw: [`HTTP ${response.status}`, error.success && error.data.code ? `Code ${error.data.code}` : null].filter(Boolean).join(" · ") };
}

type Store = Pick<Storage, "getItem" | "setItem">;
const dismissedKey = (tripId: string) => `velov:trip-ended:v1:${tripId}`;

export function dismissTrip(storage: Store, tripId: string) {
  try { storage.setItem(dismissedKey(tripId), "1"); } catch {}
}

export function wasDismissed(storage: Store, tripId: string) {
  try { return storage.getItem(dismissedKey(tripId)) !== null; } catch { return false; }
}

export function latestFinished(trips: Trip[]): Trip | null {
  let latest: Trip | null = null;
  for (const trip of trips) {
    if (trip.status !== "FINISHED" || !trip.endedAt) continue;
    if (!latest || Date.parse(trip.endedAt) > Date.parse(latest.endedAt!)) latest = trip;
  }
  return latest;
}

export function tripToGreet(trips: Trip[], storage: Store, now = Date.now()): Trip | null {
  const latest = latestFinished(trips);
  return latest && canRate(latest, now) && !wasDismissed(storage, latest.id) ? latest : null;
}

export const tripCheckSchema = z.object({ ongoing: z.array(tripSchema).nullable(), latest: tripSchema.nullable() });
export type TripCheck = z.infer<typeof tripCheckSchema>;

export const WATCH_INTERVAL = 20_000;
export const WATCH_CAP = 3 * 3_600_000;
export const UNLOCK_GRACE = 2 * 60_000;

type Timer = ReturnType<typeof setTimeout>;
export type DockWatchDeps = {
  check: () => Promise<TripCheck>;
  docked: (tripId: string, latest: Trip | null) => void;
  visible: () => boolean;
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => Timer;
  clearTimer?: (timer: Timer) => void;
};
type Watch = { kind: "idle" } | { kind: "unlocked"; since: number; startedAt: number } | { kind: "riding"; tripId: string; startedAt: number };

export function createDockWatch({ check, docked, visible, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }: DockWatchDeps) {
  let watch: Watch = { kind: "idle" };
  let timer: Timer | null = null;
  let inFlight = false;
  let generation = 0;

  function cancel() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }
  function stop() {
    watch = { kind: "idle" };
    generation += 1;
    cancel();
  }
  function schedule() {
    cancel();
    if (watch.kind !== "idle") timer = setTimer(() => void tick(), WATCH_INTERVAL);
  }

  async function tick() {
    timer = null;
    if (watch.kind === "idle" || inFlight || !visible()) return;
    if (now() - watch.startedAt >= WATCH_CAP) return stop();
    const sent = generation;
    inFlight = true;
    let answer: TripCheck | null = null;
    try { answer = await check(); } catch {}
    finally { inFlight = false; }
    if (sent !== generation) return;
    const ongoing = answer?.ongoing;
    if (ongoing?.length) watch = { kind: "riding", tripId: ongoing[0].id, startedAt: watch.startedAt };
    else if (ongoing && watch.kind === "riding") {
      const { tripId } = watch;
      stop();
      return docked(tripId, answer?.latest ?? null);
    } else if (ongoing && watch.kind === "unlocked" && now() - watch.since >= UNLOCK_GRACE) return stop();
    schedule();
  }

  return {
    follow(tripId: string | null) {
      const startedAt = watch.kind === "idle" ? now() : watch.startedAt;
      if (tripId) watch = { kind: "riding", tripId, startedAt };
      else if (watch.kind === "idle") watch = { kind: "unlocked", since: now(), startedAt };
      if (timer === null && !inFlight) schedule();
    },
    visibilityChanged() {
      if (watch.kind === "idle") return;
      cancel();
      void tick();
    },
    stop,
    get active() { return watch.kind !== "idle"; }
  };
}
