import { z } from "zod";
import { outcomeSchema, type Outcome } from "./models.ts";

export const autoRenewalBodySchema = z.object({ subscriptionId: z.string().regex(/^[\w-]{1,64}$/), autoRenewal: z.boolean() }).strict();
export type AutoRenewalBody = z.infer<typeof autoRenewalBodySchema>;
export const autoRenewalResultSchema = outcomeSchema.extend({ autoRenewal: z.boolean().nullable(), autoRenewalAllowed: z.boolean(), verified: z.boolean() });
export type AutoRenewalResult = z.infer<typeof autoRenewalResultSchema>;
type RenewalState = Pick<AutoRenewalResult, "autoRenewal" | "autoRenewalAllowed">;

export function renewalStateOf(subscription: { isLocked?: boolean; periods?: { renewalDetails?: { autoRenewalValue?: boolean | null; autoRenewalBtn?: boolean | null } | null }[] } | undefined): RenewalState {
  const details = subscription?.periods?.at(-1)?.renewalDetails;
  return { autoRenewal: details?.autoRenewalValue ?? null, autoRenewalAllowed: subscription?.isLocked !== true && details?.autoRenewalBtn === true };
}

export async function completeRenewalChange(write: () => Promise<Outcome>, readState: () => Promise<RenewalState>, wanted: boolean): Promise<AutoRenewalResult> {
  const outcome = await write();
  const answered = outcome.httpStatus >= 200 && outcome.httpStatus < 300;
  if (!answered) return { ...outcome, autoRenewal: null, autoRenewalAllowed: false, verified: false };
  try {
    const state = await readState();
    return state.autoRenewal === wanted ? { ...outcome, ok: true, code: null, message: null, ...state, verified: true } : { ...outcome, ...state, verified: true };
  } catch { return { ...outcome, autoRenewal: null, autoRenewalAllowed: false, verified: false }; }
}
