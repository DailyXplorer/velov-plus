import assert from "node:assert/strict";
import { test } from "node:test";
import type { Station } from "../lib/models.ts";
import { locateMessage, nearestSupplied } from "../lib/station-filter.ts";
import { readFileSync } from "node:fs";

const here = { lat: 45.7566, lon: 4.8318 };
function station(number: number, metresNorth: number, supply: Partial<Station> = {}): Station {
  return { id: String(number), number, name: `Station ${number}`, address: "", lat: here.lat + metresNorth / 111_320, lon: here.lon, mechanical: 0, electrical: 0, stands: 0, open: true, ...supply };
}
const numbers = (stations: Station[]) => stations.map((item) => item.number);

test("locate skips a nearer station that has no bike", () => {
  const stations = [station(1, 50, { stands: 20 }), station(2, 300, { mechanical: 3 }), station(3, 600, { electrical: 1 })];
  assert.deepEqual(numbers(nearestSupplied(stations, here, "all", new Set())), [2, 3]);
});

test("locate with the Places filter picks the nearest station with a free place, even without bikes", () => {
  const stations = [station(1, 50, { stands: 20 }), station(2, 300, { mechanical: 3 }), station(3, 600, { mechanical: 2, stands: 1 })];
  assert.deepEqual(numbers(nearestSupplied(stations, here, "stands", new Set())), [1, 3]);
});

test("locate ignores closed stations and stations outside the filter", () => {
  const stations = [station(1, 50, { mechanical: 4, open: false }), station(2, 100, { mechanical: 4 }), station(3, 200, { electrical: 2 }), station(4, 400, { mechanical: 1 })];
  assert.deepEqual(numbers(nearestSupplied(stations, here, "electrical", new Set())), [3]);
  assert.deepEqual(numbers(nearestSupplied(stations, here, "favorites", new Set([4, 1]))), [4]);
});

test("locate keeps the three nearest supplied stations and finds none when nothing has supply", () => {
  const stations = [5, 4, 3, 2, 1].map((index) => station(index, index * 100, { mechanical: 1 }));
  assert.deepEqual(numbers(nearestSupplied(stations, here, "available", new Set())), [1, 2, 3]);
  assert.deepEqual(nearestSupplied([station(1, 50, { stands: 3 })], here, "all", new Set()), []);
});

test("« Autour de moi » before the stations arrive says they are loading or unavailable, not that none matches", () => {
  assert.equal(locateMessage({ kind: "loading" }, 0), "Les stations sont en cours de chargement. Réessayez dans un instant.");
  assert.equal(locateMessage({ kind: "error" }, 0), "Les stations sont momentanément indisponibles.");
  assert.equal(locateMessage({ kind: "ready" }, 0), "Aucune station ouverte ne correspond à ce filtre.");
  assert.equal(locateMessage({ kind: "ready" }, 2), null);
  assert.match(readFileSync("components/dashboard.tsx", "utf8"), /const message = locateMessage\(current, supplied\.length\);/);
});
