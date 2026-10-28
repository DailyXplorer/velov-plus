import { getBike } from "@/lib/velov";
import { errorResponse, jsonResponse } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET(_request: Request, { params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  if (!/^\d+$/.test(number) || Number(number) <= 0 || !Number.isSafeInteger(Number(number))) return jsonResponse({ error: "Numéro de vélo invalide.", code: "invalid" }, null, 400);
  try {
    const bike = await getBike(Number(number));
    return bike ? jsonResponse(bike) : jsonResponse({ error: "Ce vélo est introuvable.", code: "not-found" }, null, 404);
  } catch (error) { return errorResponse(error); }
}
