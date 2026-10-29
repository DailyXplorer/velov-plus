import { z } from "zod";
import { haversine, type Point } from "./geo.ts";
import type { Trip } from "./models.ts";

export const DETOUR_FACTOR = 1.3;
export const CO2_GRAMS_PER_KM = 200;
export const MAX_PAGES = 50;
export const COMPLETE_TTL = 10 * 60_000;
export const PARTIAL_TTL = 60_000;
export const PERIODS = ["30d", "12m", "all"] as const;
export type Period = (typeof PERIODS)[number];
const TOP = 5;

const count = z.number().int().nonnegative();
export const periodStatsSchema = z.object({
  trips: count, minutes: count,
  distance: z.object({ metres: z.number(), known: count }),
  co2Grams: z.number(), spentCents: z.number(), savedCents: z.number(), pointsEarned: z.number(),
  series: z.object({ unit: z.enum(["day", "month"]), buckets: z.array(z.object({ key: z.string(), minutes: count, trips: count })) }),
  heatmap: z.array(z.array(count)),
  bikeTypes: z.object({ mechanical: count, electrical: count, unknown: count }),
  stations: z.array(z.object({ name: z.string(), count })),
  records: z.object({ longestMinutes: count.nullable(), busiestDayTrips: count.nullable(), streakDays: count.nullable(), bike: z.number().nullable() })
});
export const statsSchema = z.object({
  periods: z.object({ "30d": periodStatsSchema, "12m": periodStatsSchema, all: periodStatsSchema }),
  balance: z.number().nullable(),
  complete: z.boolean()
});
export type PeriodStats = z.infer<typeof periodStatsSchema>;
export type Stats = z.infer<typeof statsSchema>;
export type Movement = { date: string | null; amount: number };
export type StatsInput = { trips: Trip[]; coords: Map<number, Point>; movements: Movement[] | null; balance: number | null; now: Date; complete?: boolean };

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

function favouriteStations(trips: Trip[]) {
  const tally = new Map<string, { name: string; count: number }>();
  for (const trip of trips) {
    for (const [number, name] of [[trip.startStationNumber, trip.startStation], [trip.endStationNumber, trip.endStation]] as const) {
      if (number == null && !name) continue;
      const key = number != null ? `#${number}` : name!;
      const entry = tally.get(key) ?? { name: name ?? `Station ${number}`, count: 0 };
      entry.count++;
      tally.set(key, entry);
    }
  }
  return [...tally.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "fr")).slice(0, TOP);
}

function longestStreak(days: string[]) {
  let best = 0;
  let current = 0;
  let previous = "";
  for (const day of [...new Set(days)].sort()) {
    current = previous && shiftDay(previous, 1) === day ? current + 1 : 1;
    best = Math.max(best, current);
    previous = day;
  }
  return best || null;
}

export function periodStats(period: Period, { trips: history, coords, movements, now }: StatsInput): PeriodStats {
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
  const buckets = new Map(keys.map((key) => [key, { key, minutes: 0, trips: 0 }]));
  const heatmap = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  const days = new Map<string, number>();
  for (const { trip, at } of inPeriod) {
    if (!at) continue;
    const bucket = buckets.get(keyOf(at));
    if (bucket) { bucket.trips++; bucket.minutes += trip.duration ?? 0; }
    heatmap[at.weekday][at.hour]++;
    days.set(at.day, (days.get(at.day) ?? 0) + 1);
  }

  const distances = trips.flatMap((trip) => estimateDistance(trip, coords) ?? []);
  const metres = distances.reduce((sum, value) => sum + value, 0);
  const bikes = new Map<number, { number: number; count: number; last: string }>();
  for (const trip of trips) {
    if (trip.bikeNumber == null) continue;
    const bike = bikes.get(trip.bikeNumber) ?? { number: trip.bikeNumber, count: 0, last: "" };
    bike.count++;
    if ((trip.startedAt ?? "") > bike.last) bike.last = trip.startedAt ?? "";
    bikes.set(trip.bikeNumber, bike);
  }
  const bike = [...bikes.values()].sort((left, right) => right.count - left.count || right.last.localeCompare(left.last))[0];
  const durations = trips.flatMap((trip) => trip.duration != null ? [trip.duration] : []);
  const earned = movements
    ? dated.filter((movement) => movement.amount > 0 && (period === "all" || movement.key >= start)).reduce((sum, movement) => sum + movement.amount, 0)
    : trips.reduce((sum, trip) => sum + trip.pointsEarned, 0);

  return {
    trips: trips.length,
    minutes: trips.reduce((sum, trip) => sum + (trip.duration ?? 0), 0),
    distance: { metres: Math.round(metres), known: distances.length },
    co2Grams: Math.round(metres / 1000 * CO2_GRAMS_PER_KM),
    spentCents: trips.reduce((sum, trip) => sum + Math.max(0, trip.price ?? 0), 0),
    savedCents: trips.reduce((sum, trip) => sum + Math.max(0, trip.discount), 0),
    pointsEarned: earned,
    series: { unit, buckets: [...buckets.values()] },
    heatmap,
    bikeTypes: { mechanical: trips.filter((trip) => trip.bikeType === "mechanical").length, electrical: trips.filter((trip) => trip.bikeType === "electrical").length, unknown: trips.filter((trip) => trip.bikeType === "unknown").length },
    stations: favouriteStations(trips),
    records: {
      longestMinutes: durations.length ? Math.max(...durations) : null,
      busiestDayTrips: days.size ? Math.max(...days.values()) : null,
      streakDays: longestStreak([...days.keys()]),
      bike: bike?.number ?? null
    }
  };
}

export function buildStats(input: StatsInput): Stats {
  return {
    periods: { "30d": periodStats("30d", input), "12m": periodStats("12m", input), all: periodStats("all", input) },
    balance: input.balance ?? input.movements?.reduce((sum, movement) => sum + movement.amount, 0) ?? null,
    complete: input.complete ?? true
  };
}

export function statsTtl(stats: Stats) {
  return stats.complete ? COMPLETE_TTL : PARTIAL_TTL;
}

export function createStatsCache(now: () => number = Date.now) {
  let entry: { account: string; stats: Stats; expiresAt: number } | null = null;
  return {
    get(account: string) {
      return entry && entry.account === account && entry.expiresAt > now() ? entry.stats : null;
    },
    set(account: string, stats: Stats) {
      entry = { account, stats, expiresAt: now() + statsTtl(stats) };
    },
    clear() {
      entry = null;
    }
  };
}
