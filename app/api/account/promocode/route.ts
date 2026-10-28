import { NextRequest } from "next/server";
import { readJsonBody, requireSameOrigin } from "@/lib/auth-protocol";
import { promoBodySchema } from "@/lib/promo-models";
import { consumePromoCode } from "@/lib/velov";
import { errorResponse, getSession, jsonResponse, type Session } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function POST(request: NextRequest) {
  let session: Session | null = null;
  try {
    requireSameOrigin(request);
    const body = promoBodySchema.safeParse(await readJsonBody(request));
    if (!body.success) return jsonResponse({ error: "Cet échange n’est pas valide.", code: "invalid" }, null, 400);
    session = await getSession(request);
    if (!session) return jsonResponse({ error: "Connectez-vous pour échanger vos points.", code: "expired" }, null, 401);
    return jsonResponse(await consumePromoCode(session, body.data.expectedCost), session);
  } catch (error) { return errorResponse(error, session); }
}
