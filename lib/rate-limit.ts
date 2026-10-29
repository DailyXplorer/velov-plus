export const LOGIN_LIMIT = 10;
export const LOGIN_WINDOW = 60_000;
export const RATE_LIMITED = "Trop de tentatives de connexion. Réessayez dans une minute.";

export function createRateLimit(limit = LOGIN_LIMIT, window = LOGIN_WINDOW, now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  return (key: string) => {
    const at = now();
    const recent = (hits.get(key) ?? []).filter((hit) => at - hit < window);
    const allowed = recent.length < limit;
    if (allowed) recent.push(at);
    hits.set(key, recent);
    if (hits.size > 10_000) for (const [other, list] of hits) if (!list.some((hit) => at - hit < window)) hits.delete(other);
    return allowed;
  };
}

export function clientAddress(request: Request) {
  const forwarded = request.headers.get("x-vercel-forwarded-for") ?? request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}
