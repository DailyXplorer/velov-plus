import { getStations } from "@/lib/velov";
import { errorResponse, jsonResponse } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 30;
export async function GET() {
  try {
    const response = jsonResponse(await getStations());
    // Public data: a CDN may share it briefly; errors keep no-store.
    response.headers.set("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
    return response;
  } catch (error) { return errorResponse(error); }
}
