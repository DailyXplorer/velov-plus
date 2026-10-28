import { NextRequest } from "next/server";
import { readJsonBody, requireSameOrigin } from "@/lib/auth-protocol";
import { unlockBodySchema } from "@/lib/models";
import { unlockBike } from "@/lib/velov";
import { errorResponse, getSession, jsonResponse, type Session } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The release alone may wait 30 s, then 2 s and a read: a shorter limit would cut its answer, not the release.
export const maxDuration = 60;
export async function POST(request: NextRequest) {
  let session: Session | null = null;
  try {
    requireSameOrigin(request);
    const body = unlockBodySchema.safeParse(await readJsonBody(request));
    if (!body.success) return jsonResponse({ error: "Ce déverrouillage n’est pas valide.", code: "invalid" }, null, 400);
    session = await getSession(request);
    if (!session) return jsonResponse({ error: "Connectez-vous pour réserver ou déverrouiller.", code: "expired" }, null, 401);
    return jsonResponse(await unlockBike(session, body.data), session);
  } catch (error) { return errorResponse(error, session); }
}
