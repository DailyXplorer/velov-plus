import { notFound } from "next/navigation";
import { buildStats, type Movement } from "@/lib/stats";
import type { Trip } from "@/lib/models";
import { PreviewShell } from "./shell";

// Temporary screenshot route, fake data only: never served in production.
export const dynamic = "force-dynamic";

const stations: [number, string, number, number][] = [
  [4002, "Croix-Rousse / Place de la Croix-Rousse", 45.7743, 4.8318], [3001, "Part-Dieu / Vivier Merle", 45.7606, 4.8594],
  [2002, "Bellecour / Saint-Exupéry", 45.7578, 4.8320], [1001, "Hôtel de Ville / Terreaux", 45.7676, 4.8344],
  [7024, "Jean Macé", 45.7457, 4.8424], [6003, "Brotteaux", 45.7668, 4.8592], [2010, "Perrache", 45.7486, 4.8270],
  [7008, "Guillotière", 45.7553, 4.8420], [5015, "Vieux Lyon / Saint-Jean", 45.7622, 4.8271], [9004, "Gare de Vaise", 45.7801, 4.8044],
  [8002, "Monplaisir Lumière", 45.7454, 4.8710], [6020, "Parc de la Tête d’Or", 45.7745, 4.8540], [2032, "Confluence / Musée", 45.7330, 4.8180]
];

function random(seed: number) {
  return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

function fake() {
  const next = random(42);
  const pick = <T,>(list: T[]) => list[Math.floor(next() * list.length)];
  const now = new Date();
  const trips: Trip[] = [];
  const movements: Movement[] = [];
  for (let day = 362; day >= 0; day--) {
    const date = new Date(now.getTime() - day * 86_400_000);
    const weekday = (date.getUTCDay() + 6) % 7;
    const summer = date.getUTCMonth() >= 4 && date.getUTCMonth() <= 8;
    const rides: [number, number, number, number][] = [];
    if (weekday < 5 && next() < (summer ? .42 : .28)) rides.push([0, 1, 7 + Math.floor(next() * 2), 13 + Math.floor(next() * 6)], [1, 0, 17 + Math.floor(next() * 3), 14 + Math.floor(next() * 7)]);
    if (next() < (weekday >= 5 ? .3 : .07)) {
      const from = Math.floor(next() * stations.length);
      rides.push([from, next() < .08 ? from : Math.floor(next() * stations.length), 10 + Math.floor(next() * 12), 5 + Math.floor(next() ** 2 * 45)]);
    }
    for (const [from, to, hour, duration] of rides) {
      const startedAt = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour - 1, Math.floor(next() * 60)));
      const electrical = next() < .35;
      const wiped = day > 300 && trips.filter((trip) => !trip.startStation).length < 12;
      const [start, end] = [stations[from], stations[to]];
      const earned = next() < .12 ? 10 : 0;
      const discount = electrical && next() < .15 ? 50 : 0;
      trips.push({
        id: `fake-${trips.length}`, status: "FINISHED", startedAt: startedAt.toISOString(), endedAt: new Date(startedAt.getTime() + duration * 60_000).toISOString(),
        startStation: wiped ? null : start[1], endStation: wiped ? null : end[1], startStationNumber: wiped ? null : start[0], endStationNumber: wiped ? null : end[0],
        startStand: null, endStand: null, distance: null, bikeNumber: wiped ? null : next() < .04 ? 18234 : 10_000 + Math.floor(next() * 9000),
        bikeType: electrical ? "electrical" : "mechanical", duration, price: electrical && duration > 30 ? 100 - discount : 0, fullPrice: null, discount,
        pointsEarned: earned, pointsSpent: 0, litigious: false, isRated: true, token: null, origin: 4
      });
      if (earned) movements.push({ date: startedAt.toISOString(), amount: earned });
      if (next() < .1) movements.push({ date: startedAt.toISOString(), amount: 5 });
      if (discount) movements.push({ date: startedAt.toISOString(), amount: -50 });
    }
  }
  return buildStats({ trips: trips.reverse(), coords: new Map(stations.map(([number, , lat, lon]) => [number, { lat, lon }])), movements, balance: 245, complete: true, now });
}

export default function Preview() {
  if (process.env.NODE_ENV === "production") notFound();
  return <PreviewShell stats={fake()}/>;
}
