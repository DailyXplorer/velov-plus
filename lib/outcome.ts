import type { Outcome } from "./models.ts";

export const UNCERTAIN = "Le résultat est incertain : vérifiez avant de réessayer.";
export const UNCERTAIN_UNLOCK = "Le résultat est incertain : vérifiez la borne avant de réessayer.";

const failedStates = new Set(["NOK", "ABORT", "NOT_CONNECTED"]);

export function isUncertain(outcome: Outcome) {
  const { ok, httpStatus, code, transactionState } = outcome;
  if (ok) return false;
  if (transactionState && failedStates.has(transactionState) && httpStatus < 500) return false;
  if (httpStatus === 0) return !code?.startsWith("local.");
  return !(httpStatus >= 400 && httpStatus < 500 && code);
}

export function noAnswer(message: string): Outcome {
  return { ok: false, httpStatus: 0, transactionState: null, code: "network", message, detail: null };
}

function seconds(ms: number) {
  const value = Math.max(0, ms) / 1000;
  return `${value.toLocaleString("fr-FR", { maximumFractionDigits: value < 10 ? 1 : 0 })}\u00a0s`;
}

export function networkDetail(error: unknown, elapsed: number): string {
  const name = error instanceof Error || error instanceof DOMException ? error.name : typeof error;
  const message = error instanceof Error && error.message ? ` (${error.message})` : "";
  if (name === "TimeoutError") return `Délai dépassé après ${seconds(elapsed)} · TimeoutError`;
  if (name === "AbortError") return `Requête interrompue après ${seconds(elapsed)} · AbortError`;
  if (name === "TypeError") return `Pas de réponse après ${seconds(elapsed)} · TypeError${message}`;
  return `Échec après ${seconds(elapsed)} · ${name}${message}`;
}

export function networkFailure(message: string, error: unknown, startedAt: number, now: number = Date.now()): Outcome {
  return { ...noAnswer(message), detail: networkDetail(error, now - startedAt) };
}

export function routeFailure(status: number, body: unknown, message: string): Outcome {
  const error = body && typeof body === "object" ? body as Record<string, unknown> : {};
  return { ok: false, httpStatus: status, transactionState: null, code: typeof error.code === "string" ? error.code : "local.unreadable", message: typeof error.error === "string" ? error.error : message, detail: null };
}

export const NOT_APPLIED = "Vélo’v n’a rien enregistré. Vous pouvez réessayer.";
export const UNVERIFIED = "Le résultat est incertain et n’a pas pu être vérifié. Vérifiez de nouveau avant de réessayer.";
export type Check = "applied" | "unchanged" | "unknown";
export const HISTORY_LAG = 2 * 60_000;
export type Settled = { kind: "done" } | { kind: "refused" | "uncertain"; outcome: Outcome };

export async function settle(outcome: Outcome, check: () => Promise<Check>, at: number, now: () => number = Date.now): Promise<Settled> {
  if (outcome.ok) return { kind: "done" };
  if (!isUncertain(outcome)) return { kind: "refused", outcome };
  const state = await check().catch((): Check => "unknown");
  if (state === "applied") return { kind: "done" };
  if (state === "unchanged" && now() - at >= HISTORY_LAG) return { kind: "refused", outcome: { ...outcome, message: NOT_APPLIED } };
  return { kind: "uncertain", outcome };
}
