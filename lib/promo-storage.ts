import { z } from "zod";

const savedSchema = z.array(z.object({ code: z.string().min(1), createdAt: z.string() }));
export type SavedPromo = z.infer<typeof savedSchema>[number];
type Store = Pick<Storage, "getItem" | "setItem">;

/** No account address is stored in the key. Codes remain local to this browser and account. */
export async function promoStorageKey(account: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(account.trim().toLowerCase()));
  return `velov:promocodes:v1:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function readPromoCodes(storage: Store, key: string): SavedPromo[] {
  const raw = storage.getItem(key);
  // Do not overwrite corrupt storage: an older code may still be recoverable there.
  return raw === null ? [] : savedSchema.parse(JSON.parse(raw));
}

export function preparePromoStorage(storage: Store, key: string): SavedPromo[] {
  const codes = readPromoCodes(storage, key);
  storage.setItem(key, JSON.stringify(codes));
  return codes;
}

export function savePromoCode(storage: Store, key: string, code: string): SavedPromo[] {
  const current = readPromoCodes(storage, key);
  const next = current.some((entry) => entry.code === code) ? current : [...current, { code, createdAt: new Date().toISOString() }];
  storage.setItem(key, JSON.stringify(next));
  return next;
}
