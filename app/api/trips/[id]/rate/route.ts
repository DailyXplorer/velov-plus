import { NextRequest } from "next/server";
import { requireSameOrigin } from "@/lib/auth-protocol";
import { rateBodySchema } from "@/lib/models";
import { rateTrip } from "@/lib/velov";
import { errorResponse, getSession, jsonResponse } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(request);
    const { id } = await params;
    if (!request.headers.get("content-type")?.startsWith("application/json") || Number(request.headers.get("content-length") ?? "0") > 1024) return jsonResponse({ error: "Cette note n’est pas valide.", code: "invalid" }, null, 400);
    const body = rateBodySchema.safeParse(await request.json().catch(() => null));
    if (!/^[\w-]{1,64}$/.test(id) || !body.success) return jsonResponse({ error: "Cette note n’est pas valide.", code: "invalid" }, null, 400);
    const session = await getSession(request);
    if (!session) return jsonResponse({ error: "Connectez-vous pour retrouver votre compte.", code: "expired" }, null, 401);
    await rateTrip(session, id, body.data);
    return jsonResponse({ rated: true }, session);
  } catch (error) { return errorResponse(error); }
}
