import { NextRequest } from "next/server";
import { readJsonBody, requireSameOrigin } from "@/lib/auth-protocol";
import { viaBodySchema } from "@/lib/via-models";
import { requestExtraTime } from "@/lib/velov";
import { errorResponse, getSession, jsonResponse, type Session } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function POST(request: NextRequest) {
  let session: Session | null = null;
  try {
    requireSameOrigin(request);
    const body = viaBodySchema.safeParse(await readJsonBody(request));
    if (!body.success) return jsonResponse({ error: "Choisissez une station valide.", code: "invalid" }, null, 400);
    session = await getSession(request);
    if (!session) return jsonResponse({ error: "Connectez-vous pour demander des minutes supplémentaires.", code: "expired" }, null, 401);
    return jsonResponse(await requestExtraTime(session, body.data), session);
  } catch (error) { return errorResponse(error, session); }
}
