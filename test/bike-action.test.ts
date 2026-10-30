import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import { pollUnlock, sendBikeAction } from "../lib/bike-action.ts";
import { ACTION_TIMEOUT } from "../lib/operations.ts";
import { isUncertain } from "../lib/outcome.ts";

const realFetch = globalThis.fetch;
beforeEach(() => { globalThis.fetch = (() => { throw new Error("network call in a unit test"); }) as typeof fetch; });
afterEach(() => { globalThis.fetch = realFetch; });

const place = { stationNumber: 2002, standNumber: 12, bikeNumber: 20449 };

test("unlock and booking POSTs give up on their own before runOnce stops waiting and within the route limit", async (t) => {
  const waits: number[] = [];
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, "timeout", (ms: number) => { waits.push(ms); return timeout(ms); });
  for (const [action, route] of [["unlock", "unlock"], ["book", "bookings"]] as const) {
    const limit = Number(/export const maxDuration = (\d+);/.exec(readFileSync(new URL(`../app/api/${route}/route.ts`, import.meta.url), "utf8"))![1]) * 1000;
    waits.length = 0;
    const calls: { url: string; init?: RequestInit }[] = [];
    const send = (async (url: string, init?: RequestInit) => { calls.push({ url, init }); throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); }) as unknown as typeof fetch;
    const outcome = await sendBikeAction(action, place, send);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `/api/${route}`);
    assert.ok(calls[0].init?.signal instanceof AbortSignal, action);
    assert.equal(waits.length, 1, action);
    assert.ok(waits[0] < ACTION_TIMEOUT, action);
    assert.ok(waits[0] <= limit, action);
    assert.ok(isUncertain(outcome), action);
  }
});

async function flush() { for (let index = 0; index < 5; index++) await Promise.resolve(); }
async function run(t: { mock: { timers: { tick: (ms: number) => void } } }, seconds = 200) {
  for (let second = 0; second < seconds; second++) { t.mock.timers.tick(1000); await flush(); }
}

test("an uncertain unlock is re-read on the iOS schedule, then once more two minutes after the send, reads only", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const at = Date.now();
  const checks: number[] = [];
  pollUnlock(async () => { checks.push((Date.now() - at) / 1000); return false; }, at);
  await run(t);
  assert.deepEqual(checks, [2, 5, 10, 15, 20, 30, 40, 50, 60, 70, 120]);
});

test("the unlock poll stops once the trip is found, and when the sheet closes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  let found = 0;
  pollUnlock(async () => ++found === 3, Date.now());
  await run(t);
  assert.equal(found, 3);
  let closed = 0;
  const stop = pollUnlock(async () => { closed++; return false; }, Date.now());
  await run(t, 6);
  stop();
  await run(t);
  assert.equal(closed, 2);
});

test("a restored uncertain unlock resumes the remaining checks, or checks once when they have all passed", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const at = Date.now() - 45_000;
  const checks: number[] = [];
  pollUnlock(async () => { checks.push(Math.round((Date.now() - at) / 1000)); return false; }, at);
  await run(t);
  assert.deepEqual(checks, [50, 60, 70, 120]);
  let late = 0;
  pollUnlock(async () => { late++; return false; }, Date.now() - 10 * 60_000);
  await run(t);
  assert.equal(late, 1);
});

test("the bike sheet polls an uncertain unlock and lets the dock watch follow it", () => {
  const source = readFileSync(new URL("../components/bike-actions.tsx", import.meta.url), "utf8");
  assert.match(source, /pollUnlock\(/);
  assert.match(source, /isUncertain\(outcome\)\) account\?\.unlocked\(null\)/);
});
