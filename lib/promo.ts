import { z } from "zod";
import { accountCall, BASE, type Auth } from "./cyclocity.ts";
import { type PromoResult } from "./promo-models.ts";
import { PROMOCODE_ACCEPT, PROMOCODE_CODE_FIELD } from "./guesses.ts";

/** The single debit, without a body. Optional response metadata must never hide a returned code. */
export async function postPromoCode(auth: Auth, send: typeof fetch = fetch): Promise<PromoResult> {
  const { outcome, value } = await accountCall(`${BASE}/accounts/${encodeURIComponent(auth.accountId)}/rewards/consume/promocode`, {
    method: "POST", headers: { Accept: PROMOCODE_ACCEPT }
  }, auth, "Vélo’v n’a pas fourni de code d’invitation.", send, true);
  const code = z.object({ [PROMOCODE_CODE_FIELD]: z.string().min(1) }).safeParse(value);
  const promoCode = code.success ? code.data[PROMOCODE_CODE_FIELD] : null;
  if (outcome.ok && !promoCode) return { ...outcome, ok: false, code: "local.promo.unreadable", message: "Les points ont peut-être été débités, mais aucun code lisible n’a été reçu. Ne recommencez pas : contactez Vélo’v.", promoCode: null };
  return { ...outcome, promoCode };
}
