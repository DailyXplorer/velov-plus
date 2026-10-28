import { z } from "zod";
import type { Station } from "./models.ts";
import { haversine, type Point } from "./geo.ts";

export const viaBodySchema = z.object({ stationNumber: z.number().int().positive().safe() }).strict();
export type ViaBody = z.infer<typeof viaBodySchema>;

/** Full open stations only; accent-insensitive search, nearest first when the user shares a position. */
export function fullStations(stations: Station[], query: string, position: Point | null) {
  const normalize = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("fr");
  return stations.filter((station) => station.open && station.stands === 0 && normalize(`${station.name} ${station.address} ${station.number}`).includes(normalize(query)))
    .sort((a, b) => (position ? haversine(position, a) - haversine(position, b) : 0) || a.name.localeCompare(b.name, "fr"));
}
