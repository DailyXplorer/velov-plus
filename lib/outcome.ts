import type { Outcome } from "./models.ts";

export const UNCERTAIN = "Le résultat est incertain : vérifiez avant de réessayer.";
export const UNCERTAIN_UNLOCK = "Le résultat est incertain : vérifiez la borne avant de réessayer.";

/** Release states after which the bike surely stayed locked (§ 5.6). Not TIME_OUT: the borne may have opened without answering. */
const failedStates = new Set(["NOK", "ABORT", "NOT_CONNECTED"]);

/**
 * Whether a failed state-changing call may still have gone through, so the same dialog must not offer to confirm it again.
 * Sure refusals: our server stopped before sending (no HTTP status, a local code), a 4xx carrying an error code, a definite failure state.
 * Anything else is uncertain: no answer, a timeout, a 5xx or a gateway page, a 2xx we could not read, a 4xx without a code.
 */
export function isUncertain(outcome: Outcome) {
  const { ok, httpStatus, code, transactionState } = outcome;
  if (ok) return false;
  if (transactionState && failedStates.has(transactionState) && httpStatus < 500) return false;
  if (httpStatus === 0) return !code?.startsWith("local.");
  return !(httpStatus >= 400 && httpStatus < 500 && code);
}

/** The browser's fetch to our route threw: network error, timeout or abort. */
export function noAnswer(message: string): Outcome {
  return { ok: false, httpStatus: 0, transactionState: null, code: "network", message, detail: null };
}

/** Our route answered something that is not an outcome: its own error body ({ error, code }), a platform error page, or nothing. */
export function routeFailure(status: number, body: unknown, message: string): Outcome {
  const error = body && typeof body === "object" ? body as Record<string, unknown> : {};
  return { ok: false, httpStatus: status, transactionState: null, code: typeof error.code === "string" ? error.code : "local.unreadable", message: typeof error.error === "string" ? error.error : message, detail: null };
}
