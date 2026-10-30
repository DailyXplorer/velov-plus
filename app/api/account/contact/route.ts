import { NextRequest } from "next/server";
import { readJsonBody, requireSameOrigin } from "@/lib/auth-protocol";
import { CONTACT_BODY_LIMIT, contactBodySchema } from "@/lib/contact-models";
import { contactSupport } from "@/lib/velov";
import { beforeSend, errorResponse, getSession, jsonResponse, type Session } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function POST(request: NextRequest) {
  let session: Session | null = null;
  try {
    requireSameOrigin(request);
    const body = contactBodySchema.safeParse(await readJsonBody(request, CONTACT_BODY_LIMIT));
    if (!body.success) return jsonResponse({ error: "Votre message est vide ou trop long.", code: "invalid" }, null, 400);
    session = await beforeSend(() => getSession(request));
    if (!session) return jsonResponse({ error: "Connectez-vous pour contacter le service client.", code: "expired" }, null, 401);
    return jsonResponse(await contactSupport(session, body.data), session);
  } catch (error) { return errorResponse(error, session); }
}
