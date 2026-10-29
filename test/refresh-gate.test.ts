import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { REFRESH_INTERVAL, createRefreshGate } from "../lib/refresh-gate.ts";

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
  assert.match(companion, /if \(!refreshGate\.current\(dashboardInFlight\.current \|\| stationsInFlight\.current\)\) return;/);
  assert.match(companion, /aria-label="Actualiser mon compte" onClick=\{refreshAll\}/);
});
