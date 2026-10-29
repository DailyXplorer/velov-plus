import { NextRequest } from "next/server";
import { getTripCheck } from "@/lib/velov";
import { errorResponse, getSession, jsonResponse, type Session } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET(request: NextRequest) {
  let session: Session | null = null;
  try {
    session = await getSession(request);
    if (!session) return jsonResponse({ error: "Connectez-vous pour retrouver votre compte.", code: "expired" }, null, 401);
    return jsonResponse(await getTripCheck(session), session);
  } catch (error) { return errorResponse(error, session); }
}
