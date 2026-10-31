"use client";

import { useEffect, useId, useRef, useState } from "react";
import { EnvelopeSimpleIcon, SendIcon, XIcon } from "./icons";
import { type Outcome, type Trip, formatDate, outcomeSchema } from "@/lib/models";
import { UNCERTAIN, isUncertain, networkFailure, routeFailure } from "@/lib/outcome";
import { ACCOUNT_HEADER, blockedMessage, runOnce } from "@/lib/operations";
import { sessionGate } from "@/lib/session-gate";
import { contactBodySchema, contactFits, type ContactBody } from "@/lib/contact-models";
import { MAIL_COMPLAINT_TYPES } from "@/lib/guesses";
import { operations, useAccountKey, useOperation, useSending } from "./operations";
import { Button, Modal, SelectField } from "./ui";

const labels = ["Un trajet", "Mon abonnement", "Mes paiements", "Un parking"];
const subjects = MAIL_COMPLAINT_TYPES.map((value, index) => ({ value, label: labels[index] }));
const tripRequests = new EventTarget();
let requestedTrip: string | null = null;

export function writeAboutTrip(tripId: string) {
  requestedTrip = tripId;
  tripRequests.dispatchEvent(new Event("trip"));
  window.location.hash = "account";
}

export function ContactSupport({ trips, account }: { trips: Trip[] | null; account: string }) {
  const titleId = useId();
  const digest = useAccountKey(account);
  const operationKey = digest ? `contact:${digest}` : null;
  const operation = useOperation(operationKey);
  const sendingHere = useSending();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState<string>(subjects[0].value);
  const [message, setMessage] = useState("");
  const [tripId, setTripId] = useState("none");
  const [draft, setDraft] = useState<ContactBody | null>(null);
  const [status, setStatus] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refusal, setFailure] = useState<Outcome | null>(null);
  const form = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const take = () => {
      if (!requestedTrip) return;
      setTripId(requestedTrip);
      setOpen(true);
      requestedTrip = null;
      requestAnimationFrame(() => form.current?.scrollIntoView({ block: "center" }));
    };
    take();
    tripRequests.addEventListener("trip", take);
    return () => tripRequests.removeEventListener("trip", take);
  }, []);
  const recent = (trips ?? []).filter((trip) => trip.token).slice(0, 15);
  const trip = recent.find((item) => item.id === tripId);
  const body = { complaintType: subject, message, ...(trip?.token ? { tripToken: trip.token } : {}) };
  const failure = operation?.outcome ?? refusal;
  const sending = operation?.status === "sending";

  function review() {
    const parsed = contactBodySchema.safeParse(body);
    if (!parsed.success || !contactFits(parsed.data)) {
      setError("Votre message est vide ou trop long.");
      return;
    }
    setError(null); setFailure(null); setDraft(parsed.data);
  }

  async function send() {
    if (!draft || !operationKey || !digest) return;
    setFailure(null); setError(null);
    const stamp = sessionGate.stamp();
    const outcome = await runOnce(operations, operationKey, async () => {
      const startedAt = Date.now();
      try {
        const response = await fetch("/api/account/contact", { method: "POST", headers: { "Content-Type": "application/json", [ACCOUNT_HEADER]: digest }, body: JSON.stringify(draft), signal: AbortSignal.timeout(40_000) });
        const data: unknown = await response.json().catch(() => null);
        const parsed = outcomeSchema.safeParse(data);
        return parsed.success ? parsed.data : routeFailure(response.status, data, "Réponse inattendue. Votre message a peut-\u2060être déjà été envoyé.");
      } catch (error) {
        return networkFailure("Pas de réponse. Votre message a peut-\u2060être déjà été envoyé.", error, startedAt);
      }
    }, { keep: true });
    if (!stamp.live()) return;
    if (typeof outcome === "string") { const message = blockedMessage(outcome, operations.get(operationKey) !== null); if (message) setError(message); return; }
    if (!outcome.ok) { if (!isUncertain(outcome)) setFailure(outcome); return; }
    setMessage(""); setTripId("none"); setDraft(null); setOpen(false);
  }

  function closeConfirmation() {
    if (operations.sending()) return;
    setDraft(null); setStatus(false);
  }

  async function writeAgain() {
    if (!operationKey || !operation) return;
    await operations.clear(operationKey, operation.id);
    setMessage(""); setTripId("none"); setDraft(null); setStatus(false); setFailure(null); setOpen(true);
  }

  return <>
    {!open ? <Button variant="secondary" onClick={() => operation ? setStatus(true) : setOpen(true)}><EnvelopeSimpleIcon size={18} weight="light" aria-hidden="true"/>Écrire au service client</Button> : <div className="contact-form" ref={form}>
      <SelectField label="Objet" value={subject} onChange={setSubject} options={subjects}/>
      {recent.length ? <SelectField label="Trajet (facultatif)" value={tripId} onChange={setTripId} options={[{ value: "none", label: "Aucun" }, ...recent.map((item) => ({ value: item.id, label: `${formatDate(item.startedAt)} · ${item.startStation ?? "Trajet"}` }))]}/> : null}
      <label className="field"><span className="metric-label">Message</span><textarea rows={5} maxLength={1500} value={message} onChange={(event) => setMessage(event.target.value)}/></label>
      {error && !draft ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="profile-form-actions"><Button variant="ghost" onClick={() => setOpen(false)}>Annuler</Button><Button onClick={review}><SendIcon size={17} weight="light" aria-hidden="true"/>Envoyer</Button></div>
    </div>}
    {draft || status ? <Modal titleId={titleId} onClose={closeConfirmation}>
      <div className="modal-heading"><h2 id={titleId}>Envoyer au service client ?</h2><button className="icon-button" aria-label="Fermer" disabled={sending && sendingHere} onClick={closeConfirmation}><XIcon size={20}/></button></div>
      {failure ? <><p role="alert" className="form-error">{failure.message}</p>{isUncertain(failure) ? <p className="uncertain-note">{UNCERTAIN}</p> : null}</> : null}
      {error && draft ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="modal-actions">{failure && isUncertain(failure) ? <><Button variant="ghost" onClick={closeConfirmation}>Fermer</Button><Button variant="secondary" onClick={writeAgain}>Écrire un nouveau message</Button></> : <><Button variant="ghost" disabled={sending && sendingHere} onClick={closeConfirmation}>Annuler</Button><Button pending={sending} disabled={!draft || !operationKey} onClick={() => void send()}>Confirmer</Button></>}</div>
    </Modal> : null}
  </>;
}
