import { z } from "zod";

export const GUEST_COOKIE = "vv_guest";
export const FAVORITES_KEY = "velov:guest-favorites";
const YEAR = 365 * 86_400;
const storedSchema = z.array(z.unknown());
const stationNumberSchema = z.number().int().positive();
type Store = Pick<Storage, "getItem" | "setItem">;
export type StartMode = "session" | "guest" | "signedOut";

export function startMode(cookies: { refresh?: string; guest?: string }): StartMode {
  if (cookies.refresh) return "session";
  return cookies.guest === "1" ? "guest" : "signedOut";
}

export function guestCookie(on: boolean, secure: boolean): string {
  return `${GUEST_COOKIE}=${on ? "1" : ""}; Path=/; SameSite=Lax; Max-Age=${on ? YEAR : 0}${secure ? "; Secure" : ""}`;
}

export function readFavorites(storage: Store): number[] {
  try {
    const stored = storedSchema.safeParse(JSON.parse(storage.getItem(FAVORITES_KEY) ?? "[]"));
    if (!stored.success) return [];
    return [...new Set(stored.data.filter((value): value is number => stationNumberSchema.safeParse(value).success))];
  } catch {
    return [];
  }
}

export function saveFavorites(storage: Store, list: number[]) {
  try { storage.setItem(FAVORITES_KEY, JSON.stringify(list)); } catch {}
}

export function toggleFavorite(list: number[], number: number, on: boolean): number[] {
  const others = list.filter((item) => item !== number);
  return on ? [...others, number] : others;
}
