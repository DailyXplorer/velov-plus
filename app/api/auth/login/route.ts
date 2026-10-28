import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { loginSchema } from "@/lib/models";
import { login, requireSameOrigin, VelovError } from "@/lib/auth-protocol";
import { COOKIE, errorResponse, jsonResponse, setDeviceCookie, setSessionCookies } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  let device: string | undefined;
  try {
    requireSameOrigin(request);
    if (!request.headers.get("content-type")?.startsWith("application/json") || Number(request.headers.get("content-length") ?? "0") > 4096) return jsonResponse({ error: "Vérifiez votre email et votre code à six chiffres." }, null, 400);
    const body: unknown = await request.json();
    const credentials = loginSchema.safeParse(body);
    if (!credentials.success) return jsonResponse({ error: "Saisissez un email et un code secret à six chiffres." }, null, 400);
    const existingDevice = request.cookies.get(COOKIE.device)?.value;
    device = existingDevice && /^[a-zA-Z0-9-]{16,80}$/.test(existingDevice) ? existingDevice : randomUUID();
    const { tokens, deviceId } = await login(credentials.data, device);
    const response = jsonResponse({ connected: true });
    setSessionCookies(response, tokens, deviceId);
    return response;
  } catch (error) {
    const response = errorResponse(error instanceof SyntaxError ? new VelovError("credentials", "Vérifiez vos identifiants.") : error);
    if (device) setDeviceCookie(response, device);
    return response;
  }
}
