import assert from "node:assert/strict";
import { test } from "node:test";
import { assessBikes } from "../lib/bike-score.ts";
import type { Bike } from "../lib/models.ts";

const now = Date.parse("2026-10-28T12:00:00Z");
const hoursAgo = (hours: number) => new Date(now - hours * 3_600_000).toISOString();

function bike(number: number, overrides: Partial<Bike> = {}): Bike {
  return {
    number, type: "mechanical", standNumber: number, status: "AVAILABLE", statusLabel: "Accroché", isReserved: false,
    rating: { value: 80, count: 10, lastAt: hoursAgo(30) }, batteryPercent: null, frameId: null,
    lastTripAt: hoursAgo(20), lastRevisionAt: null, lastControlAt: null, nextCheckAt: null, lastSignalAt: null, nextReviewAt: null, createdAt: null,
    ...overrides
  };
}

const verdicts = (bikes: Bike[]) => Object.fromEntries(assessBikes(bikes, now).map((item) => [item.bike.number, item.verdict]));
const only = (value: Bike) => assessBikes([value], now)[0];

test("each doubtful condition is enough to avoid a bike, with its reason", () => {
  const cases: [Partial<Bike>, string][] = [
    [{ rating: { value: 56, count: 5, lastAt: null } }, "Note basse (2,8/5)"],
    [{ nextCheckAt: hoursAgo(1) }, "Contrôle en retard"],
    [{ type: "electrical", batteryPercent: 12 }, "Batterie faible (12 %)"],
    [{ lastTripAt: hoursAgo(4 * 24 + 3) }, "Pas utilisé depuis 4 j"],
    [{ status: "RENTED", statusLabel: "En location" }, "Indisponible (En location)"],
    [{ isReserved: true }, "Réservé"]
  ];
  for (const [overrides, reason] of cases) {
    const result = only(bike(1, overrides));
    assert.equal(result.verdict, "avoid", reason);
    assert.deepEqual(result.reasons, [reason]);
  }
});

test("missing data and thresholds just inside the limits do not count against a bike", () => {
  for (const overrides of [{ rating: { value: 50, count: 4, lastAt: null } }, { lastTripAt: null }, { lastTripAt: hoursAgo(71) }, { nextCheckAt: new Date(now + 3_600_000).toISOString() }, { type: "electrical", batteryPercent: 20 }, { type: "electrical", batteryPercent: null }] satisfies Partial<Bike>[]) {
    assert.notEqual(only(bike(1, overrides)).verdict, "avoid", JSON.stringify(overrides));
  }
});

test("a perfect rating from one vote ranks below a solid rating from many", () => {
  const [first, second] = assessBikes([bike(1, { rating: { value: 100, count: 1, lastAt: null } }), bike(2, { rating: { value: 85, count: 20, lastAt: null } })], now);
  assert.equal(second.score, 71.5);
  assert.equal(first.bike.number, 2);
  assert.equal(first.score, 85);
});

test("only the best bike of each type is recommended", () => {
  const result = verdicts([
    bike(1, { rating: { value: 80, count: 10, lastAt: null } }),
    bike(2, { rating: { value: 92, count: 30, lastAt: null } }),
    bike(3, { type: "electrical", batteryPercent: 90, rating: { value: 90, count: 12, lastAt: null } }),
    bike(4, { type: "electrical", batteryPercent: 40, rating: { value: 90, count: 12, lastAt: null } })
  ]);
  assert.deepEqual(result, { 1: "neutral", 2: "recommended", 3: "recommended", 4: "neutral" });
  assert.deepEqual(only(bike(2, { rating: { value: 92, count: 30, lastAt: null }, lastTripAt: hoursAgo(2) })).reasons, ["Bien noté (4,6/5 · 30 avis)", "Utilisé il y a moins de 12 h"]);
});

test("nothing is recommended when the best bikes are weak or barely rated", () => {
  assert.deepEqual(verdicts([
    bike(1, { rating: { value: 74, count: 40, lastAt: null } }),
    bike(2, { rating: null }),
    bike(3, { type: "electrical", batteryPercent: 80, rating: { value: 100, count: 2, lastAt: null } }),
    bike(4, { type: "electrical", batteryPercent: 10, rating: { value: 95, count: 40, lastAt: null } })
  ]), { 1: "neutral", 2: "neutral", 3: "neutral", 4: "avoid" });
});

test("the list puts the recommended bikes first and the ones to avoid last", () => {
  const order = assessBikes([
    bike(1, { isReserved: true }),
    bike(2, { rating: { value: 70, count: 20, lastAt: null } }),
    bike(3, { rating: { value: 95, count: 20, lastAt: null } }),
    bike(4, { rating: { value: 78, count: 20, lastAt: null } })
  ], now).map((item) => item.bike.number);
  assert.deepEqual(order, [3, 4, 2, 1]);
});
