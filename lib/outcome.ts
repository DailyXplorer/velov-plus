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
