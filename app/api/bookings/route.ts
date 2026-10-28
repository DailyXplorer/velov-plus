import { NextRequest } from "next/server";
import { requireSameOrigin } from "@/lib/auth-protocol";
import { bookBodySchema } from "@/lib/models";
import { bookBike, getBookings } from "@/lib/velov";
import { errorResponse, getSession, jsonResponse } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) return jsonResponse({ error: "Connectez-vous pour retrouver votre compte.", code: "expired" }, null, 401);
    return jsonResponse(await getBookings(session), session);
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    if (!request.headers.get("content-type")?.startsWith("application/json") || Number(request.headers.get("content-length") ?? "0") > 1024) return jsonResponse({ error: "Cette réservation n’est pas valide.", code: "invalid" }, null, 400);
    const body = bookBodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonResponse({ error: "Cette réservation n’est pas valide.", code: "invalid" }, null, 400);
    const session = await getSession(request);
    if (!session) return jsonResponse({ error: "Connectez-vous pour réserver ou déverrouiller.", code: "expired" }, null, 401);
    return jsonResponse(await bookBike(session, body.data), session);
  } catch (error) { return errorResponse(error); }
}
