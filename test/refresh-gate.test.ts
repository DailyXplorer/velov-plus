import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { REFRESH_INTERVAL, createRefreshGate, createRevisionLoader } from "../lib/refresh-gate.ts";

test("Actualiser ignores clicks while a refresh is in flight and waits 5 s between two refreshes", () => {
  let clock = 1_000_000;
  const gate = createRefreshGate(REFRESH_INTERVAL, () => clock);
  assert.equal(REFRESH_INTERVAL, 5_000);
  assert.equal(gate(true), false);
  assert.equal(gate(false), true);
  let accepted = 0;
  for (let second = 0; second < 60; second++) { clock += 1_000; if (gate(false)) accepted++; }
  assert.equal(accepted, 12);
  clock += 10_000;
  assert.equal(gate(true), false);
  assert.equal(gate(false), true);
  const companion = readFileSync(new URL("../components/companion.tsx", import.meta.url), "utf8");
  assert.match(companion, /if \(!refreshGate\.current\(dashboard\.busy\(\) \|\| stationsInFlight\.current\)\) return;/);
  assert.match(companion, /aria-label="Actualiser mon compte" onClick=\{refreshAll\}/);
});

function deferredLoads() {
  const pending: ((value: string) => void)[] = [];
  let calls = 0;
  return { pending, get calls() { return calls; }, load: () => { calls++; return new Promise<string | null>((resolve) => pending.push(resolve)); } };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("a dashboard started before a change is dropped, and exactly one reload follows", async () => {
  const loads = deferredLoads();
  const shown: string[] = [];
  const dashboard = createRevisionLoader(loads.load, (value) => shown.push(value));
  const first = dashboard.request();
  assert.equal(dashboard.busy(), true);
  dashboard.bump();
  dashboard.bump();
  const asked = dashboard.request();
  loads.pending.shift()!("before the favourite");
  await settle();
  assert.deepEqual(shown, [], "the stale answer never replaces the patched data");
  assert.equal(loads.calls, 2);
  loads.pending.shift()!("after the favourite");
  assert.equal(await first, null);
  assert.equal(await asked, "after the favourite");
  assert.deepEqual(shown, ["after the favourite"]);
  assert.equal(loads.calls, 2);
  assert.equal(dashboard.busy(), false);
});

test("a reload asked while one runs is queued once instead of dropped", async () => {
  const loads = deferredLoads();
  const shown: string[] = [];
  const dashboard = createRevisionLoader(loads.load, (value) => shown.push(value));
  void dashboard.request();
  const again = [dashboard.request(), dashboard.request(), dashboard.request()];
  loads.pending.shift()!("first");
  await settle();
  loads.pending.shift()!("second");
  assert.deepEqual(await Promise.all(again), ["second", "second", "second"]);
  assert.deepEqual(shown, ["first", "second"]);
  assert.equal(loads.calls, 2);
});

test("the ongoing banner leaves out a trip already docked", () => {
  assert.match(readFileSync("components/companion.tsx", "utf8"), /ongoing: data\.ongoing\?\.filter\(\(trip\) => !dockedTrips\.current\.has\(trip\.id\)\) \?\? null/);
});
