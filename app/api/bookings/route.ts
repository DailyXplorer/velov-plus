import { NextRequest } from "next/server";
import { readJsonBody, requireSameOrigin } from "@/lib/auth-protocol";
import { bookBodySchema } from "@/lib/models";
import { bookBike, getBookings } from "@/lib/velov";
import { ACCOUNT_CHANGED, beforeSend, errorResponse, sameAccount, getSession, jsonResponse, type Session } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  let session: Session | null = null;
  try {
    session = await getSession(request);
    if (!session) return jsonResponse({ error: "Connectez-vous pour retrouver votre compte.", code: "expired" }, null, 401);
    return jsonResponse(await getBookings(session), session);
  } catch (error) { return errorResponse(error, session); }
}

export async function POST(request: NextRequest) {
  let session: Session | null = null;
  try {
    requireSameOrigin(request);
    const body = bookBodySchema.safeParse(await readJsonBody(request));
    if (!body.success) return jsonResponse({ error: "Cette réservation n’est pas valide.", code: "invalid" }, null, 400);
    session = await beforeSend(() => getSession(request));
    if (!session) return jsonResponse({ error: "Connectez-vous pour réserver ou déverrouiller.", code: "expired" }, null, 401);
    if (!await sameAccount(request, session)) return jsonResponse({ error: ACCOUNT_CHANGED, code: "local.account.changed" }, session, 409);
    return jsonResponse(await bookBike(session, body.data), session);
  } catch (error) { return errorResponse(error, session); }
}
