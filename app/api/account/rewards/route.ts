import { NextRequest } from "next/server";
import { readJsonBody, requireSameOrigin } from "@/lib/auth-protocol";
import { autoSpendBodySchema } from "@/lib/models";
import { getRewardsSince, setAutoSpend } from "@/lib/velov";
import { DEBIT_SLACK } from "@/lib/operations";
import { ACCOUNT_CHANGED, beforeSend, errorResponse, getSession, jsonResponse, readsOtherAccount, sameAccount, type Session } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET(request: NextRequest) {
  let session: Session | null = null;
  try {
    const since = Number(request.nextUrl.searchParams.get("since"));
    if (!Number.isSafeInteger(since) || since > Date.now() + DEBIT_SLACK || since < Date.now() - 90 * 86_400_000) return jsonResponse({ error: "Cette période n’est pas valide.", code: "invalid" }, null, 400);
    session = await getSession(request);
    if (!session) return jsonResponse({ error: "Connectez-vous pour retrouver votre compte.", code: "expired" }, null, 401);
    if (await readsOtherAccount(request, session)) return jsonResponse({ error: ACCOUNT_CHANGED, code: "local.account.changed" }, session, 409);
    return jsonResponse(await getRewardsSince(session, since), session);
  } catch (error) { return errorResponse(error, session); }
}

export async function PATCH(request: NextRequest) {
  let session: Session | null = null;
  try {
    requireSameOrigin(request);
    const body = autoSpendBodySchema.safeParse(await readJsonBody(request));
    if (!body.success) return jsonResponse({ error: "Ce réglage n’est pas valide.", code: "invalid" }, null, 400);
    session = await beforeSend(() => getSession(request));
    if (!session) return jsonResponse({ error: "Connectez-vous pour modifier votre compte.", code: "expired" }, null, 401);
    if (!await sameAccount(request, session)) return jsonResponse({ error: ACCOUNT_CHANGED, code: "local.account.changed" }, session, 409);
    return jsonResponse(await setAutoSpend(session, body.data.autoSpend), session);
  } catch (error) { return errorResponse(error, session); }
}
