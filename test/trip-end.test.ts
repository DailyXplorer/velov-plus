import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { type Trip, rateBodySchema } from "../lib/models.ts";
import { type Stars, type TripCheck, UNLOCK_GRACE, WATCH_BACKOFF_CAP, WATCH_CAP, WATCH_INTERVAL, createDockWatch, dismissTrip, sendStars, starLabels, tripToGreet, wasDismissed } from "../lib/trip-end.ts";
import { HISTORY_LAG, isUncertain } from "../lib/outcome.ts";
import { SENDING_LIMIT, createOperations, runOnce, settleHeld } from "../lib/operations.ts";

const now = Date.parse("2026-10-29T12:00:00Z");
const trip = (id: string, endedAt: string | null, extra: Partial<Trip> = {}): Trip => ({
  id, status: "FINISHED", startedAt: endedAt, endedAt, startStation: "Bellecour", endStation: "Part-Dieu", startStationNumber: 2002, endStationNumber: 3001,
  startStand: 1, endStand: 12, distance: 2_200, bikeNumber: 20449, bikeType: "mechanical", duration: 12, price: 0, fullPrice: 0, discount: 0,
  pointsEarned: 0, pointsSpent: 0, litigious: false, isRated: false, token: null, origin: null, ...extra
});

function recorder(status: number, answer: unknown = { rated: true }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const send = (async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), init: init ?? {} }); return Response.json(answer, { status }); }) as typeof fetch;
  return { calls, send };
}

test("stars map to Vélo’v’s three levels: 5-4 recommend, 3-2 rate 60, 1 rates 30", async () => {
  const expected: Record<Stars, unknown> = {
    5: { bikeNumber: 20449, recommended: true, rating: null }, 4: { bikeNumber: 20449, recommended: true, rating: null },
    3: { bikeNumber: 20449, recommended: false, rating: 60 }, 2: { bikeNumber: 20449, recommended: false, rating: 60 },
    1: { bikeNumber: 20449, recommended: false, rating: 30 }
  };
  for (const stars of [1, 2, 3, 4, 5] as const) {
    const { calls, send } = recorder(200);
    assert.equal((await sendStars("trip-1", 20449, stars, send)).ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/trips/trip-1/rate");
    assert.equal(calls[0].init.method, "POST");
    const body: unknown = JSON.parse(String(calls[0].init.body));
    assert.deepEqual(body, expected[stars], `${stars} stars`);
    assert.deepEqual(rateBodySchema.parse(body), body);
  }
  assert.deepEqual(Object.values(starLabels), ["À réparer", "Décevant", "Moyen", "Bien", "Parfait"]);
});

test("a failed note is sent once and comes back with its message, status and code", async () => {
  const { calls, send } = recorder(502, { error: "Vélo’v n’a pas confirmé la note.", code: "unavailable" });
  const failed = await sendStars("trip-1", 20449, 1, send);
  assert.deepEqual([failed.ok, failed.httpStatus, failed.code, failed.message], [false, 502, "unavailable", "Vélo’v n’a pas confirmé la note."]);
  assert.equal(isUncertain(failed), true);
  assert.equal(calls.length, 1);
  const offline = (async () => { throw new TypeError("offline"); }) as typeof fetch;
  const lost = await sendStars("trip-1", 20449, 5, offline);
  assert.deepEqual([lost.ok, lost.httpStatus, lost.message, isUncertain(lost)], [false, 0, "Vélo’v ne répond pas. La note a peut-être été enregistrée.", true]);
  const silent = await sendStars("trip-1", 20449, 5, (async () => new Response("<html>", { status: 503 })) as typeof fetch);
  assert.deepEqual([silent.message, isUncertain(silent)], ["Vélo’v ne répond pas. La note a peut-être été enregistrée.", true]);
  assert.doesNotMatch(String(silent.message), /Réessayez|pas pu être envoyée/);
});

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value), values };
}

test("on load, the latest finished trip is offered until it is dismissed, and the dismissal sticks per trip", () => {
  const storage = memoryStorage();
  const older = trip("older", "2026-10-29T10:30:00Z");
  const latest = trip("latest", "2026-10-29T11:00:00Z");
  assert.equal(tripToGreet([older, latest], storage, now)?.id, "latest");
  dismissTrip(storage, "latest");
  assert.equal(wasDismissed(storage, "latest"), true);
  assert.equal(wasDismissed(storage, "older"), false);
  assert.equal(tripToGreet([older, latest], storage, now), null);
  assert.equal(tripToGreet([trip("next", "2026-10-29T11:30:00Z"), latest], storage, now)?.id, "next");
});

test("nothing is offered for a rated, old, bikeless or unfinished latest trip, nor without working storage", () => {
  const storage = memoryStorage();
  assert.equal(tripToGreet([trip("a", "2026-10-29T11:00:00Z", { isRated: true })], storage, now), null);
  assert.equal(tripToGreet([trip("a", "2026-10-29T08:59:00Z")], storage, now), null);
  assert.equal(tripToGreet([trip("a", "2026-10-29T11:00:00Z", { bikeNumber: null })], storage, now), null);
  assert.equal(tripToGreet([trip("a", "2026-10-29T11:00:00Z", { status: "ERROR" })], storage, now), null);
  assert.equal(tripToGreet([], storage, now), null);
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.doesNotThrow(() => dismissTrip(broken, "a"));
  assert.equal(wasDismissed(broken, "a"), false);
});

function harness() {
  let clock = now;
  let visible = true;
  const timers: { at: number; run: () => void; id: number }[] = [];
  let nextId = 0;
  const pending: { resolve: (value: TripCheck) => void; reject: (error: Error) => void }[] = [];
  const docked: { tripId: string; latest: Trip | null }[] = [];
  let checks = 0;
  const watch = createDockWatch({
    check: () => { checks += 1; return new Promise<TripCheck>((resolve, reject) => pending.push({ resolve, reject })); },
    docked: (tripId, latest) => docked.push({ tripId, latest }),
    visible: () => visible,
    now: () => clock,
    setTimer: (run, ms) => { const id = nextId++; timers.push({ at: clock + ms, run, id }); return id as unknown as ReturnType<typeof setTimeout>; },
    clearTimer: (timer) => { const index = timers.findIndex((item) => item.id === (timer as unknown as number)); if (index >= 0) timers.splice(index, 1); }
  });
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  return {
    watch, docked, timers,
    get checks() { return checks; },
    get inFlight() { return pending.length; },
    async advance(ms: number) {
      const until = clock + ms;
      for (;;) {
        timers.sort((left, right) => left.at - right.at);
        const due = timers[0];
        if (!due || due.at > until) break;
        timers.shift();
        clock = due.at;
        due.run();
        await flush();
      }
      clock = until;
    },
    async answer(value: TripCheck | Error) {
      const next = pending.shift()!;
      if (value instanceof Error) next.reject(value); else next.resolve(value);
      await flush();
    },
    async setVisible(value: boolean) { visible = value; watch.visibilityChanged(); await flush(); }
  };
}
const riding = (id: string): TripCheck => ({ ongoing: [trip(id, null, { status: "STARTED" })], latest: null });
const none = (latest: Trip | null = null): TripCheck => ({ ongoing: [], latest });

test("without an ongoing trip the watch sends nothing, ever", async () => {
  const h = harness();
  await h.advance(4 * 3_600_000);
  await h.setVisible(false);
  await h.setVisible(true);
  assert.equal(h.checks, 0);
  assert.equal(h.timers.length, 0);
});

test("a ride is checked every 20 s, and docking fires once and stops the watch", async () => {
  const h = harness();
  h.watch.follow("ride");
  await h.advance(WATCH_INTERVAL - 1);
  assert.equal(h.checks, 0);
  await h.advance(1);
  assert.equal(h.checks, 1);
  await h.answer(riding("ride"));
  await h.advance(WATCH_INTERVAL);
  assert.equal(h.checks, 2);
  const finished = trip("ride", "2026-10-29T12:00:30Z");
  await h.answer(none(finished));
  assert.deepEqual(h.docked, [{ tripId: "ride", latest: finished }]);
  assert.equal(h.watch.active, false);
  await h.advance(3_600_000);
  await h.setVisible(true);
  assert.equal(h.checks, 2);
  assert.equal(h.docked.length, 1);
});

test("never more than one check in flight, even when the page comes back meanwhile", async () => {
  const h = harness();
  h.watch.follow("ride");
  await h.advance(WATCH_INTERVAL);
  assert.equal(h.inFlight, 1);
  await h.setVisible(true);
  await h.setVisible(true);
  h.watch.follow("ride");
  await h.advance(5 * WATCH_INTERVAL);
  assert.equal(h.checks, 1);
  assert.equal(h.inFlight, 1);
  await h.answer(riding("ride"));
  await h.advance(WATCH_INTERVAL);
  assert.equal(h.checks, 2);
});

test("a hidden page pauses the watch; coming back checks at once", async () => {
  const h = harness();
  h.watch.follow("ride");
  await h.setVisible(false);
  await h.advance(10 * WATCH_INTERVAL);
  assert.equal(h.checks, 0);
  await h.setVisible(true);
  assert.equal(h.checks, 1);
  await h.answer(none());
  assert.deepEqual(h.docked.map((item) => item.tripId), ["ride"]);
});

test("a failed or unreadable check keeps watching; the watch gives up after 3 hours", async () => {
  const h = harness();
  h.watch.follow("ride");
  await h.advance(WATCH_INTERVAL);
  await h.answer(new Error("offline"));
  await h.advance(2 * WATCH_INTERVAL);
  await h.answer({ ongoing: null, latest: null });
  assert.equal(h.docked.length, 0);
  for (let elapsed = 3 * WATCH_INTERVAL; elapsed < WATCH_CAP; elapsed += WATCH_INTERVAL) {
    await h.advance(WATCH_INTERVAL);
    if (h.inFlight) await h.answer(riding("ride"));
  }
  const sent = h.checks;
  await h.advance(WATCH_INTERVAL);
  assert.equal(h.inFlight, 0);
  assert.equal(h.watch.active, false);
  assert.ok(sent <= WATCH_CAP / WATCH_INTERVAL, String(sent));
});

test("after an unlock, the watch waits for the trip to show up, then for it to end", async () => {
  const h = harness();
  h.watch.follow(null);
  await h.advance(WATCH_INTERVAL);
  await h.answer(none());
  assert.equal(h.docked.length, 0);
  await h.advance(WATCH_INTERVAL);
  await h.answer(riding("fresh"));
  await h.advance(WATCH_INTERVAL);
  await h.answer(none());
  assert.deepEqual(h.docked.map((item) => item.tripId), ["fresh"]);
});

test("an unlock that never turns into a trip stops the watch after the grace period", async () => {
  const h = harness();
  h.watch.follow(null);
  while (h.watch.active) {
    await h.advance(WATCH_INTERVAL);
    if (h.inFlight) await h.answer(none());
  }
  assert.equal(h.docked.length, 0);
  assert.equal(h.checks, UNLOCK_GRACE / WATCH_INTERVAL);
});

test("stopping drops the answer of a check already sent, even once a new ride is followed", async () => {
  const h = harness();
  h.watch.follow("ride");
  await h.advance(WATCH_INTERVAL);
  h.watch.stop();
  assert.equal(h.timers.length, 0);
  h.watch.follow("next");
  await h.answer(none());
  assert.equal(h.docked.length, 0);
  assert.equal(h.watch.active, true);
});

test("following the same ride again does not push its next check back", async () => {
  const h = harness();
  h.watch.follow("ride");
  await h.advance(WATCH_INTERVAL - 5_000);
  h.watch.follow("ride");
  await h.advance(5_000);
  assert.equal(h.checks, 1);
});

test("F5: coming back to the page waits for what is left of the delay since the last check", async () => {
  const h = harness();
  h.watch.follow("ride");
  await h.advance(5_000);
  await h.setVisible(false);
  await h.setVisible(true);
  await h.setVisible(false);
  await h.advance(5_000);
  await h.setVisible(true);
  assert.equal(h.checks, 0);
  assert.equal(h.timers.length, 1);
  await h.advance(WATCH_INTERVAL - 10_000 - 1);
  assert.equal(h.checks, 0);
  await h.advance(1);
  assert.equal(h.checks, 1);
  await h.answer(riding("ride"));
  await h.setVisible(false);
  await h.advance(3_000);
  await h.setVisible(true);
  await h.advance(WATCH_INTERVAL - 3_000 - 1);
  assert.equal(h.checks, 1);
  await h.advance(1);
  assert.equal(h.checks, 2);
});

test("F5: an unavailable or refused check doubles the delay up to 2 minutes, a good answer restores it", async () => {
  const h = harness();
  h.watch.follow("ride");
  await h.advance(WATCH_INTERVAL);
  const gaps: number[] = [];
  for (const failure of [new Error("HTTP 429"), { ongoing: null, latest: null }, new Error("HTTP 503"), new Error("HTTP 429")]) {
    await h.answer(failure);
    const sent = h.checks;
    let waited = 0;
    while (h.checks === sent) { await h.advance(1_000); waited += 1_000; }
    gaps.push(waited);
  }
  assert.deepEqual(gaps, [2 * WATCH_INTERVAL, 4 * WATCH_INTERVAL, WATCH_BACKOFF_CAP, WATCH_BACKOFF_CAP]);
  await h.answer(riding("ride"));
  await h.advance(WATCH_INTERVAL);
  assert.equal(h.inFlight, 1);
});

test("F7: stopping and following again during a slow check still leaves exactly one timer for the new ride", async () => {
  const h = harness();
  h.watch.follow("ride");
  await h.advance(WATCH_INTERVAL);
  h.watch.stop();
  h.watch.follow("next");
  assert.equal(h.timers.length, 0);
  await h.answer(none());
  assert.equal(h.docked.length, 0);
  assert.equal(h.timers.length, 1);
  await h.advance(WATCH_INTERVAL);
  assert.equal(h.checks, 2);
  await h.answer(none());
  assert.deepEqual(h.docked.map((item) => item.tripId), ["next"]);
});

test("R1: a rating is sent once per trip, even when the sheet is reopened during the send or after an uncertain answer", async () => {
  let clock = now;
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const tab = createOperations(() => storage, () => clock);
  const answers: ((response: Response) => void)[] = [];
  const posts: string[] = [];
  const send = ((url: string) => { posts.push(url); return new Promise<Response>((resolve) => answers.push(resolve)); }) as unknown as typeof fetch;
  const rate = () => runOnce(tab, "rate:trip-1", () => sendStars("trip-1", 20449, 5, send), { keep: true, meta: { stars: 5 } });
  const first = rate();
  assert.equal(await rate(), "busy", "sheet reopened while sending");
  answers.shift()!(Response.json(null, { status: 504 }));
  const outcome = await first;
  assert.ok(typeof outcome !== "string" && isUncertain(outcome));
  clock += SENDING_LIMIT + 2 * 60_000 + 3_600_000;
  const held = createOperations(() => storage, () => clock).get("rate:trip-1");
  assert.equal(held?.status, "uncertain", "Plus tard then reopening still asks for Vérifier");
  assert.equal(held?.meta.stars, 5);
  assert.equal(await rate(), "busy");
  assert.equal(posts.length, 1);
  assert.deepEqual(await settleHeld(createOperations(() => storage, () => clock), "rate:trip-1", async () => "applied", () => clock), { kind: "done" });

  const sheet = readFileSync(new URL("../components/trip-sheet.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(sheet, /inFlight/);
  assert.match(sheet, /const operation = useOperation\(`rate:\$\{trip\.id\}`\);/);
  assert.match(sheet, /runOnce\(operations, `rate:\$\{trip\.id\}`, \(\) => sendStars\(trip\.id, bikeNumber, picked\), \{ keep: true, meta: \{ stars: picked \} \}\)/);
  assert.match(sheet, /\{operation \? <>[^\n]*>Vérifier<\/Button><\/> : <>[\s\S]*?Envoyer<\/Button>\n\s+<\/>\}/);
  assert.equal(sheet.match(/>Envoyer<\/Button>/g)?.length, 1);
  assert.match(sheet, /<Modal titleId="trip-detail-title" onClose=\{sending \? \(\) => \{\} : onClose\}>/);
  assert.match(sheet, /aria-label="Fermer" disabled=\{sending\} onClick=\{onClose\}/);
  assert.match(sheet, /<Modal titleId="trip-ended-title" onClose=\{sending \? \(\) => \{\} : close\}>/);
  assert.match(sheet, /aria-label="Fermer" disabled=\{sending\} onClick=\{close\}/);
});

test("R2: a rating the browser gave up on stays held while Vélo’v may still record it, and the browser waits past the 30 s route", async (t) => {
  const route = Number(/export const maxDuration = (\d+);/.exec(readFileSync(new URL("../app/api/trips/[id]/rate/route.ts", import.meta.url), "utf8"))![1]) * 1000;
  const waits: number[] = [];
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, "timeout", (ms: number) => { waits.push(ms); return timeout(ms); });
  const lost = [async () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); }, async () => Response.json(null, { status: 502 })];
  for (const answer of lost) {
    let clock = now;
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
    const tab = createOperations(() => storage, () => clock);
    const posts: string[] = [];
    const send = (async (url: string) => { posts.push(url); return answer(); }) as unknown as typeof fetch;
    const rate = () => runOnce(tab, "rate:trip-1", () => sendStars("trip-1", 20449, 4, send), { keep: true, meta: { stars: 4 } });
    const outcome = await rate();
    assert.ok(typeof outcome !== "string" && isUncertain(outcome));
    const notYetRated = async () => "unchanged" as const;
    clock += 1_000;
    assert.equal((await settleHeld(tab, "rate:trip-1", notYetRated, () => clock))?.kind, "uncertain", "the history may not show the rating yet");
    assert.equal(tab.get("rate:trip-1")?.status, "uncertain");
    assert.equal(await rate(), "busy", "no Vous pouvez réessayer while the first POST may still land");
    clock += HISTORY_LAG;
    assert.equal((await settleHeld(tab, "rate:trip-1", notYetRated, () => clock))?.kind, "refused");
    assert.equal(tab.get("rate:trip-1"), null);
    assert.equal(posts.length, 1);
  }
  assert.ok(waits.length === 2 && waits.every((ms) => ms > route), `${waits} ms against a ${route} ms route`);
});
