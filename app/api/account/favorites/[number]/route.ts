import { NextRequest } from "next/server";
import { requireSameOrigin } from "@/lib/auth-protocol";
import { setFavorite } from "@/lib/velov";
import { errorResponse, getSession, jsonResponse, type Session } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
type Context = { params: Promise<{ number: string }> };

/** POST adds the station to the favourites, DELETE removes it; neither takes a body. */
async function bookmark(request: NextRequest, { params }: Context, on: boolean) {
  let session: Session | null = null;
  try {
    requireSameOrigin(request);
    const { number } = await params;
    if (!/^\d{1,9}$/.test(number) || Number(number) <= 0) return jsonResponse({ error: "Numéro de station invalide.", code: "invalid" }, null, 400);
    session = await getSession(request);
    if (!session) return jsonResponse({ error: "Connectez-vous pour modifier vos favoris.", code: "expired" }, null, 401);
    return jsonResponse(await setFavorite(session, Number(number), on), session);
  } catch (error) { return errorResponse(error, session); }
}

export function POST(request: NextRequest, context: Context) { return bookmark(request, context, true); }
export function DELETE(request: NextRequest, context: Context) { return bookmark(request, context, false); }
