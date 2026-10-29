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

function fieldsOf(profile: Profile, body: ProfileBody) {
  return JSON.stringify([
    body.firstName !== undefined ? profile.firstName : null,
    body.lastName !== undefined ? profile.lastName : null,
    body.address !== undefined ? [profile.address ?? "", profile.addressComplement ?? ""] : null,
    body.zipCode !== undefined ? profile.zipCode ?? "" : null,
    body.city !== undefined ? profile.city ?? "" : null,
    body.country !== undefined ? profile.country ?? "" : null,
    body.phoneNumber !== undefined ? profile.phoneNumber ?? "" : null
  ]).toLocaleLowerCase("fr-FR");
}

function wantedOf(body: ProfileBody) {
  return JSON.stringify([body.firstName ?? null, body.lastName ?? null, body.address ? [body.address.name, body.address.complement] : null, body.zipCode ?? null, body.city ?? null, body.country ?? null, body.phoneNumber ?? null]).toLocaleLowerCase("fr-FR");
}

export function profileCheck(before: Profile, after: Profile, body: ProfileBody): Check {
  const now = fieldsOf(after, body);
  if (now === wantedOf(body)) return "applied";
  return now === fieldsOf(before, body) ? "unchanged" : "unknown";
}
