"use client";

import { useId, useRef, useState } from "react";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/csr/EnvelopeSimple";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { type Outcome, type Trip, formatDate, outcomeSchema } from "@/lib/models";
import { contactBodySchema, contactMessage, type ContactBody } from "@/lib/contact-models";
import { MAIL_COMPLAINT_TYPES } from "@/lib/guesses";
import { Button, Modal, SelectField } from "./ui";

const labels = ["Un trajet", "Mon abonnement", "Mes paiements", "Un parking"];
const subjects = MAIL_COMPLAINT_TYPES.map((value, index) => ({ value, label: labels[index] }));
const failed = (httpStatus: number, code: string | null, message: string): Outcome => ({ ok: false, httpStatus, code, message, detail: message, transactionState: null });

export function ContactSupport({ trips }: { trips: Trip[] | null }) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState<string>(subjects[0].value);
  const [message, setMessage] = useState("");
  const [tripId, setTripId] = useState("none");
  const [draft, setDraft] = useState<ContactBody | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  const recent = (trips ?? []).filter((trip) => trip.token).slice(0, 15);
  const trip = recent.find((item) => item.id === tripId);
  const body = { complaintType: subject, message, ...(trip?.token ? { tripToken: trip.token } : {}) };

  function review() {
    const parsed = contactBodySchema.safeParse(body);
    if (!parsed.success || new TextEncoder().encode(JSON.stringify(body)).length > 4096) {
      setError("Saisissez un message et une catégorie valides (4 Ko au maximum).");
      return;
    }
    setError(null); setOutcome(null); setDraft(parsed.data);
  }

  async function send() {
    if (inFlight.current || !draft || outcome) return;
    inFlight.current = true; setSending(true);
    try {
      const response = await fetch("/api/account/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft), signal: AbortSignal.timeout(40_000) });
      const data: unknown = await response.json().catch(() => null);
      const parsed = outcomeSchema.safeParse(data);
      if (parsed.success) setOutcome(parsed.data);
      else {
        const value = data && typeof data === "object" ? data as Record<string, unknown> : {};
        setOutcome(failed(response.status, typeof value.code === "string" ? value.code : "local.unreadable", typeof value.error === "string" ? value.error : "Réponse illisible. Le message a peut-être été envoyé : vérifiez avant tout nouvel envoi."));
      }
    } catch {
      setOutcome(failed(0, "network", "Pas de réponse. Le message a peut-être été envoyé : vérifiez avant tout nouvel envoi."));
    } finally { setSending(false); inFlight.current = false; }
  }

  function closeConfirmation() {
    if (inFlight.current) return;
    if (outcome?.ok) { setMessage(""); setTripId("none"); }
    setDraft(null); setOutcome(null);
  }

  return <>
    {!open ? <Button variant="secondary" onClick={() => setOpen(true)}><EnvelopeSimpleIcon size={18} weight="light" aria-hidden="true"/>Écrire au service client</Button> : <div className="contact-form">
      <SelectField label="Objet" value={subject} onChange={setSubject} options={subjects}/>
      {recent.length ? <SelectField label="Trajet (facultatif)" value={tripId} onChange={setTripId} options={[{ value: "none", label: "Aucun" }, ...recent.map((item) => ({ value: item.id, label: `${formatDate(item.startedAt)} · ${item.startStation ?? "Trajet"}` }))]}/> : null}
      <label className="field"><span className="metric-label">Message</span><textarea rows={5} maxLength={1500} value={message} onChange={(event) => setMessage(event.target.value)}/></label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="profile-form-actions"><Button variant="ghost" onClick={() => setOpen(false)}>Annuler</Button><Button onClick={review}>Vérifier et envoyer</Button></div>
    </div>}
    {draft ? <Modal titleId={titleId} onClose={closeConfirmation}>
      <div className="modal-heading"><h2 id={titleId}>Envoyer au service client ?</h2><button className="icon-button" aria-label="Fermer" disabled={sending} onClick={closeConfirmation}><XIcon size={20}/></button></div>
      <p>{subjects.find((item) => item.value === draft.complaintType)?.label}</p>
      <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{contactMessage(draft)}</p>
      {outcome ? <><p role={outcome.ok ? "status" : "alert"} className={outcome.ok ? "write-done" : "form-error"}>{outcome.ok ? "Message envoyé au service client." : outcome.message}</p>{!outcome.ok ? <p className="bike-action-raw">HTTP {outcome.httpStatus || "aucune réponse"} · code {outcome.code ?? "—"} · {outcome.detail ?? outcome.message ?? "—"}</p> : null}</> : null}
      <div className="modal-actions"><Button variant="ghost" disabled={sending} onClick={closeConfirmation}>{outcome ? "Fermer" : "Annuler"}</Button>{!outcome ? <Button pending={sending} onClick={() => void send()}>Confirmer l’envoi</Button> : null}</div>
    </Modal> : null}
  </>;
}
