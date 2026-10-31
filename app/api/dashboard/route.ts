import { NextRequest } from "next/server";
import { getDashboard } from "@/lib/velov";
import { ACCOUNT_CHANGED, errorResponse, getSession, jsonResponse, readsOtherAccount, type Session } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET(request: NextRequest) {
  let session: Session | null = null;
  try {
    session = await getSession(request);
    if (!session) return jsonResponse({ error: "Connectez-vous pour retrouver votre compte.", code: "expired" }, null, 401);
    if (await readsOtherAccount(request, session)) return jsonResponse({ error: ACCOUNT_CHANGED, code: "local.account.changed" }, session, 409);
    return jsonResponse(await getDashboard(session), session);
  } catch (error) { return errorResponse(error, session); }
}
