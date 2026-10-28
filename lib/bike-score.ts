import type { Bike } from "./models";

export type Verdict = "recommended" | "avoid" | "neutral";
export type AssessedBike = { bike: Bike; verdict: Verdict; score: number; reasons: string[] };

const HOUR = 3_600_000;
const rank: Record<Verdict, number> = { recommended: 0, neutral: 1, avoid: 2 };
const outOfFive = (value: number) => (value / 20).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const hoursSince = (value: string | null, now: number) => value ? (now - new Date(value).getTime()) / HOUR : null;

export function isCheckOverdue(bike: Bike, now = Date.now()) {
  return bike.nextCheckAt != null && new Date(bike.nextCheckAt).getTime() < now;
}

function avoidReasons(bike: Bike, now: number) {
  const reasons: string[] = [];
  const idle = hoursSince(bike.lastTripAt, now);
  if (bike.isReserved) reasons.push("Réservé");
  if (bike.status !== "AVAILABLE") reasons.push(bike.statusLabel ? `Indisponible (${bike.statusLabel})` : "Indisponible");
  if (bike.rating && bike.rating.value < 60 && bike.rating.count >= 5) reasons.push(`Note basse (${outOfFive(bike.rating.value)}/5)`);
  if (isCheckOverdue(bike, now)) reasons.push("Contrôle en retard");
  if (bike.type === "electrical" && bike.batteryPercent != null && bike.batteryPercent < 20) reasons.push(`Batterie faible (${bike.batteryPercent} %)`);
  if (idle != null && idle > 72) reasons.push(`Pas utilisé depuis ${Math.floor(idle / 24)} j`);
  return reasons;
}

/** Shrinks ratings with few votes toward 70, then rewards a recent trip and a charged battery. */
function scoreBike(bike: Bike, now: number) {
  const weight = Math.min(bike.rating?.count ?? 0, 20) / 20;
  const idle = hoursSince(bike.lastTripAt, now);
  return (bike.rating?.value ?? 0) * weight + 70 * (1 - weight)
    + (idle != null && idle < 12 ? 5 : 0)
    + (bike.type === "electrical" ? (bike.batteryPercent ?? 0) / 10 : 0);
}

function strengths(bike: Bike, now: number) {
  const idle = hoursSince(bike.lastTripAt, now);
  return [
    bike.rating ? `Bien noté (${outOfFive(bike.rating.value)}/5 · ${bike.rating.count} avis)` : null,
    bike.type === "electrical" && bike.batteryPercent != null ? `Batterie ${bike.batteryPercent} %` : null,
    idle != null && idle < 12 ? "Utilisé il y a moins de 12 h" : null
  ].filter((reason) => reason !== null);
}

/** Rates every bike of a station: the best mechanical and electric are recommended, the doubtful ones are to avoid. Sorted for display. */
export function assessBikes(bikes: Bike[], now = Date.now()): AssessedBike[] {
  const assessed = bikes.map((bike): AssessedBike => {
    const reasons = avoidReasons(bike, now);
    return { bike, verdict: reasons.length ? "avoid" : "neutral", score: scoreBike(bike, now), reasons };
  });
  for (const type of ["mechanical", "electrical"] as const) {
    const best = assessed.filter((item) => item.bike.type === type && item.verdict !== "avoid").reduce<AssessedBike | null>((top, item) => !top || item.score > top.score ? item : top, null);
    if (!best?.bike.rating || best.bike.rating.count < 3 || best.bike.rating.value < 75) continue;
    best.verdict = "recommended";
    best.reasons = strengths(best.bike, now);
  }
  return assessed.sort((left, right) => rank[left.verdict] - rank[right.verdict] || (left.verdict === "avoid" ? 0 : right.score - left.score));
}
