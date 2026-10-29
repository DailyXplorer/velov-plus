import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import { sendBikeAction } from "../lib/bike-action.ts";
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
