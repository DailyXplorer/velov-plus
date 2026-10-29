// The "Modifier mes coordonnées" form without React: what the user typed, and the PATCH body it becomes.
import { ADDRESS_MAX, NAME_MAX, type Dashboard, type ProfileBody, normalizePhone, profileBodySchema } from "./models.ts";

export const countries = [
  { value: "FR", label: "France" }, { value: "BE", label: "Belgique" }, { value: "CH", label: "Suisse" }, { value: "LU", label: "Luxembourg" },
  { value: "DE", label: "Allemagne" }, { value: "ES", label: "Espagne" }, { value: "IT", label: "Italie" }, { value: "GB", label: "Royaume-Uni" }
];
export const countryName = (code: string | null) => countries.find((country) => country.value === code)?.label ?? code;
type Profile = Dashboard["profile"];
export type Draft = { firstName: string; lastName: string; address: string; complement: string; zipCode: string; city: string; country: string; phone: string };
export type Change = { label: string; before: string; after: string };

/** The current values as Vélo’v stores them: a name is never reformatted unless the user edits it. */
export function draftOf(profile: Profile): Draft {
  return { firstName: profile.firstName, lastName: profile.lastName, address: profile.address ?? "", complement: profile.addressComplement ?? "", zipCode: profile.zipCode ?? "", city: profile.city ?? "", country: profile.country ?? "FR", phone: profile.phoneNumber ?? "" };
}

const nameError = (field: unknown) => `${field === "firstName" ? "Prénom" : "Nom"} invalide : lettres, espaces, apostrophes et traits d’union uniquement, ${NAME_MAX} caractères au plus.`;

/** The PATCH body with only the fields that changed, or the first problem to fix. */
export function changesOf(profile: Profile, draft: Draft): { body: ProfileBody; changes: Change[] } | { error: string } | null {
  const body: ProfileBody = {};
  const changes: Change[] = [];
  const trimmed = { address: draft.address.trim(), complement: draft.complement.trim(), zipCode: draft.zipCode.trim(), city: draft.city.trim() };
  const changed = (value: string, before: string | null) => value !== (before ?? "");
  for (const [key, label, empty] of [["firstName", "Prénom", "Saisissez votre prénom."], ["lastName", "Nom", "Saisissez votre nom."]] as const) {
    const value = draft[key].trim().replace(/ {2,}/g, " ");
    if (!changed(draft[key], profile[key]) || !changed(value, profile[key])) continue;
    if (!value) return { error: empty };
    body[key] = value;
    changes.push({ label, before: profile[key] || "—", after: value });
  }
  if (changed(trimmed.address, profile.address) || changed(trimmed.complement, profile.addressComplement)) {
    if (!trimmed.address) return { error: "Saisissez une adresse." };
    body.address = { name: trimmed.address, complement: trimmed.complement };
    changes.push({ label: "Adresse", before: [profile.address, profile.addressComplement].filter(Boolean).join(", ") || "—", after: [trimmed.address, trimmed.complement].filter(Boolean).join(", ") });
  }
  if (changed(trimmed.zipCode, profile.zipCode)) { body.zipCode = trimmed.zipCode; changes.push({ label: "Code postal", before: profile.zipCode ?? "—", after: trimmed.zipCode }); }
  if (changed(trimmed.city, profile.city)) { body.city = trimmed.city; changes.push({ label: "Ville", before: profile.city ?? "—", after: trimmed.city }); }
  if (changed(draft.country, profile.country)) { body.country = draft.country; changes.push({ label: "Pays", before: countryName(profile.country) ?? "—", after: countryName(draft.country) ?? draft.country }); }
  const phone = normalizePhone(draft.phone, draft.country);
  if (phone !== (profile.phoneNumber ?? "") && draft.phone.trim() !== (profile.phoneNumber ?? "")) { body.phoneNumber = phone; changes.push({ label: "Téléphone", before: profile.phoneNumber ?? "—", after: phone }); }
  if (!changes.length) return null;
  const parsed = profileBodySchema.safeParse(body);
  if (parsed.success) return { body: parsed.data, changes };
  const field = parsed.error.issues[0]?.path[0];
  return { error: field === "firstName" || field === "lastName" ? nameError(field) : field === "phoneNumber" ? "Numéro de téléphone invalide. Exemple : 06 12 34 56 78." : field === "zipCode" ? "Code postal invalide." : field === "city" ? "Saisissez une ville." : field === "address" ? `L’adresse ne doit pas dépasser ${ADDRESS_MAX} caractères.` : "Coordonnées invalides." };
}
