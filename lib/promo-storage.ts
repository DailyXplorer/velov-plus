import { z } from "zod";
import { accountDigest } from "./operations.ts";

const savedSchema = z.array(z.object({ code: z.string().min(1), createdAt: z.string() }));
export type SavedPromo = z.infer<typeof savedSchema>[number];
type Store = Pick<Storage, "getItem" | "setItem">;

export async function promoStorageKey(account: string): Promise<string> {
  return `velov:promocodes:v1:${await accountDigest(account)}`;
}

export function readPromoCodes(storage: Store, key: string): SavedPromo[] {
  const raw = storage.getItem(key);
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
