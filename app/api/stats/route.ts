import { NextRequest } from "next/server";
import { getStats } from "@/lib/velov";
import { errorResponse, getSession, jsonResponse, type Session } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  let session: Session | null = null;
  try {
    session = await getSession(request);
    if (!session) return jsonResponse({ error: "Connectez-vous pour retrouver vos statistiques.", code: "expired" }, null, 401);
    return jsonResponse(await getStats(session), session);
  } catch (error) { return errorResponse(error, session); }
}
