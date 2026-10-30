import { NextRequest } from "next/server";
import { requireSameOrigin } from "@/lib/auth-protocol";
import { errorResponse, forgetSession } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 10;
export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    return forgetSession();
  } catch (error) { return errorResponse(error); }
}
