import { z } from "zod";
import { accountCall, BASE, MAYBE_SENT, UNCONFIRMED, type Auth } from "./cyclocity.ts";
import { type PromoResult } from "./promo-models.ts";
import { PROMOCODE_ACCEPT, PROMOCODE_CODE_FIELD } from "./guesses.ts";
import { sendWrite } from "./write-transport.ts";

const promoReply = z.object({ [PROMOCODE_CODE_FIELD]: z.string().min(1) });
const promoCodeOf = (value: unknown) => promoReply.safeParse(value).data?.[PROMOCODE_CODE_FIELD] ?? null;

export async function postPromoCode(auth: Auth, send: typeof fetch = sendWrite): Promise<PromoResult> {
  const { outcome, value } = await accountCall(`${BASE}/accounts/${encodeURIComponent(auth.accountId)}/rewards/consume/promocode`, {
    method: "POST", headers: { Accept: PROMOCODE_ACCEPT }
  }, auth, send, {
    failed: "Le code n’a pas pu être créé.", maybe: MAYBE_SENT.invite, proves: ({ value }) => promoCodeOf(value) !== null,
    unconfirmed: "Aucun code n’a été reçu, mais vos points ont peut-\u2060être été débités. Contactez Vélo’v avant de recommencer."
  });
  if (outcome.code === UNCONFIRMED) return { ...outcome, code: "local.promo.unreadable", promoCode: null };
  return { ...outcome, promoCode: outcome.ok ? promoCodeOf(value) : null };
}
