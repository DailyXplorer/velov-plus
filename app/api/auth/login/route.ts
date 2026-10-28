import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { loginSchema } from "@/lib/models";
import { login, requireSameOrigin, VelovError } from "@/lib/auth-protocol";
import { COOKIE, errorResponse, jsonResponse, setSessionCookies } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    if (!request.headers.get("content-type")?.startsWith("application/json") || Number(request.headers.get("content-length") ?? "0") > 4096) return jsonResponse({ error: "Vérifiez votre email et votre code à six chiffres." }, null, 400);
    const body: unknown = await request.json();
    const credentials = loginSchema.safeParse(body);
    if (!credentials.success) return jsonResponse({ error: "Saisissez un email et un code secret à six chiffres." }, null, 400);
    const existingDevice = request.cookies.get(COOKIE.device)?.value;
    const device = existingDevice && /^[a-zA-Z0-9-]{16,80}$/.test(existingDevice) ? existingDevice : randomUUID();
    const { tokens, deviceId } = await login(credentials.data, device);
    const response = jsonResponse({ connected: true });
    setSessionCookies(response, tokens, deviceId);
    return response;
  } catch (error) { return errorResponse(error instanceof SyntaxError ? new VelovError("credentials", "Vérifiez vos identifiants.") : error); }
}
