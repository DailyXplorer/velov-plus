import { z } from "zod";

const errorSchema = z.object({ error: z.string() });

/** status 0: no answer at all (network, timeout, or the caller aborted). */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** GETs one of our API routes within 25 s. Any failure becomes an ApiError with a French message, never a raw parse error. */
export async function getJson<T>(url: string, schema: z.ZodType<T>, unavailable: string, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    let response: Response;
    try { response = await fetch(url, { cache: "no-store", signal: controller.signal }); }
    catch { throw new ApiError(unavailable, 0); }
    if (!response.ok) {
      const error = errorSchema.safeParse(await response.json().catch(() => null));
      throw new ApiError(error.success ? error.data.error : unavailable, response.status);
    }
    const parsed = schema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) throw new ApiError(unavailable, response.status);
    return parsed.data;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
