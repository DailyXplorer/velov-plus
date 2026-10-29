import type { Bike, Booking, Dashboard, Station, Trip } from "@/lib/models";
import { buildStats, type Movement } from "@/lib/stats";

const MINUTE = 60_000;
const DAY = 86_400_000;

const places: [number, string, number, number, number, number, number][] = [
  [2002, "Bellecour / Saint-Exupéry", 45.7578, 4.8320, 6, 3, 8],
  [2001, "Place Antonin Poncet / Quai du Docteur Gailleton – Bellecour Sud", 45.7556, 4.8352, 2, 1, 14],
  [2004, "Bellecour / Émile Zola", 45.7592, 4.8336, 0, 0, 20],
  [2005, "Place des Célestins", 45.7602, 4.8318, 4, 0, 11],
  [2007, "Jacobins", 45.7611, 4.8339, 9, 2, 3],
  [1001, "Hôtel de Ville / Terreaux", 45.7676, 4.8344, 5, 5, 6],
  [2010, "Ampère / Victor Hugo", 45.7535, 4.8292, 3, 1, 9],
  [2012, "Saint-Jean / Quai Romain Rolland", 45.7612, 4.8282, 1, 0, 17],
  [7008, "Guillotière / Pont de la Guillotière", 45.7555, 4.8410, 7, 4, 2],
  [2015, "Cordeliers", 45.7630, 4.8360, 12, 3, 0],
  [2020, "Rue de la République / Grolée", 45.7590, 4.8362, 2, 2, 12],
  [5015, "Vieux Lyon / Saint-Paul", 45.7660, 4.8270, 0, 3, 10],
  [7024, "Jean Macé", 45.7457, 4.8424, 8, 2, 6],
  [3001, "Part-Dieu / Villette", 45.7606, 4.8594, 15, 6, 4]
];

export const stations: Station[] = places.map(([number, name, lat, lon, mechanical, electrical, stands]) => ({
  id: `station-${number}`, number, name, address: `${name}, 69002 Lyon`, lat, lon, mechanical, electrical, stands, open: true
}));

export const LONG_STATION = 2001;
export const favorites = [2002, LONG_STATION, 7024];

function iso(offset: number) {
  return new Date(Date.now() + offset).toISOString();
}

export function bikes(): Bike[] {
  const base = { status: "AVAILABLE", statusLabel: null, isReserved: false, frameId: null, lastControlAt: iso(-12 * DAY), lastSignalAt: iso(-3 * MINUTE), nextReviewAt: iso(120 * DAY) };
  return [
    { ...base, number: 20449, type: "electrical", standNumber: 4, rating: { value: 92, count: 41, lastAt: iso(-3 * 3_600_000) }, batteryPercent: 87, frameId: "FR-LY-0020449", lastTripAt: iso(-50 * MINUTE), nextCheckAt: iso(18 * DAY) },
    { ...base, number: 18234, type: "mechanical", standNumber: 7, rating: { value: 88, count: 12, lastAt: iso(-26 * 3_600_000) }, batteryPercent: null, lastTripAt: iso(-2 * 3_600_000), nextCheckAt: iso(40 * DAY) },
    { ...base, number: 11870, type: "mechanical", standNumber: 9, rating: { value: 74, count: 6, lastAt: iso(-4 * DAY) }, batteryPercent: null, lastTripAt: iso(-5 * 3_600_000), nextCheckAt: iso(9 * DAY) },
    { ...base, number: 27619, type: "electrical", standNumber: 2, rating: { value: 70, count: 3, lastAt: iso(-8 * DAY) }, batteryPercent: 46, lastTripAt: iso(-7 * 3_600_000), nextCheckAt: iso(22 * DAY) },
    { ...base, number: 14002, type: "mechanical", standNumber: 11, rating: null, batteryPercent: null, lastTripAt: iso(-20 * 3_600_000), nextCheckAt: iso(30 * DAY) },
    { ...base, number: 16555, type: "mechanical", standNumber: 12, isReserved: true, rating: { value: 80, count: 8, lastAt: iso(-2 * DAY) }, batteryPercent: null, lastTripAt: iso(-9 * 3_600_000), nextCheckAt: iso(12 * DAY) },
    { ...base, number: 12301, type: "mechanical", standNumber: 14, rating: { value: 42, count: 17, lastAt: iso(-6 * DAY) }, batteryPercent: null, lastTripAt: iso(-6 * DAY), nextCheckAt: iso(-45 * DAY) },
    { ...base, number: 25110, type: "electrical", standNumber: 15, status: "MAINTENANCE", statusLabel: "En maintenance", rating: { value: 66, count: 9, lastAt: iso(-3 * DAY) }, batteryPercent: 12, lastTripAt: iso(-2 * DAY), nextCheckAt: iso(5 * DAY) }
  ];
}

export function bike(number: number): Bike {
  return bikes().find((item) => item.number === number) ?? { ...bikes()[1], number };
}

const routes: [number, number][] = [[2002, 3001], [3001, 2002], [1001, 2007], [2015, 7024], [LONG_STATION, 1001], [7008, 2002], [2005, 5015], [2010, 2002]];
const nameOf = (number: number) => stations.find((station) => station.number === number)?.name ?? null;

export function trips(): Trip[] {
  const list: Trip[] = [];
  for (let index = 0; index < 26; index++) {
    const [from, to] = routes[index % routes.length];
    const duration = [14, 22, 9, 31, 18, 47, 12, 26][index % 8];
    const end = index === 0 ? Date.now() - 18 * MINUTE : Date.now() - index * 1.6 * DAY - 3 * 3_600_000;
    const electrical = index % 3 === 0;
    list.push({
      id: `qa-trip-${index}`, status: "FINISHED", startedAt: new Date(end - duration * MINUTE).toISOString(), endedAt: new Date(end).toISOString(),
      startStation: nameOf(from), endStation: nameOf(to), startStationNumber: from, endStationNumber: to,
      startStand: 3 + index % 9, endStand: 12 - index % 7, distance: 1_400 + index * 230, bikeNumber: index === 0 ? 20449 : 10_000 + index * 731,
      bikeType: electrical ? "electrical" : "mechanical", duration, price: index === 1 ? 100 : electrical && duration > 30 ? 150 : 0,
      fullPrice: index === 1 ? 150 : null, discount: index === 1 ? 50 : 0, pointsEarned: index === 1 ? 5 : index % 5 === 2 ? 5 : 0, pointsSpent: index === 1 ? 10 : 0,
      litigious: index === 1, isRated: index !== 0, token: index === 1 ? "A7F3K29Q" : null, origin: 4
    });
  }
  return list;
}

export const LITIGIOUS_TRIP = 1;

export function ongoing(): Trip {
  return { ...trips()[0], id: "qa-ongoing", status: "STARTED", endedAt: null, startedAt: iso(-7 * MINUTE), endStation: null, endStationNumber: null, endStand: null, duration: null, price: null, isRated: null };
}

export function dashboard(withOngoing = false): Dashboard {
  return {
    profile: { firstName: "jean", lastName: "dupont", email: "jean.dupont@exemple.fr", locked: false, complete: true, phoneNumber: "+33612345678", address: "12 rue de la République", addressComplement: "Bâtiment B", zipCode: "69002", city: "Lyon", country: "FR", favorites },
    rewards: {
      balance: 1_245, total: 2_380, autoSpend: true,
      movements: [
        ["Bonus de trajet", 5], ["Vélo évalué", 5], ["Arrivée dans une station vide", 5], ["Réduction sur un trajet", -50], ["Points de bienvenue", 1_000],
        ["Départ d’une station pleine", 5], ["Vélo évalué", 5], ["Code ami", -500], ["Bonus de trajet", 5], ["Vélo évalué", 5], ["Arrivée dans une station vide", 5]
      ].map(([label, amount], index) => ({ id: `qa-move-${index}`, date: iso(-index * 2.3 * DAY), label: String(label), amount: Number(amount) })),
      rules: [
        { name: "FULL_STATION", label: "Départ d’une station pleine", points: 5, kind: "earn" }, { name: "EMPTY_STATION", label: "Arrivée dans une station vide", points: 5, kind: "earn" },
        { name: "RATING", label: "Vélo évalué", points: 5, kind: "earn" }, { name: "PROMOCODE", label: "Code ami", points: 500, kind: "spend" }
      ]
    },
    subscription: { id: "qa-sub", title: "Vélo’v Plus 1 an – paiement comptant", type: "LT", validUntil: "2027-03-01T00:00:00Z", active: true, autoRenewal: false, autoRenewalAllowed: true },
    paymentValid: true,
    receipts: [{ subscriptionId: "qa-sub", periodId: "qa-period", title: "Vélo’v Plus 1 an", start: "2026-03-01T00:00:00Z", end: "2027-03-01T00:00:00Z" }],
    trips: trips(), ongoing: withOngoing ? [ongoing()] : [], bookings: 0,
    updatedAt: iso(0), warnings: []
  };
}

export function booking(): Booking {
  return { id: "qa-booking", stationNumber: 2002, stationName: "Bellecour / Saint-Exupéry", standNumber: 4, bikeNumber: 20449, endsAt: iso(11 * MINUTE + 32_000), lat: 45.7578, lon: 4.832 };
}

function random(seed: number) {
  return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export function stats() {
  const next = random(42);
  const now = new Date();
  const history: Trip[] = [];
  const movements: Movement[] = [];
  for (let day = 362; day >= 0; day--) {
    const date = new Date(now.getTime() - day * DAY);
    const weekday = (date.getUTCDay() + 6) % 7;
    const summer = date.getUTCMonth() >= 4 && date.getUTCMonth() <= 8;
    const rides: [number, number, number, number][] = [];
    if (weekday < 5 && next() < (summer ? .42 : .28)) rides.push([0, 13, 7 + Math.floor(next() * 2), 13 + Math.floor(next() * 6)], [13, 0, 17 + Math.floor(next() * 3), 14 + Math.floor(next() * 7)]);
    if (next() < (weekday >= 5 ? .3 : .07)) {
      const from = Math.floor(next() * places.length);
      rides.push([from, Math.floor(next() * places.length), 10 + Math.floor(next() * 12), 5 + Math.floor(next() ** 2 * 45)]);
    }
    for (const [from, to, hour, duration] of rides) {
      const startedAt = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour - 1, Math.floor(next() * 60)));
      const electrical = next() < .35;
      const [start, end] = [places[from], places[to]];
      const earned = next() < .12 ? 10 : 0;
      history.push({
        id: `qa-stat-${history.length}`, status: "FINISHED", startedAt: startedAt.toISOString(), endedAt: new Date(startedAt.getTime() + duration * MINUTE).toISOString(),
        startStation: start[1], endStation: end[1], startStationNumber: start[0], endStationNumber: end[0], startStand: null, endStand: null, distance: null,
        bikeNumber: next() < .06 ? 18234 : 10_000 + Math.floor(next() * 9000), bikeType: electrical ? "electrical" : "mechanical", duration,
        price: electrical && duration > 30 ? 100 : 0, fullPrice: null, discount: 0, pointsEarned: earned, pointsSpent: 0, litigious: false, isRated: true, token: null, origin: 4
      });
      if (earned) movements.push({ date: startedAt.toISOString(), amount: earned });
    }
  }
  return buildStats({ trips: history.reverse(), coords: new Map(places.map(([number, , lat, lon]) => [number, { lat, lon }])), movements, balance: 1_245, complete: true, now });
}
