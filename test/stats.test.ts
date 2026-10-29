import assert from "node:assert/strict";
import { test } from "node:test";
import { DETOUR_FACTOR, buildStats, collectPages, estimateDistance, parisTime, periodStats, type StatsInput } from "../lib/stats.ts";
import { haversine } from "../lib/geo.ts";
import type { Trip } from "../lib/models.ts";

const bellecour = { lat: 45.7578, lon: 4.8320 };
const partDieu = { lat: 45.7606, lon: 4.8594 };
const coords = new Map([[2002, bellecour], [3001, partDieu]]);
const now = new Date("2026-10-29T12:00:00Z");
let next = 0;
function trip(startedAt: string, change: Partial<Trip> = {}): Trip {
  return {
    id: `t${next++}`, status: "FINISHED", startedAt, endedAt: null, startStation: "Bellecour", endStation: "Part-Dieu",
    startStationNumber: 2002, endStationNumber: 3001, startStand: null, endStand: null, distance: null, bikeNumber: 10, bikeType: "mechanical",
    duration: 12, price: 0, fullPrice: 0, discount: 0, pointsEarned: 0, pointsSpent: 0, litigious: false, isRated: true, token: null, origin: 4, ...change
  };
}
const input = (trips: Trip[], change: Partial<StatsInput> = {}): StatsInput => ({ trips, coords, movements: null, balance: null, complete: true, now, ...change });

test("distance: haversine × 1.3 between stations, 0 for a loop, unknown without a station or its coordinates", () => {
  const across = estimateDistance({ startStationNumber: 2002, endStationNumber: 3001 }, coords);
  assert.equal(across, haversine(bellecour, partDieu) * DETOUR_FACTOR);
  assert.equal(estimateDistance({ startStationNumber: 2002, endStationNumber: 2002 }, coords), 0);
  assert.equal(estimateDistance({ startStationNumber: null, endStationNumber: 3001 }, coords), null);
  assert.equal(estimateDistance({ startStationNumber: 2002, endStationNumber: 9999 }, coords), null);
});

test("totals count every kept trip and say how many lack a distance or their stations", () => {
  const wiped = { startStation: null, endStation: null, startStationNumber: null, endStationNumber: null, bikeNumber: null };
  const stats = periodStats("all", input([
    trip("2026-10-20T07:00:00Z", { duration: 10, price: 100, discount: 50, pointsEarned: 5 }),
    trip("2026-10-21T07:00:00Z", { duration: 20, endStation: "Bellecour", endStationNumber: 2002 }),
    trip("2026-10-22T07:00:00Z", { duration: 30, ...wiped }),
    trip("2026-10-23T07:00:00Z", { status: "REVERSED", duration: 99 })
  ]));
  assert.equal(stats.trips, 3);
  assert.equal(stats.minutes, 60);
  assert.deepEqual({ known: stats.distance.known, unknown: stats.distance.unknown }, { known: 2, unknown: 1 });
  assert.equal(stats.distance.metres, Math.round(haversine(bellecour, partDieu) * DETOUR_FACTOR));
  assert.equal(stats.co2Grams, Math.round(stats.distance.metres / 1000 * 200));
  assert.equal(stats.withoutStations, 1);
  assert.deepEqual([stats.spentCents, stats.savedCents, stats.pointsEarned], [100, 50, 5]);
});

test("periods: 30 days by day and 12 months by month, in Paris time", () => {
  const trips = [trip("2026-10-28T23:30:00Z"), trip("2026-09-29T22:30:00Z"), trip("2025-11-15T08:00:00Z"), trip("2025-10-31T08:00:00Z")];
  const days = periodStats("30d", input(trips));
  assert.equal(days.series.unit, "day");
  assert.equal(days.series.buckets.length, 30);
  assert.deepEqual([days.series.buckets[0].key, days.series.buckets.at(-1)!.key], ["2026-09-30", "2026-10-29"]);
  // 23:30 UTC is already the next day in Lyon; 22:30 UTC on 29/09 is 00:30 on 30/09, the first day of the window.
  assert.equal(days.series.buckets.at(-1)!.trips, 1);
  assert.equal(days.trips, 2);
  const months = periodStats("12m", input(trips));
  assert.equal(months.series.buckets.length, 12);
  assert.equal(months.series.buckets[0].key, "2025-11");
  assert.equal(months.trips, 3);
  const all = periodStats("all", input(trips));
  assert.equal(all.series.buckets[0].key, "2025-10");
  assert.equal(all.trips, 4);
});

test("heatmap: Monday first, local hour", () => {
  assert.deepEqual(parisTime("2026-10-26T07:15:00Z"), { day: "2026-10-26", month: "2026-10", hour: 8, weekday: 0 });
  const stats = periodStats("all", input([trip("2026-10-26T07:15:00Z"), trip("2026-10-25T17:00:00Z")]));
  assert.equal(stats.heatmap[0][8], 1);
  assert.equal(stats.heatmap[6][18], 1);
  assert.equal(stats.heatmap.flat().reduce((sum, value) => sum + value, 0), 2);
});

test("duration buckets: lower bound included, upper excluded, unknown durations left out", () => {
  const stats = periodStats("all", input([0, 4, 5, 10, 19, 20, 30, 75].map((duration, index) => trip(`2026-10-0${index + 1}T08:00:00Z`, { duration })).concat(trip("2026-10-09T08:00:00Z", { duration: null }))));
  assert.deepEqual(stats.durations, [{ label: "0-5", count: 2 }, { label: "5-10", count: 1 }, { label: "10-20", count: 2 }, { label: "20-30", count: 1 }, { label: "30+", count: 2 }]);
});

test("streak: longest run of consecutive local days; busiest day and longest trip", () => {
  const stats = periodStats("all", input([
    trip("2026-10-01T08:00:00Z"), trip("2026-10-02T08:00:00Z"), trip("2026-10-02T17:00:00Z", { duration: 45 }), trip("2026-10-03T08:00:00Z"),
    trip("2026-10-10T08:00:00Z"), trip("2026-10-11T08:00:00Z")
  ]));
  assert.deepEqual(stats.records.streak, { days: 3, from: "2026-10-01", to: "2026-10-03" });
  assert.deepEqual(stats.records.busiestDay, { day: "2026-10-02", trips: 2, minutes: 57 });
  assert.equal(stats.records.longest?.minutes, 45);
  assert.equal(periodStats("all", input([])).records.streak, null);
});

test("top stations and favourite pairs: counted, sorted, pairs seen at least twice", () => {
  const back = { startStation: "Part-Dieu", startStationNumber: 3001, endStation: "Bellecour", endStationNumber: 2002 };
  const stats = periodStats("all", input([
    trip("2026-10-01T08:00:00Z"), trip("2026-10-02T08:00:00Z"), trip("2026-10-03T08:00:00Z"),
    trip("2026-10-01T18:00:00Z", back), trip("2026-10-02T18:00:00Z", { ...back, bikeNumber: 77, bikeType: "electrical" }),
    trip("2026-10-04T18:00:00Z", { ...back, endStation: "Perrache", endStationNumber: 4004 })
  ]));
  assert.deepEqual(stats.starts, [{ number: 2002, name: "Bellecour", count: 3 }, { number: 3001, name: "Part-Dieu", count: 3 }]);
  assert.deepEqual(stats.ends.map((station) => [station.name, station.count]), [["Part-Dieu", 3], ["Bellecour", 2], ["Perrache", 1]]);
  assert.deepEqual(stats.pairs, [{ from: "Bellecour", to: "Part-Dieu", count: 3 }, { from: "Part-Dieu", to: "Bellecour", count: 2 }]);
  assert.deepEqual(stats.records.bike, { number: 10, count: 5, type: "mechanical" });
  assert.deepEqual(stats.bikeTypes, { mechanical: 5, electrical: 1, unknown: 0 });
});

test("points: balance per bucket anchored on today's balance, earned points from the movements", () => {
  const movements = [{ date: "2026-10-10T08:00:00Z", amount: 20 }, { date: "2026-10-20T08:00:00Z", amount: -10 }, { date: "2025-01-05T08:00:00Z", amount: 50 }];
  const stats = periodStats("30d", input([], { movements, balance: 100 }));
  const at = (key: string) => stats.series.buckets.find((bucket) => bucket.key === key)?.balance;
  assert.deepEqual([at("2026-10-09"), at("2026-10-10"), at("2026-10-20"), at("2026-10-29")], [90, 110, 100, 100]);
  assert.equal(stats.pointsEarned, 20);
  assert.equal(periodStats("all", input([], { movements, balance: null })).series.buckets.at(-1)?.balance, 60);
  assert.equal(periodStats("30d", input([])).series.buckets[0].balance, null);
});

test("an empty history gives zeros, not errors", () => {
  const stats = buildStats(input([]));
  assert.equal(stats.periods.all.trips, 0);
  assert.equal(stats.periods.all.series.buckets.length, 1);
  assert.equal(stats.periods["12m"].records.longest, null);
  assert.equal(stats.pointsAvailable, false);
});

test("pagination: sequential pages, stops at the first empty page", async () => {
  const pages = [["a", "b"], ["c"], [], ["never"]];
  const asked: number[] = [];
  const result = await collectPages(async (page) => { asked.push(page); return pages[page] ?? []; }, (id) => id);
  assert.deepEqual(result, { items: ["a", "b", "c"], complete: true });
  assert.deepEqual(asked, [0, 1, 2]);
});

test("pagination: a server ignoring `page` costs one extra read, never fifty", async () => {
  let calls = 0;
  const result = await collectPages(async () => { calls++; return ["a", "b"]; }, (id) => id);
  assert.deepEqual(result, { items: ["a", "b"], complete: true });
  assert.equal(calls, 2);
});

test("pagination: hard cap of 50 pages, then marked incomplete", async () => {
  let calls = 0;
  const result = await collectPages(async (page) => { calls++; return [String(page)]; }, (id) => id);
  assert.equal(calls, 50);
  assert.equal(result.complete, false);
});

test("pagination: a later failure keeps the pages read, a first failure is thrown", async () => {
  const later = await collectPages(async (page) => { if (page === 1) throw new Error("502"); return ["a"]; }, (id) => id);
  assert.deepEqual(later, { items: ["a"], complete: false });
  await assert.rejects(collectPages<string>(async () => { throw new Error("401"); }, (id) => id));
});

test("pagination over a mocked fetch: pages requested one at a time, never in parallel", async () => {
  const original = globalThis.fetch;
  let open = 0;
  let peak = 0;
  const urls: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    open++; peak = Math.max(peak, open);
    urls.push(String(url));
    await new Promise((resolve) => setTimeout(resolve, 5));
    open--;
    const page = Number(new URL(String(url)).searchParams.get("page"));
    return new Response(JSON.stringify(page < 2 ? [{ id: `p${page}` }] : []), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await collectPages(async (page) => (await (await fetch(`https://example.test/trips?page=${page}`)).json()) as { id: string }[], (item) => item.id);
    assert.equal(result.items.length, 2);
    assert.equal(peak, 1);
    assert.equal(urls.length, 3);
  } finally { globalThis.fetch = original; }
});
