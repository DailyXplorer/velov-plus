import type { Check } from "./outcome.ts";
import type { Dashboard, ProfileBody } from "./models.ts";

type Profile = Dashboard["profile"];

export function compare<T>(actual: T | null | undefined, wanted: T): Check {
  if (actual === null || actual === undefined) return "unknown";
  return actual === wanted ? "applied" : "unchanged";
}

export function autoSpendCheck(data: Dashboard, wanted: boolean): Check {
  return compare(data.rewards.autoSpend, wanted);
}

export function favoriteCheck(data: Dashboard, station: number, wanted: boolean): Check {
  return compare(data.profile.favorites.includes(station), wanted);
}

export function renewalCheck(data: Dashboard, subscriptionId: string, wanted: boolean): Check {
  const subscription = data.subscription === "unavailable" ? null : data.subscription;
  return subscription?.id === subscriptionId ? compare(subscription.autoRenewal, wanted) : "unknown";
}

export function ratingCheck(data: Dashboard, tripId: string): Check {
  return compare(data.trips?.find((trip) => trip.id === tripId)?.isRated, true);
}

const PROFILE_FIELDS = ["firstName", "lastName", "address", "zipCode", "city", "country", "phoneNumber"] as const;
type Mask = ReadonlySet<string>;

const maskOf = (body: ProfileBody): Mask => new Set(PROFILE_FIELDS.filter((field) => body[field] !== undefined));

function fieldsOf(profile: Profile, mask: Mask) {
  return JSON.stringify([
    mask.has("firstName") ? profile.firstName : null,
    mask.has("lastName") ? profile.lastName : null,
    mask.has("address") ? [profile.address ?? "", profile.addressComplement ?? ""] : null,
    mask.has("zipCode") ? profile.zipCode ?? "" : null,
    mask.has("city") ? profile.city ?? "" : null,
    mask.has("country") ? profile.country ?? "" : null,
    mask.has("phoneNumber") ? profile.phoneNumber ?? "" : null
  ]).toLocaleLowerCase("fr-FR");
}

function wantedOf(body: ProfileBody) {
  return JSON.stringify([body.firstName ?? null, body.lastName ?? null, body.address ? [body.address.name, body.address.complement] : null, body.zipCode ?? null, body.city ?? null, body.country ?? null, body.phoneNumber ?? null]).toLocaleLowerCase("fr-FR");
}

export function profileCheck(before: Profile, after: Profile, body: ProfileBody): Check {
  const mask = maskOf(body);
  const now = fieldsOf(after, mask);
  if (now === wantedOf(body)) return "applied";
  return now === fieldsOf(before, mask) ? "unchanged" : "unknown";
}

async function hashOf(text: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function profileMeta(before: Profile, body: ProfileBody): Promise<Record<string, string>> {
  const mask = maskOf(body);
  return { fields: [...mask].join(","), wanted: await hashOf(wantedOf(body)), before: await hashOf(fieldsOf(before, mask)) };
}

export async function storedProfileCheck(after: Profile, meta: Record<string, string | number>): Promise<Check> {
  const { fields, wanted, before } = meta;
  if (typeof fields !== "string" || typeof wanted !== "string" || typeof before !== "string" || !fields) return "unknown";
  const now = await hashOf(fieldsOf(after, new Set(fields.split(","))));
  if (now === wanted) return "applied";
  return now === before ? "unchanged" : "unknown";
}
