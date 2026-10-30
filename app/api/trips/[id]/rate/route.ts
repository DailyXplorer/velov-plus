import { NextRequest } from "next/server";
import { readJsonBody, requireSameOrigin } from "@/lib/auth-protocol";
import { rateBodySchema } from "@/lib/models";
import { rateTrip } from "@/lib/velov";
import { beforeSend, errorResponse, getSession, jsonResponse, type Session } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session: Session | null = null;
  try {
    requireSameOrigin(request);
    const { id } = await params;
    const body = rateBodySchema.safeParse(await readJsonBody(request));
    if (!/^[\w-]{1,64}$/.test(id) || !body.success) return jsonResponse({ error: "Cette note n’est pas valide.", code: "invalid" }, null, 400);
    session = await beforeSend(() => getSession(request));
    if (!session) return jsonResponse({ error: "Connectez-vous pour retrouver votre compte.", code: "expired" }, null, 401);
    const outcome = await rateTrip(session, id, body.data);
    return jsonResponse(outcome.ok ? { rated: true } : outcome, session);
  } catch (error) { return errorResponse(error, session); }
}
