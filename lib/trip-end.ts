import { z } from "zod";
import { type Outcome, type RateBody, type Trip, canRate, outcomeSchema, tripSchema } from "./models.ts";
import { networkFailure, routeFailure } from "./outcome.ts";
import { START_SLACK } from "./bike-action.ts";

export type Stars = 1 | 2 | 3 | 4 | 5;
export type Vote = Omit<RateBody, "bikeNumber">;

export function starVote(stars: Stars): Vote {
  if (stars >= 4) return { recommended: true, rating: null };
  return { recommended: false, rating: stars === 1 ? 30 : 60 };
}

export const starLabels: Record<Stars, string> = { 5: "Parfait", 4: "Bien", 3: "Moyen", 2: "Décevant", 1: "À réparer" };

const notSent = "Vélo’v ne répond pas. La note a peut-\u2060être été enregistrée.";

export async function sendStars(tripId: string, bikeNumber: number, stars: Stars, send: typeof fetch = fetch): Promise<Outcome> {
  let response: Response;
  const startedAt = Date.now();
  try {
    response = await send(`/api/trips/${encodeURIComponent(tripId)}/rate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bikeNumber, ...starVote(stars) }), signal: AbortSignal.timeout(35_000) });
  } catch (error) {
    return networkFailure(notSent, error, startedAt);
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.ok && z.object({ rated: z.literal(true) }).safeParse(body).success) return { ok: true, httpStatus: response.status, transactionState: null, code: null, message: null, detail: null };
  const upstream = outcomeSchema.safeParse(body);
  if (response.ok && upstream.success && !upstream.data.ok) return upstream.data;
  return routeFailure(response.status, body, notSent);
}

type Store = Pick<Storage, "getItem" | "setItem">;
const dismissedKey = (tripId: string) => `velov:trip-ended:v1:${tripId}`;

export function dismissTrip(storage: Store | null, tripId: string) {
  try { storage?.setItem(dismissedKey(tripId), "1"); } catch {}
}

export function wasDismissed(storage: Store | null, tripId: string) {
  try { return storage ? storage.getItem(dismissedKey(tripId)) !== null : false; } catch { return false; }
}

export function latestFinished(trips: Trip[]): Trip | null {
  let latest: Trip | null = null;
  for (const trip of trips) {
    if (trip.status !== "FINISHED" || !trip.endedAt) continue;
    if (!latest || Date.parse(trip.endedAt) > Date.parse(latest.endedAt!)) latest = trip;
  }
  return latest;
}

export function tripToGreet(trips: Trip[], storage: Store | null, now = Date.now()): Trip | null {
  const latest = latestFinished(trips);
  return latest && canRate(latest, now) && !wasDismissed(storage, latest.id) ? latest : null;
}

export const tripCheckSchema = z.object({ ongoing: z.array(tripSchema).nullable(), latest: tripSchema.nullable() });
export type TripCheck = z.infer<typeof tripCheckSchema>;

export const WATCH_INTERVAL = 20_000;
export const WATCH_CAP = 3 * 3_600_000;
export const UNLOCK_GRACE = 2 * 60_000;
export const WATCH_BACKOFF_CAP = 2 * 60_000;

type Timer = ReturnType<typeof setTimeout>;
export type DockWatchDeps = {
  check: () => Promise<TripCheck>;
  docked: (tripId: string, latest: Trip | null) => void;
  started?: (tripId: string) => void;
  visible: () => boolean;
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => Timer;
  clearTimer?: (timer: Timer) => void;
};
type Watch = { kind: "idle" } | { kind: "unlocked"; since: number; startedAt: number; bikeNumber: number | null } | { kind: "riding"; tripId: string; startedAt: number };

export function createDockWatch({ check, docked, started, visible, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }: DockWatchDeps) {
  let watch: Watch = { kind: "idle" };
  let timer: Timer | null = null;
  let inFlight = false;
  let generation = 0;
  let interval = WATCH_INTERVAL;
  let nextCheckAt: number | null = null;

  function cancel() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }
  function stop() {
    watch = { kind: "idle" };
    generation += 1;
    interval = WATCH_INTERVAL;
    nextCheckAt = null;
    cancel();
  }
  function schedule(delay = interval) {
    cancel();
    if (watch.kind === "idle") return;
    nextCheckAt = now() + delay;
    timer = setTimer(() => void tick(), delay);
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
    if (sent !== generation) {
      if (timer === null) schedule();
      return;
    }
    const ongoing = answer?.ongoing;
    interval = ongoing ? WATCH_INTERVAL : Math.min(interval * 2, WATCH_BACKOFF_CAP);
    if (ongoing?.length) {
      const fresh = watch.kind === "unlocked";
      watch = { kind: "riding", tripId: ongoing[0].id, startedAt: watch.startedAt };
      if (fresh) started?.(ongoing[0].id);
    } else if (ongoing && watch.kind === "riding") {
      const { tripId } = watch;
      stop();
      return docked(tripId, answer?.latest ?? null);
    } else if (ongoing && watch.kind === "unlocked") {
      const latest = answer?.latest ?? null;
      const ridden = latest && watch.bikeNumber !== null && latest.bikeNumber === watch.bikeNumber && latest.startedAt && Date.parse(latest.startedAt) >= watch.since - START_SLACK;
      if (ridden) { stop(); return docked(latest.id, latest); }
      if (now() - watch.since >= UNLOCK_GRACE) return stop();
    }
    schedule();
  }

  return {
    follow(tripId: string | null, bikeNumber: number | null = null) {
      const startedAt = watch.kind === "idle" ? now() : watch.startedAt;
      if (tripId) watch = { kind: "riding", tripId, startedAt };
      else if (watch.kind === "idle") watch = { kind: "unlocked", since: now(), startedAt, bikeNumber };
      if (timer === null && !inFlight) schedule();
    },
    visibilityChanged() {
      if (watch.kind === "idle" || inFlight) return;
      cancel();
      if (!visible()) return;
      const wait = nextCheckAt === null ? 0 : nextCheckAt - now();
      if (wait > 0) schedule(wait); else void tick();
    },
    stop,
    get active() { return watch.kind !== "idle"; }
  };
}
