import { getStations } from "@/lib/velov";
import { errorResponse, jsonResponse } from "@/lib/session";

export const runtime = "nodejs";
export async function GET() {
  try { return jsonResponse(await getStations()); }
  catch (error) { return errorResponse(error); }
}
