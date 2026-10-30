import { haversine, type Point } from "./geo.ts";
import type { Station } from "./models.ts";

export type StationFilter = "all" | "favorites" | "available" | "electrical" | "stands";

export function matchesFilter(station: Station, filter: StationFilter, favorites: ReadonlySet<number>) {
  return (filter !== "favorites" || favorites.has(station.number))
    && (filter !== "available" || station.mechanical + station.electrical > 0)
    && (filter !== "electrical" || station.electrical > 0)
    && (filter !== "stands" || station.stands > 0);
}

export function nearestSupplied(stations: Station[], here: Point, filter: StationFilter, favorites: ReadonlySet<number>, count = 3): Station[] {
  return stations
    .filter((station) => station.open && matchesFilter(station, filter, favorites) && (filter === "stands" ? station.stands > 0 : station.mechanical + station.electrical > 0))
    .sort((left, right) => haversine(here, left) - haversine(here, right))
    .slice(0, count);
}
