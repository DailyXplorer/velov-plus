import { NextRequest } from "next/server";
import { getDashboard } from "@/lib/velov";
import { errorResponse, getSession, jsonResponse } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) return jsonResponse({ error: "Connectez-vous pour retrouver votre compte.", code: "expired" }, null, 401);
    return jsonResponse(await getDashboard(session), session);
  } catch (error) { return errorResponse(error); }
}
