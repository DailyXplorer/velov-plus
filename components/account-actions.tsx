"use client";

import { type ReactNode, useId, useRef, useState } from "react";
import { z } from "zod";
import { CheckIcon, DownloadSimpleIcon, StarIcon, XIcon } from "./icons";
import { ADDRESS_MAX, type Dashboard, type Outcome, type ProfileBody, type Receipt, type Station, type Trip, autoSpendResultSchema, capitalize, formatDate, normalizePhone, outcomeSchema, profileBodySchema } from "@/lib/models";
import { Button, Modal, SelectField } from "./ui";

const errorSchema = z.object({ error: z.string(), code: z.string().optional() });
const failure = (httpStatus: number, code: string | null, message: string): Outcome => ({ ok: false, httpStatus, transactionState: null, code, message, detail: null });
export const SOON = "Bientôt disponible";

/** One request to our API, never repeated: the outcome says what Vélo’v answered, or why there was no answer. */
async function sendWrite(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<{ outcome: Outcome; data: unknown }> {
  let response: Response;
  try {
    response = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(40_000) });
  } catch {
    return { outcome: failure(0, "network", "Le serveur ne répond pas. Actualisez la page avant de réessayer."), data: null };
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = errorSchema.safeParse(data);
    return { outcome: failure(response.status, error.success ? error.data.code ?? null : null, error.success ? error.data.error : "Le service ne répond pas."), data };
  }
  const outcome = outcomeSchema.safeParse(data);
  return { outcome: outcome.success ? outcome.data : failure(response.status, "local.unreadable", "Réponse inattendue. Actualisez la page avant de réessayer."), data };
}

function RawStatus({ outcome }: { outcome: Outcome }) {
  return <p className="bike-action-raw">{[`HTTP ${outcome.httpStatus || "aucune réponse"}`, `Code ${outcome.code ?? "—"}`, outcome.detail && capitalize(outcome.detail)].filter(Boolean).join(" · ")}</p>;
}

type Step = { kind: "confirm" } | { kind: "sending" } | { kind: "done" } | { kind: "failed"; outcome: Outcome };

/** Every change to the account: a question, one request per "Confirmer", then the result; the raw status shows on failure only. */
function ConfirmDialog({ title, children, success, run, onClose }: { title: string; children: ReactNode; success: string; run: () => Promise<Outcome>; onClose: () => void }) {
  const titleId = useId();
  const [step, setStep] = useState<Step>({ kind: "confirm" });
  const inFlight = useRef(false);

  async function confirm() {
    if (inFlight.current) return;
    inFlight.current = true;
    setStep({ kind: "sending" });
    try {
      const outcome = await run();
      setStep(outcome.ok ? { kind: "done" } : { kind: "failed", outcome });
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <Modal titleId={titleId} onClose={step.kind === "sending" ? () => {} : onClose}>
      <div className="modal-heading">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" aria-label="Fermer" disabled={step.kind === "sending"} onClick={onClose}><XIcon size={20} weight="light"/></button>
      </div>
      {step.kind === "done" ? (
        <>
          <p className="write-done" role="status"><CheckIcon size={16} weight="bold" aria-hidden="true"/>{success}</p>
          <div className="modal-actions"><Button variant="secondary" onClick={onClose}>Fermer</Button></div>
        </>
      ) : (
        <>
          <div className="write-question">{children}</div>
          {step.kind === "failed" ? <><p className="form-error" role="alert">{step.outcome.message ?? "La modification n’a pas abouti."}</p><RawStatus outcome={step.outcome}/></> : null}
          <div className="modal-actions">
            <Button variant="ghost" disabled={step.kind === "sending"} onClick={onClose}>Annuler</Button>
            <Button pending={step.kind === "sending"} onClick={() => void confirm()}>Confirmer</Button>
          </div>
        </>
      )}
    </Modal>
  );
}

function Switch({ checked, label, disabled = false, onClick }: { checked: boolean; label: string; disabled?: boolean; onClick?: () => void }) {
  return <button type="button" role="switch" className="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onClick}/>;
}

/** Points tab: "Utilisation automatique" as a real switch (PATCH /rewards). */
export function AutoSpendSetting({ value, onChanged }: { value: boolean | null; onChanged: (value: boolean) => void }) {
  const [asking, setAsking] = useState(false);
  const next = !value;
  return (
    <div className="setting-row">
      <div>
        <span className="metric-label">Utilisation automatique</span>
        <strong className="setting-value">{value == null ? "Indisponible pour le moment" : value ? "Activée" : "Désactivée"}</strong>
      </div>
      {value != null ? <Switch checked={value} label="Utilisation automatique des points" onClick={() => setAsking(true)}/> : null}
      {asking ? (
        <ConfirmDialog title={next ? "Activer l’utilisation automatique ?" : "Désactiver l’utilisation automatique ?"} success={next ? "Utilisation automatique activée." : "Utilisation automatique désactivée."} onClose={() => setAsking(false)}
          run={async () => {
            const { outcome, data } = await sendWrite("/api/account/rewards", "PATCH", { autoSpend: next });
            const result = autoSpendResultSchema.safeParse(data);
            if (outcome.ok) onChanged(result.success && result.data.autoSpend != null ? result.data.autoSpend : next);
            return outcome;
          }}>
          <p>{next ? "Vos points régleront automatiquement les minutes au-delà de la période gratuite." : "Vos points ne régleront plus les minutes au-delà de la période gratuite."}</p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

/** Star of the station sheet and panel: POST or DELETE /stationbookmarks/{n}/. */
export function FavoriteButton({ station, favorite, onChanged }: { station: Station; favorite: boolean; onChanged: (number: number, favorite: boolean) => void }) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      <button className={`icon-button favorite-button${favorite ? " is-favorite" : ""}`} aria-pressed={favorite} aria-label={favorite ? "Retirer des favoris" : "Ajouter aux favoris"} onClick={() => setAsking(true)}>
        <StarIcon size={19} weight={favorite ? "fill" : "light"}/>
      </button>
      {asking ? (
        <ConfirmDialog title={favorite ? "Retirer des favoris ?" : "Ajouter aux favoris ?"} success={favorite ? "Station retirée des favoris." : "Station ajoutée aux favoris."} onClose={() => setAsking(false)}
          run={async () => {
            const { outcome } = await sendWrite(`/api/account/favorites/${station.number}`, favorite ? "DELETE" : "POST");
            if (outcome.ok) onChanged(station.number, !favorite);
            return outcome;
          }}>
          <p>{station.name} <span className="write-muted">n° {station.number}</span></p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}

/** "Du 1 mars au 2 mars 2026": the period a receipt covers. */
function periodLabel({ start, end }: Receipt) {
  const day = { day: "numeric", month: "short", year: "numeric" } as const;
  if (start && end) return `Du ${formatDate(start, day)} au ${formatDate(end, day)}`;
  return start ? `Depuis le ${formatDate(start, day)}` : end ? `Jusqu’au ${formatDate(end, day)}` : "Dates inconnues";
}

/** The receipt POST only reads: no confirmation, but one request per click and the PDF saved as a file. */
function ReceiptRow({ receipt }: { receipt: Receipt }) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<Outcome | null>(null);

  async function download() {
    if (pending) return;
    setPending(true);
    setFailed(null);
    try {
      let response: Response;
      try {
        response = await fetch("/api/account/receipts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscriptionId: receipt.subscriptionId, periodId: receipt.periodId }), signal: AbortSignal.timeout(40_000) });
      } catch {
        setFailed(failure(0, "network", "Le serveur ne répond pas. Réessayez dans un instant."));
        return;
      }
      if (response.ok && response.headers.get("content-type")?.startsWith("application/pdf")) {
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement("a");
        link.href = url;
        link.download = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "recu-velov.pdf";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        return;
      }
      const data: unknown = await response.json().catch(() => null);
      const outcome = outcomeSchema.safeParse(data);
      const error = errorSchema.safeParse(data);
      setFailed(outcome.success ? outcome.data : failure(response.status, error.success ? error.data.code ?? null : null, error.success ? error.data.error : "Le reçu n’a pas pu être téléchargé."));
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="receipt-row">
      <span><strong>{receipt.title}</strong><small>{periodLabel(receipt)}</small></span>
      <Button variant="secondary" pending={pending} onClick={() => void download()} aria-label={`Télécharger le reçu, ${periodLabel(receipt)}`}><DownloadSimpleIcon size={17} weight="light" aria-hidden="true"/>Reçu</Button>
      {failed ? <div className="receipt-failed"><p className="form-error" role="alert">{failed.message}</p><RawStatus outcome={failed}/></div> : null}
    </li>
  );
}

export function Receipts({ receipts }: { receipts: Receipt[] | null }) {
  if (!receipts?.length) return null;
  return (
    <div className="receipts">
      <h3 className="metric-label">Reçus</h3>
      <ul>{receipts.map((receipt) => <ReceiptRow key={receipt.periodId} receipt={receipt}/>)}</ul>
    </div>
  );
}

export { AutoRenewal } from "./auto-renewal";

const countries = [
  { value: "FR", label: "France" }, { value: "BE", label: "Belgique" }, { value: "CH", label: "Suisse" }, { value: "LU", label: "Luxembourg" },
  { value: "DE", label: "Allemagne" }, { value: "ES", label: "Espagne" }, { value: "IT", label: "Italie" }, { value: "GB", label: "Royaume-Uni" }
];
const countryName = (code: string | null) => countries.find((country) => country.value === code)?.label ?? code;
type Profile = Dashboard["profile"];
type Draft = { address: string; complement: string; zipCode: string; city: string; country: string; phone: string };
type Change = { label: string; before: string; after: string };

function draftOf(profile: Profile): Draft {
  return { address: profile.address ?? "", complement: profile.addressComplement ?? "", zipCode: profile.zipCode ?? "", city: profile.city ?? "", country: profile.country ?? "FR", phone: profile.phoneNumber ?? "" };
}

/** The PATCH body with only the fields that changed, or the first problem to fix. */
function changesOf(profile: Profile, draft: Draft): { body: ProfileBody; changes: Change[] } | { error: string } | null {
  const body: ProfileBody = {};
  const changes: Change[] = [];
  const trimmed = { address: draft.address.trim(), complement: draft.complement.trim(), zipCode: draft.zipCode.trim(), city: draft.city.trim() };
  const changed = (value: string, before: string | null) => value !== (before ?? "");
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
  return { error: field === "phoneNumber" ? "Numéro de téléphone invalide. Exemple : 06 12 34 56 78." : field === "zipCode" ? "Code postal invalide." : field === "city" ? "Saisissez une ville." : field === "address" ? `L’adresse ne doit pas dépasser ${ADDRESS_MAX} caractères.` : "Coordonnées invalides." };
}

function Field({ label, value, onChange, maxLength, inputMode, autoComplete }: { label: string; value: string; onChange: (value: string) => void; maxLength?: number; inputMode?: "tel" | "numeric" | "text"; autoComplete?: string }) {
  return <label className="field"><span className="metric-label">{label}</span><input value={value} maxLength={maxLength} inputMode={inputMode} autoComplete={autoComplete} onChange={(event) => onChange(event.target.value)}/></label>;
}

/** Address, postcode, city, country and phone only (PATCH /accounts/{id}); names, email and secret code stay with Vélo’v. */
export function ProfileCoordinates({ profile, onSaved }: { profile: Profile; onSaved: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ body: ProfileBody; changes: Change[] } | null>(null);
  const set = (key: keyof Draft) => (value: string) => setDraft((current) => current && { ...current, [key]: value });

  function review() {
    if (!draft) return;
    const result = changesOf(profile, draft);
    if (!result) { setError("Vous n’avez rien modifié."); return; }
    if ("error" in result) { setError(result.error); return; }
    setError(null);
    setAsking(result);
  }

  return (
    <>
      {draft ? (
        <form className="profile-form" onSubmit={(event) => { event.preventDefault(); review(); }} noValidate>
          <Field label="Adresse" value={draft.address} onChange={set("address")} maxLength={ADDRESS_MAX} autoComplete="address-line1"/>
          <Field label="Complément" value={draft.complement} onChange={set("complement")} maxLength={ADDRESS_MAX} autoComplete="address-line2"/>
          <div className="field-pair">
            <Field label="Code postal" value={draft.zipCode} onChange={set("zipCode")} maxLength={10} inputMode="numeric" autoComplete="postal-code"/>
            <Field label="Ville" value={draft.city} onChange={set("city")} maxLength={60} autoComplete="address-level2"/>
          </div>
          <SelectField label="Pays" value={draft.country} onChange={set("country")} options={countries.some((country) => country.value === draft.country) ? countries : [...countries, { value: draft.country, label: draft.country }]}/>
          <Field label="Téléphone" value={draft.phone} onChange={set("phone")} maxLength={20} inputMode="tel" autoComplete="tel"/>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="profile-form-actions">
            <Button variant="ghost" onClick={() => setDraft(null)}>Annuler</Button>
            <button type="submit" className="button button-primary"><span className="button-content">Enregistrer</span></button>
          </div>
        </form>
      ) : (
        <>
          <dl className="account-details">
            <div><dt>Adresse</dt><dd>{[profile.address, profile.addressComplement].filter(Boolean).join(", ") || "Non renseignée"}<small>{[profile.zipCode, profile.city].filter(Boolean).join(" ")}{profile.country ? `${profile.zipCode || profile.city ? " · " : ""}${countryName(profile.country)}` : ""}</small></dd></div>
            <div><dt>Téléphone</dt><dd>{profile.phoneNumber ?? "Non renseigné"}</dd></div>
          </dl>
          <Button variant="secondary" onClick={() => { setError(null); setDraft(draftOf(profile)); }}>Modifier mes coordonnées</Button>
        </>
      )}
      {asking ? (
        <ConfirmDialog title="Enregistrer les modifications ?" success="Coordonnées enregistrées." onClose={() => setAsking(null)}
          run={async () => {
            const { outcome } = await sendWrite("/api/account/profile", "PATCH", asking.body);
            // Back to the coordinates, read again from Vélo’v.
            if (outcome.ok) { setDraft(null); onSaved(); }
            return outcome;
          }}>
          <dl className="bike-action-facts">{asking.changes.map((change) => <div key={change.label}><dt>{change.label}</dt><dd>{change.after}<small className="write-muted">Avant : {change.before}</small></dd></div>)}</dl>
        </ConfirmDialog>
      ) : null}
    </>
  );
}

export { ContactSupport } from "./contact-support";

export { InviteFriend } from "./invite-friend";
