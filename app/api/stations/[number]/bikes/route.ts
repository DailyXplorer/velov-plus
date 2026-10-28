import { getStationBikes } from "@/lib/velov";
import { errorResponse, jsonResponse } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  if (!/^\d+$/.test(number) || Number(number) <= 0 || !Number.isSafeInteger(Number(number))) return jsonResponse({ error: "Numéro de station invalide.", code: "invalid" }, null, 400);
  try { return jsonResponse(await getStationBikes(Number(number))); }
  catch (error) { return errorResponse(error); }
}
