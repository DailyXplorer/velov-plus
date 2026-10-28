import { NextRequest } from "next/server";
import { errorResponse, getSession, jsonResponse } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try { const session = await getSession(request); return jsonResponse({ connected: session !== null }, session); }
  catch (error) { return errorResponse(error); }
}
