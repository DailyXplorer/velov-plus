export type Point = { lat: number; lon: number };

/** Great-circle distance in metres. */
export function haversine(from: Point, to: Point) {
  const radians = Math.PI / 180;
  const latitude = (to.lat - from.lat) * radians;
  const longitude = (to.lon - from.lon) * radians;
  const arc = Math.sin(latitude / 2) ** 2 + Math.cos(from.lat * radians) * Math.cos(to.lat * radians) * Math.sin(longitude / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(1 - arc));
}

/** "350 m", "1,2 km", "14 km". */
export function formatDistance(metres: number) {
  if (metres < 1000) return `${Math.max(10, Math.round(metres / 10) * 10)} m`;
  return `${(metres / 1000).toLocaleString("fr-FR", { maximumFractionDigits: metres < 10_000 ? 1 : 0 })} km`;
}
