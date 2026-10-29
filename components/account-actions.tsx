"use client";

import { type ReactNode, useId, useRef, useState } from "react";
import { z } from "zod";
import { DownloadSimpleIcon, StarIcon, XIcon } from "./icons";
import { ADDRESS_MAX, NAME_MAX, type Dashboard, type Outcome, type ProfileBody, type Receipt, type Station, type Trip, autoSpendResultSchema, capitalize, formatDate, outcomeSchema } from "@/lib/models";
import { type Draft, changesOf, countries, countryName, draftOf } from "@/lib/profile-draft";
import { type Check, UNCERTAIN, UNVERIFIED, isUncertain, settle } from "@/lib/outcome";
import { autoSpendCheck, favoriteCheck, profileCheck } from "@/lib/checks";
import { readDashboard } from "./get-json";
import { Button, Modal, SelectField } from "./ui";

const errorSchema = z.object({ error: z.string(), code: z.string().optional() });
const failure = (httpStatus: number, code: string | null, message: string): Outcome => ({ ok: false, httpStatus, transactionState: null, code, message, detail: null });
export const SOON = "Bientôt disponible";

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

type Step = { kind: "confirm" } | { kind: "sending" } | { kind: "failed"; outcome: Outcome } | { kind: "uncertain"; outcome: Outcome; checking: boolean };

function ConfirmDialog({ title, children, run, check, onDone, onClose }: { title: string; children?: ReactNode; run: () => Promise<Outcome>; check: () => Promise<Check>; onDone: () => void; onClose: () => void }) {
  const titleId = useId();
  const [step, setStep] = useState<Step>({ kind: "confirm" });
  const inFlight = useRef(false);

  async function resolve(outcome: Outcome) {
    setStep({ kind: "uncertain", outcome, checking: true });
    const settled = await settle(outcome, check);
    if (settled.kind === "done") { onDone(); onClose(); }
    else if (settled.kind === "refused") setStep({ kind: "failed", outcome: settled.outcome });
    else setStep({ kind: "uncertain", outcome: { ...settled.outcome, message: settled.outcome.message ?? UNVERIFIED }, checking: false });
  }

  async function confirm() {
    if (inFlight.current) return;
    inFlight.current = true;
    setStep({ kind: "sending" });
    try {
      const outcome = await run();
      if (outcome.ok) { onDone(); onClose(); }
      else if (isUncertain(outcome)) await resolve(outcome);
      else setStep({ kind: "failed", outcome });
    } finally {
      inFlight.current = false;
    }
  }

  const busy = step.kind === "sending" || step.kind === "uncertain" && step.checking;
  return (
    <Modal titleId={titleId} onClose={busy ? () => {} : onClose}>
      <div className="modal-heading">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" aria-label="Fermer" disabled={busy} onClick={onClose}><XIcon size={20} weight="light"/></button>
      </div>
      {children ? <div className="write-question">{children}</div> : null}
      {step.kind === "failed" || step.kind === "uncertain" ? <><p className="form-error" role="alert">{step.outcome.message ?? "La modification n’a pas abouti."}</p><RawStatus outcome={step.outcome}/></> : null}
      {step.kind === "uncertain" ? <p className="uncertain-note">{UNCERTAIN}</p> : null}
      <div className="modal-actions">
        {step.kind === "uncertain" ? <><Button variant="ghost" disabled={busy} onClick={onClose}>Fermer</Button><Button variant="secondary" pending={step.checking} onClick={() => void resolve(step.outcome)}>Vérifier</Button></> : <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>Annuler</Button>
          <Button pending={step.kind === "sending"} onClick={() => void confirm()}>Confirmer</Button>
        </>}
      </div>
    </Modal>
  );
}

function Switch({ checked, label, disabled = false, onClick }: { checked: boolean; label: string; disabled?: boolean; onClick?: () => void }) {
  return <button type="button" role="switch" className="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onClick}/>;
}

export function AutoSpendSetting({ value, onChanged }: { value: boolean | null; onChanged: (value: boolean) => void }) {
  const [asking, setAsking] = useState(false);
  const confirmed = useRef<boolean | null>(null);
  const next = !value;
  return (
    <div className="setting-row">
      <div>
        <span className="metric-label">Utilisation automatique</span>
        <strong className="setting-value">{value == null ? "Indisponible pour le moment" : value ? "Activée" : "Désactivée"}</strong>
      </div>
      {value != null ? <Switch checked={value} label="Utilisation automatique des points" onClick={() => setAsking(true)}/> : null}
      {asking ? (
        <ConfirmDialog title={next ? "Activer l’utilisation automatique ?" : "Désactiver l’utilisation automatique ?"} onClose={() => setAsking(false)}
          onDone={() => onChanged(confirmed.current ?? next)} check={async () => autoSpendCheck(await readDashboard(), next)}
          run={async () => {
            const { outcome, data } = await sendWrite("/api/account/rewards", "PATCH", { autoSpend: next });
            const result = autoSpendResultSchema.safeParse(data);
            confirmed.current = outcome.ok && result.success ? result.data.autoSpend : null;
            return outcome;
          }}>
          <p>{next ? "Vos points régleront automatiquement les minutes au-delà de la période gratuite." : "Vos points ne régleront plus les minutes au-delà de la période gratuite."}</p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

export function FavoriteButton({ station, favorite, onChanged }: { station: Station; favorite: boolean; onChanged: (number: number, favorite: boolean) => void }) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      <button className={`icon-button favorite-button${favorite ? " is-favorite" : ""}`} aria-pressed={favorite} aria-label={favorite ? "Retirer des favoris" : "Ajouter aux favoris"} onClick={() => setAsking(true)}>
        <StarIcon size={19} weight={favorite ? "fill" : "light"}/>
      </button>
      {asking ? (
        <ConfirmDialog title={favorite ? "Retirer des favoris ?" : "Ajouter aux favoris ?"} onClose={() => setAsking(false)}
          onDone={() => onChanged(station.number, !favorite)} check={async () => favoriteCheck(await readDashboard(), station.number, !favorite)}
          run={async () => (await sendWrite(`/api/account/favorites/${station.number}`, favorite ? "DELETE" : "POST")).outcome}/>
      ) : null}
    </>
  );
}

function periodLabel({ start, end }: Receipt) {
  const day = { day: "numeric", month: "short", year: "numeric" } as const;
  if (start && end) return `Du ${formatDate(start, day)} au ${formatDate(end, day)}`;
  return start ? `Depuis le ${formatDate(start, day)}` : end ? `Jusqu’au ${formatDate(end, day)}` : "Dates inconnues";
}

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

type Profile = Dashboard["profile"];

function Field({ label, value, onChange, maxLength, inputMode, autoComplete }: { label: string; value: string; onChange: (value: string) => void; maxLength?: number; inputMode?: "tel" | "numeric" | "text"; autoComplete?: string }) {
  return <label className="field"><span className="metric-label">{label}</span><input value={value} maxLength={maxLength} inputMode={inputMode} autoComplete={autoComplete} onChange={(event) => onChange(event.target.value)}/></label>;
}

export function ProfileCoordinates({ profile, onSaved }: { profile: Profile; onSaved: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<ProfileBody | null>(null);
  const set = (key: keyof Draft) => (value: string) => setDraft((current) => current && { ...current, [key]: value });

  function review() {
    if (!draft) return;
    const result = changesOf(profile, draft);
    if (!result) { setError("Vous n’avez rien modifié."); return; }
    if ("error" in result) { setError(result.error); return; }
    setError(null);
    setAsking(result.body);
  }

  return (
    <>
      {draft ? (
        <form className="profile-form" onSubmit={(event) => { event.preventDefault(); review(); }} noValidate>
          <div className="field-pair name-pair">
            <Field label="Prénom" value={draft.firstName} onChange={set("firstName")} maxLength={NAME_MAX} autoComplete="given-name"/>
            <Field label="Nom" value={draft.lastName} onChange={set("lastName")} maxLength={NAME_MAX} autoComplete="family-name"/>
          </div>
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
        <ConfirmDialog title="Enregistrer les modifications ?" onClose={() => setAsking(null)}
          onDone={() => { setDraft(null); onSaved(); }} check={async () => profileCheck(profile, (await readDashboard()).profile, asking)}
          run={async () => (await sendWrite("/api/account/profile", "PATCH", asking)).outcome}/>
      ) : null}
    </>
  );
}

export { ContactSupport } from "./contact-support";

export { InviteFriend } from "./invite-friend";
