import { NextRequest } from "next/server";
import { readJsonBody, requireSameOrigin } from "@/lib/auth-protocol";
import { autoRenewalBodySchema } from "@/lib/renewal-models";
import { setAutoRenewal } from "@/lib/velov";
import { ACCOUNT_CHANGED, beforeSend, errorResponse, getSession, jsonResponse, sameAccount, type Session } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function PATCH(request: NextRequest) {
  let session: Session | null = null;
  try {
    requireSameOrigin(request);
    const body = autoRenewalBodySchema.safeParse(await readJsonBody(request));
    if (!body.success) return jsonResponse({ error: "Ce réglage n’est pas valide.", code: "invalid" }, null, 400);
    session = await beforeSend(() => getSession(request));
    if (!session) return jsonResponse({ error: "Connectez-vous pour modifier votre compte.", code: "expired" }, null, 401);
    if (!await sameAccount(request, session)) return jsonResponse({ error: ACCOUNT_CHANGED, code: "local.account.changed" }, session, 409);
    return jsonResponse(await setAutoRenewal(session, body.data), session);
  } catch (error) { return errorResponse(error, session); }
}
