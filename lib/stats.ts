// Trip statistics: pure aggregation of the whole history, free of "server-only" so tests and the client can import it.
import { z } from "zod";
import { haversine, type Point } from "./geo.ts";
import type { Trip } from "./models.ts";

/** Vélo’v gives no distance: the straight line between the two stations, lengthened for the streets. */
export const DETOUR_FACTOR = 1.3;
/** Order of magnitude for a petrol car in town, in grams of CO₂ per km. */
export const CO2_GRAMS_PER_KM = 200;
export const MAX_PAGES = 50;
export const PERIODS = ["30d", "12m", "all"] as const;
export type Period = (typeof PERIODS)[number];
export const DURATION_BUCKETS = [{ label: "0-5", max: 5 }, { label: "5-10", max: 10 }, { label: "10-20", max: 20 }, { label: "20-30", max: 30 }, { label: "30+", max: Infinity }] as const;
const TOP = 5;

const count = z.number().int().nonnegative();
const stationCount = z.object({ number: z.number().nullable(), name: z.string(), count });
export const periodStatsSchema = z.object({
  trips: count, minutes: count,
  // metres: sum over `known` trips; `unknown`: no station, or a station no longer in the open data.
  distance: z.object({ metres: z.number(), known: count, unknown: count }),
  co2Grams: z.number(), spentCents: z.number(), savedCents: z.number(), pointsEarned: z.number(),
  withoutStations: count,
  series: z.object({ unit: z.enum(["day", "month"]), buckets: z.array(z.object({ key: z.string(), minutes: count, trips: count, balance: z.number().nullable() })) }),
  // Seven rows, Monday first, of 24 hours (Paris time).
  heatmap: z.array(z.array(count)),
  bikeTypes: z.object({ mechanical: count, electrical: count, unknown: count }),
  durations: z.array(z.object({ label: z.string(), count })),
  starts: z.array(stationCount), ends: z.array(stationCount),
  pairs: z.array(z.object({ from: z.string(), to: z.string(), count })),
  records: z.object({
    longest: z.object({ minutes: count, startedAt: z.string().nullable(), from: z.string().nullable(), to: z.string().nullable() }).nullable(),
    busiestDay: z.object({ day: z.string(), trips: count, minutes: count }).nullable(),
    streak: z.object({ days: count, from: z.string(), to: z.string() }).nullable(),
    bike: z.object({ number: z.number(), count, type: z.enum(["mechanical", "electrical", "unknown"]) }).nullable()
  })
});
export const statsSchema = z.object({
  periods: z.object({ "30d": periodStatsSchema, "12m": periodStatsSchema, all: periodStatsSchema }),
  // false: a page of history failed or the page cap was hit, so older trips may be missing.
  complete: z.boolean(), pointsAvailable: z.boolean(), generatedAt: z.string()
});
export type PeriodStats = z.infer<typeof periodStatsSchema>;
export type Stats = z.infer<typeof statsSchema>;
export type Movement = { date: string | null; amount: number };
export type StatsInput = { trips: Trip[]; coords: Map<number, Point>; movements: Movement[] | null; balance: number | null; complete: boolean; now: Date };

/**
 * Reads a paged list once, page after page: stops at the first empty page, at a page that brings nothing new
 * (a server that ignores `page` repeats itself), or after `maxPages`. A failure after the first page keeps what was read.
 */
export async function collectPages<T>(fetchPage: (page: number) => Promise<T[]>, idOf: (item: T) => string, maxPages = MAX_PAGES): Promise<{ items: T[]; complete: boolean }> {
  const items: T[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < maxPages; page++) {
    let batch: T[];
    try { batch = await fetchPage(page); } catch (error) {
      if (page === 0) throw error;
      return { items, complete: false };
    }
    const fresh = batch.filter((item) => !seen.has(idOf(item)));
    if (!fresh.length) return { items, complete: true };
    for (const item of fresh) { seen.add(idOf(item)); items.push(item); }
  }
  return { items, complete: false };
}

/** Metres: null without both stations or their coordinates, 0 for a loop back to the same station. */
export function estimateDistance(trip: Pick<Trip, "startStationNumber" | "endStationNumber">, coords: Map<number, Point>) {
  const { startStationNumber: start, endStationNumber: end } = trip;
  if (start == null || end == null) return null;
  if (start === end) return 0;
  const from = coords.get(start);
  const to = coords.get(end);
  return from && to ? haversine(from, to) * DETOUR_FACTOR : null;
}

const parisParts = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" });
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Calendar day ("2026-10-29"), month ("2026-10"), hour and weekday (Monday 0) in Lyon. */
export function parisTime(value: string | Date) {
  const parts = Object.fromEntries(parisParts.formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, month: `${parts.year}-${parts.month}`, hour: Number(parts.hour), weekday: WEEKDAYS.indexOf(parts.weekday) };
}

export function shiftDay(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function shiftMonth(month: string, months: number) {
  const [year, index] = month.split("-").map(Number);
  return new Date(Date.UTC(year, index - 1 + months, 1)).toISOString().slice(0, 7);
}

function range(first: string, last: string, next: (key: string) => string) {
  const keys: string[] = [];
  for (let key = first; key <= last; key = next(key)) keys.push(key);
  return keys;
}

/** Most counted first, ties by name, so the order is stable. */
function top<T extends { count: number }>(values: Iterable<T>, label: (value: T) => string, minimum = 1) {
  return [...values].filter((value) => value.count >= minimum).sort((left, right) => right.count - left.count || label(left).localeCompare(label(right), "fr")).slice(0, TOP);
}

function stationTally(trips: Trip[], side: "start" | "end") {
  const tally = new Map<string, { number: number | null; name: string; count: number }>();
  for (const trip of trips) {
    const number = side === "start" ? trip.startStationNumber : trip.endStationNumber;
    const name = side === "start" ? trip.startStation : trip.endStation;
    if (number == null && !name) continue;
    const key = number != null ? `#${number}` : name!;
    const entry = tally.get(key) ?? { number, name: name ?? `Station ${number}`, count: 0 };
    entry.count++;
    tally.set(key, entry);
  }
  return top(tally.values(), (value) => value.name);
}

type Streak = { days: number; from: string; to: string };
function longestStreak(days: string[]) {
  let best: Streak | null = null;
  let current: Streak | null = null;
  for (const day of [...new Set(days)].sort()) {
    const next: Streak = current && shiftDay(current.to, 1) === day ? { days: current.days + 1, from: current.from, to: day } : { days: 1, from: day, to: day };
    if (!best || next.days > best.days) best = next;
    current = next;
  }
  return best;
}

export function periodStats(period: Period, { trips: history, coords, movements, balance, now }: StatsInput): PeriodStats {
  const today = parisTime(now);
  const unit = period === "30d" ? "day" : "month";
  const located = history.filter((trip) => trip.status !== "REVERSED").map((trip) => ({ trip, at: trip.startedAt ? parisTime(trip.startedAt) : null }));
  const firstMonth = located.reduce<string>((first, { at }) => at && at.month < first ? at.month : first, today.month);
  const start = period === "30d" ? shiftDay(today.day, -29) : period === "12m" ? shiftMonth(today.month, -11) : firstMonth;
  const keyOf = (at: ReturnType<typeof parisTime>) => unit === "day" ? at.day : at.month;
  const inPeriod = located.filter(({ at }) => period === "all" || (at != null && keyOf(at) >= start));
  const trips = inPeriod.map(({ trip }) => trip);

  const keys = unit === "day" ? range(start, today.day, (key) => shiftDay(key, 1)) : range(start, today.month, (key) => shiftMonth(key, 1));
  const dated = (movements ?? []).flatMap((movement) => movement.date ? [{ key: keyOf(parisTime(movement.date)), amount: movement.amount }] : []);
  // The balance at the end of a bucket: today's balance minus what came after, or the running sum when it is unknown.
  const balanceAt = (key: string) => balance != null
    ? balance - dated.filter((movement) => movement.key > key).reduce((sum, movement) => sum + movement.amount, 0)
    : dated.filter((movement) => movement.key <= key).reduce((sum, movement) => sum + movement.amount, 0);
  const buckets = new Map(keys.map((key) => [key, { key, minutes: 0, trips: 0, balance: movements ? balanceAt(key) : null }]));
  const heatmap = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  const days = new Map<string, { day: string; trips: number; minutes: number }>();
  for (const { trip, at } of inPeriod) {
    if (!at) continue;
    const bucket = buckets.get(keyOf(at));
    if (bucket) { bucket.trips++; bucket.minutes += trip.duration ?? 0; }
    heatmap[at.weekday][at.hour]++;
    const day = days.get(at.day) ?? { day: at.day, trips: 0, minutes: 0 };
    day.trips++;
    day.minutes += trip.duration ?? 0;
    days.set(at.day, day);
  }

  const distances = trips.map((trip) => estimateDistance(trip, coords));
  const metres = distances.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const durations = DURATION_BUCKETS.map((bucket, index) => ({
    label: bucket.label,
    count: trips.filter((trip) => trip.duration != null && trip.duration >= (DURATION_BUCKETS[index - 1]?.max ?? 0) && trip.duration < bucket.max).length
  }));
  const pairs = new Map<string, { from: string; to: string; count: number }>();
  for (const trip of trips) {
    if (!trip.startStation || !trip.endStation) continue;
    const key = `${trip.startStationNumber ?? trip.startStation}→${trip.endStationNumber ?? trip.endStation}`;
    const pair = pairs.get(key) ?? { from: trip.startStation, to: trip.endStation, count: 0 };
    pair.count++;
    pairs.set(key, pair);
  }
  const bikes = new Map<number, { number: number; count: number; type: Trip["bikeType"]; last: string }>();
  for (const trip of trips) {
    if (trip.bikeNumber == null) continue;
    const bike = bikes.get(trip.bikeNumber) ?? { number: trip.bikeNumber, count: 0, type: trip.bikeType, last: "" };
    bike.count++;
    if ((trip.startedAt ?? "") >= bike.last) { bike.last = trip.startedAt ?? ""; bike.type = trip.bikeType; }
    bikes.set(trip.bikeNumber, bike);
  }
  const bike = [...bikes.values()].sort((left, right) => right.count - left.count || right.last.localeCompare(left.last))[0];
  const longest = trips.filter((trip) => trip.duration != null).sort((left, right) => right.duration! - left.duration! || (right.startedAt ?? "").localeCompare(left.startedAt ?? ""))[0];
  const busiestDay = [...days.values()].sort((left, right) => right.trips - left.trips || right.minutes - left.minutes || right.day.localeCompare(left.day))[0];
  const earned = movements
    ? dated.filter((movement) => movement.amount > 0 && (period === "all" || movement.key >= start)).reduce((sum, movement) => sum + movement.amount, 0)
    : trips.reduce((sum, trip) => sum + trip.pointsEarned, 0);

  return {
    trips: trips.length,
    minutes: trips.reduce((sum, trip) => sum + (trip.duration ?? 0), 0),
    distance: { metres: Math.round(metres), known: distances.filter((value) => value != null).length, unknown: distances.filter((value) => value == null).length },
    co2Grams: Math.round(metres / 1000 * CO2_GRAMS_PER_KM),
    spentCents: trips.reduce((sum, trip) => sum + Math.max(0, trip.price ?? 0), 0),
    savedCents: trips.reduce((sum, trip) => sum + Math.max(0, trip.discount), 0),
    pointsEarned: earned,
    withoutStations: trips.filter((trip) => !trip.startStation && !trip.endStation).length,
    series: { unit, buckets: [...buckets.values()] },
    heatmap,
    bikeTypes: { mechanical: trips.filter((trip) => trip.bikeType === "mechanical").length, electrical: trips.filter((trip) => trip.bikeType === "electrical").length, unknown: trips.filter((trip) => trip.bikeType === "unknown").length },
    durations,
    starts: stationTally(trips, "start"), ends: stationTally(trips, "end"),
    pairs: top(pairs.values(), (pair) => `${pair.from} ${pair.to}`, 2),
    records: {
      longest: longest ? { minutes: longest.duration!, startedAt: longest.startedAt, from: longest.startStation, to: longest.endStation } : null,
      busiestDay: busiestDay ?? null,
      streak: longestStreak([...days.keys()]),
      bike: bike ? { number: bike.number, count: bike.count, type: bike.type } : null
    }
  };
}

export function buildStats(input: StatsInput): Stats {
  return {
    periods: { "30d": periodStats("30d", input), "12m": periodStats("12m", input), all: periodStats("all", input) },
    complete: input.complete, pointsAvailable: input.movements != null, generatedAt: input.now.toISOString()
  };
}
