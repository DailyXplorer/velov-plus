import { NextRequest } from "next/server";
import { readJsonBody, requireSameOrigin } from "@/lib/auth-protocol";
import { profileBodySchema } from "@/lib/models";
import { updateProfile } from "@/lib/velov";
import { errorResponse, getSession, jsonResponse, type Session } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function PATCH(request: NextRequest) {
  let session: Session | null = null;
  try {
    requireSameOrigin(request);
    const body = profileBodySchema.safeParse(await readJsonBody(request));
    if (!body.success) return jsonResponse({ error: "Ces coordonnées ne sont pas valides.", code: "invalid" }, null, 400);
    session = await getSession(request);
    if (!session) return jsonResponse({ error: "Connectez-vous pour modifier votre compte.", code: "expired" }, null, 401);
    return jsonResponse(await updateProfile(session, body.data), session);
  } catch (error) { return errorResponse(error, session); }
}
