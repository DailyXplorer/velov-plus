import { ADDRESS_MAX, NAME_MAX, type Dashboard, type ProfileBody, formatName, normalizePhone, profileBodySchema } from "./models.ts";

export const countries = [
  { value: "FR", label: "France" }, { value: "BE", label: "Belgique" }, { value: "CH", label: "Suisse" }, { value: "LU", label: "Luxembourg" },
  { value: "DE", label: "Allemagne" }, { value: "ES", label: "Espagne" }, { value: "IT", label: "Italie" }, { value: "GB", label: "Royaume-Uni" }
];
export const countryName = (code: string | null) => countries.find((country) => country.value === code)?.label ?? code;
type Profile = Dashboard["profile"];
export type Draft = { firstName: string; lastName: string; address: string; complement: string; zipCode: string; city: string; country: string; phone: string };

export function draftOf(profile: Profile): Draft {
  return { firstName: formatName(profile.firstName), lastName: formatName(profile.lastName), address: profile.address ?? "", complement: profile.addressComplement ?? "", zipCode: profile.zipCode ?? "", city: profile.city ?? "", country: profile.country ?? "FR", phone: profile.phoneNumber ?? "" };
}

const nameError = (field: unknown) => `${field === "firstName" ? "Prénom" : "Nom"} invalide : lettres, espaces, apostrophes et traits d’union uniquement, ${NAME_MAX} caractères au plus.`;

export function changesOf(profile: Profile, draft: Draft): { body: ProfileBody } | { error: string } | null {
  const body: ProfileBody = {};
  const trimmed = { address: draft.address.trim(), complement: draft.complement.trim(), zipCode: draft.zipCode.trim(), city: draft.city.trim() };
  const changed = (value: string, before: string | null) => value !== (before ?? "");
  for (const [key, empty] of [["firstName", "Saisissez votre prénom."], ["lastName", "Saisissez votre nom."]] as const) {
    const value = draft[key].trim().replace(/ {2,}/g, " ");
    if (!changed(value, profile[key]) || value === formatName(profile[key])) continue;
    if (!value) return { error: empty };
    body[key] = value;
  }
  if (changed(trimmed.address, profile.address) || changed(trimmed.complement, profile.addressComplement)) {
    if (!trimmed.address) return { error: "Saisissez une adresse." };
    body.address = { name: trimmed.address, complement: trimmed.complement };
  }
  if (changed(trimmed.zipCode, profile.zipCode)) body.zipCode = trimmed.zipCode;
  if (changed(trimmed.city, profile.city)) body.city = trimmed.city;
  if (changed(draft.country, profile.country)) body.country = draft.country;
  const phone = normalizePhone(draft.phone, draft.country);
  if (phone !== (profile.phoneNumber ?? "") && draft.phone.trim() !== (profile.phoneNumber ?? "")) body.phoneNumber = phone;
  if (!Object.keys(body).length) return null;
  const parsed = profileBodySchema.safeParse(body);
  if (parsed.success) return { body: parsed.data };
  const field = parsed.error.issues[0]?.path[0];
  return { error: field === "firstName" || field === "lastName" ? nameError(field) : field === "phoneNumber" ? "Numéro de téléphone invalide. Exemple : 06 12 34 56 78." : field === "zipCode" ? "Code postal invalide." : field === "city" ? "Saisissez une ville." : field === "address" ? `L’adresse ne doit pas dépasser ${ADDRESS_MAX} caractères.` : "Coordonnées invalides." };
}
