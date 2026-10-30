import assert from "node:assert/strict";
import { test } from "node:test";
import { assessBikes, lateCheck } from "../lib/bike-score.ts";
import { type Bike, fromNow } from "../lib/models.ts";

const now = Date.parse("2026-10-28T12:00:00Z");
const hoursAgo = (hours: number) => new Date(now - hours * 3_600_000).toISOString();

function bike(number: number, overrides: Partial<Bike> = {}): Bike {
  return {
    number, type: "mechanical", standNumber: number, status: "AVAILABLE", statusLabel: "Accroché", isReserved: false,
    rating: { value: 80, count: 10, lastAt: hoursAgo(30) }, batteryPercent: null, frameId: null,
    lastTripAt: hoursAgo(20), lastControlAt: null, nextCheckAt: null, lastSignalAt: null, nextReviewAt: null,
    ...overrides
  };
}

const verdicts = (bikes: Bike[]) => Object.fromEntries(assessBikes(bikes, now).map((item) => [item.bike.number, item.verdict]));
const only = (value: Bike) => assessBikes([value], now)[0];

test("each doubtful condition is enough to avoid a bike, with its reason", () => {
  const cases: [Partial<Bike>, string][] = [
    [{ rating: { value: 56, count: 5, lastAt: null } }, "Note basse (2,8/5)"],
    [{ nextCheckAt: hoursAgo(31 * 24) }, "Contrôle en retard"],
    [{ type: "electrical", batteryPercent: 12 }, "Batterie faible (12 %)"],
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
  for (const overrides of [{ rating: { value: 50, count: 4, lastAt: null } }, { lastTripAt: null }, { lastTripAt: hoursAgo(71) }, { nextCheckAt: hoursAgo(5 * 24) }, { type: "electrical", batteryPercent: 20 }, { type: "electrical", batteryPercent: null }, { status: null, statusLabel: null }] satisfies Partial<Bike>[]) {
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
  assert.deepEqual(only(bike(2, { rating: { value: 92, count: 30, lastAt: null }, lastTripAt: hoursAgo(2) })).reasons, ["Bien noté (4,6/5 · 30 avis)", "Utilisé il y a moins de 12 h"]);
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

test("a next check date in the past reads as late, with the planned date", () => {
  assert.equal(lateCheck("2026-10-12T10:00:00Z", now), "Prévu le 12 oct. 2026");
  assert.equal(lateCheck(hoursAgo(1), now), "Prévu le 28 oct. 2026");
  assert.equal(lateCheck("2026-11-20T10:00:00Z", now), null);
  assert.equal(lateCheck(null, now), null);
  assert.equal(lateCheck("not a date", now), null);
});

test("relative dates keep min, h and j short but spell out months and years", () => {
  const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
  assert.equal(fromNow(at(50 * 1440), now), "dans 1 mois");
  assert.equal(fromNow(at(-800 * 1440), now), "il y a 2 ans");
  assert.equal(fromNow(at(12), now), "dans 12\u00a0min");
  assert.equal(fromNow(at(-120), now), "il y a 2\u00a0h");
  assert.equal(fromNow(at(3 * 1440), now), "dans 3\u00a0j");
  assert.equal(fromNow(at(0.5), now), "à l’instant");
  assert.equal(fromNow(null, now), null);
});
