import { NextRequest } from "next/server";
import { endSession, requireSameOrigin } from "@/lib/auth-protocol";
import { COOKIE, clearSessionCookies, errorResponse, jsonResponse } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 30;
export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const remoteLogout = await endSession({ refreshToken: request.cookies.get(COOKIE.refresh)?.value, idToken: request.cookies.get(COOKIE.identity)?.value });
    const response = jsonResponse({ connected: false, remoteLogout });
    clearSessionCookies(response);
    return response;
  } catch (error) { return errorResponse(error); }
}
