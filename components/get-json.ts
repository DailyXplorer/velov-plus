import { z } from "zod";
import { type LoadError, dashboardSchema } from "@/lib/models";
import { networkDetail } from "@/lib/outcome";

const errorSchema = z.object({ error: z.string(), code: z.string().optional() });

export class ApiError extends Error {
  readonly status: number;
  readonly raw: string;
  constructor(message: string, status: number, raw: string) {
    super(message);
    this.status = status;
    this.raw = raw;
  }
}

function statusLine(status: number, code?: string) {
  return [`HTTP ${status}`, code && `Code ${code}`].filter(Boolean).join(" · ");
}

export function loadError(error: unknown, fallback: string): LoadError {
  return error instanceof ApiError ? { message: error.message, raw: error.raw } : { message: fallback, raw: null };
}

export async function getJson<T>(url: string, schema: z.ZodType<T>, unavailable: string, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const startedAt = Date.now();
  try {
    let response: Response;
    try { response = await fetch(url, { cache: "no-store", signal: controller.signal }); }
    catch (error) { throw new ApiError(unavailable, 0, networkDetail(error, Date.now() - startedAt)); }
    if (!response.ok) {
      const error = errorSchema.safeParse(await response.json().catch(() => null));
      throw new ApiError(error.success ? error.data.error : unavailable, response.status, statusLine(response.status, error.success ? error.data.code : undefined));
    }
    const parsed = schema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) throw new ApiError(unavailable, response.status, statusLine(response.status, "local.unreadable"));
    return parsed.data;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export function readDashboard() {
  return getJson("/api/dashboard", dashboardSchema, "Votre compte est momentanément indisponible.");
}
