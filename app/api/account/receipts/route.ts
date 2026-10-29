import { NextRequest, NextResponse } from "next/server";
import { readJsonBody, requireSameOrigin } from "@/lib/auth-protocol";
import { receiptBodySchema } from "@/lib/models";
import { getReceipt } from "@/lib/velov";
import { errorResponse, getSession, jsonResponse, setSessionCookies, type Session } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function POST(request: NextRequest) {
  let session: Session | null = null;
  try {
    requireSameOrigin(request);
    const body = receiptBodySchema.safeParse(await readJsonBody(request));
    if (!body.success) return jsonResponse({ error: "Ce reçu n’est pas valide.", code: "invalid" }, null, 400);
    session = await getSession(request);
    if (!session) return jsonResponse({ error: "Connectez-vous pour télécharger vos reçus.", code: "expired" }, null, 401);
    const { outcome, pdf } = await getReceipt(session, body.data.subscriptionId, body.data.periodId);
    if (!pdf) return jsonResponse(outcome, session);
    const response = new NextResponse(new Uint8Array(pdf.bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${pdf.filename}"`, "Cache-Control": "private, no-store" } });
    if (session.renewed) setSessionCookies(response, session.renewed, session.device);
    return response;
  } catch (error) { return errorResponse(error, session); }
}
