import { NextRequest } from "next/server";
import { OIDC, requireSameOrigin } from "@/lib/auth-protocol";
import { COOKIE, clearSessionCookies, errorResponse, jsonResponse } from "@/lib/session";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const token = request.cookies.get(COOKIE.identity)?.value;
    if (token) {
      const url = new URL(`${OIDC}/logout`);
      url.search = new URLSearchParams({ id_token_hint: token, post_logout_redirect_uri: "https://velov.grandlyon.com/openid_connect_logout" }).toString();
      await fetch(url, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(10_000) }).catch(() => null);
    }
    const response = jsonResponse({ connected: false });
    clearSessionCookies(response);
    return response;
  } catch (error) { return errorResponse(error); }
}
