import { z } from "zod";
import { accountCall, BASE, type Auth } from "./cyclocity.ts";
import { type PromoResult } from "./promo-models.ts";
import { PROMOCODE_ACCEPT, PROMOCODE_CODE_FIELD } from "./guesses.ts";
import { sendWrite } from "./write-transport.ts";

export async function postPromoCode(auth: Auth, send: typeof fetch = sendWrite): Promise<PromoResult> {
  const { outcome, value } = await accountCall(`${BASE}/accounts/${encodeURIComponent(auth.accountId)}/rewards/consume/promocode`, {
    method: "POST", headers: { Accept: PROMOCODE_ACCEPT }
  }, auth, "Le code n’a pas pu être créé.", send, true);
  const code = z.object({ [PROMOCODE_CODE_FIELD]: z.string().min(1) }).safeParse(value);
  const promoCode = code.success ? code.data[PROMOCODE_CODE_FIELD] : null;
  if (outcome.ok && !promoCode) return { ...outcome, ok: false, code: "local.promo.unreadable", message: "Aucun code n’a été reçu, mais vos points ont peut-être été débités. Contactez Vélo’v avant de recommencer.", promoCode: null };
  return { ...outcome, promoCode };
}
