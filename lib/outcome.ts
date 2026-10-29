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
