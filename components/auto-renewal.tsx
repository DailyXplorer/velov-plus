"use client";

import { useId, useRef, useState } from "react";
import { z } from "zod";
import { autoRenewalResultSchema, type AutoRenewalResult } from "@/lib/renewal-models";
import { capitalize } from "@/lib/models";
import { Button, Modal } from "./ui";

const errorSchema = z.object({ error: z.string(), code: z.string().optional() });
const failed = (status: number, code: string, message: string): AutoRenewalResult => ({ ok: false, httpStatus: status, code, message, detail: message, transactionState: null, autoRenewal: null, autoRenewalAllowed: false, verified: false });

export function AutoRenewal({ subscriptionId, value, allowed, onSaved }: { subscriptionId: string | null; value: boolean | null; allowed: boolean; onSaved: () => void }) {
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<AutoRenewalResult | null>(null);
  const [saved, setSaved] = useState<AutoRenewalResult | null>(null);
  const inFlight = useRef(false);
  const titleId = useId();
  const actual = saved ? saved.autoRenewal : value;
  const canChange = saved ? saved.autoRenewalAllowed : allowed;
  const next = !actual;

  async function confirm() {
    if (inFlight.current || !subscriptionId) return;
    inFlight.current = true;
    setPending(true);
    let outcome: AutoRenewalResult;
    try {
      const response = await fetch("/api/account/auto-renewal", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscriptionId, autoRenewal: next }), signal: AbortSignal.timeout(40_000) });
      const data: unknown = await response.json().catch(() => null);
      const parsed = autoRenewalResultSchema.safeParse(data);
      const error = errorSchema.safeParse(data);
      outcome = response.ok && parsed.success ? parsed.data : failed(response.status, error.success ? error.data.code ?? "unavailable" : "local.unreadable", error.success ? error.data.error : "Réponse inattendue. Actualisez la page avant de réessayer.");
    } catch {
      outcome = failed(0, "network", "Vélo’v ne répond pas. Actualisez la page pour voir si le réglage a changé.");
    }
    inFlight.current = false;
    setPending(false);
    if (!outcome.ok) { setFailure(outcome); return; }
    if (outcome.verified && outcome.autoRenewal !== null) setSaved(outcome);
    setAsking(false);
    onSaved();
  }

  function close() {
    if (!inFlight.current) setAsking(false);
  }

  return <div className="setting-row renewal-setting">
    <div><span className="metric-label">Renouvellement automatique</span><strong className="setting-value">{actual === null ? "Indisponible pour le moment" : actual ? "Activé" : "Désactivé"}</strong></div>
    {canChange && subscriptionId && actual !== null ? <button type="button" role="switch" className="switch" aria-checked={actual} aria-label="Renouvellement automatique" onClick={() => { setFailure(null); setAsking(true); }}/> : null}
    {asking ? <Modal titleId={titleId} onClose={close}>
      <h2 id={titleId}>{next ? "Activer le renouvellement automatique ?" : "Désactiver le renouvellement automatique ?"}</h2>
      {next ? <p>Votre abonnement sera renouvelé et facturé à son échéance.</p> : null}
      {failure ? <>
        <p className="form-error" role="alert">{failure.message}</p>
        <p className="bike-action-raw">HTTP {failure.httpStatus || "aucune réponse"} · Code {failure.code ?? "—"} · {capitalize(failure.detail ?? failure.message ?? "")}</p>
      </> : null}
      <div className="modal-actions"><Button variant="secondary" disabled={pending} onClick={close}>Annuler</Button><Button pending={pending} onClick={() => void confirm()}>Confirmer</Button></div>
    </Modal> : null}
  </div>;
}
