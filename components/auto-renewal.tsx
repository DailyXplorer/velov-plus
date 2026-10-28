"use client";

import { useId, useRef, useState } from "react";
import { z } from "zod";
import { autoRenewalResultSchema, type AutoRenewalResult } from "@/lib/renewal-models";
import { Button, Modal } from "./ui";

const errorSchema = z.object({ error: z.string(), code: z.string().optional() });
const failed = (status: number, code: string, message: string): AutoRenewalResult => ({ ok: false, httpStatus: status, code, message, detail: message, transactionState: null, autoRenewal: null, autoRenewalAllowed: false, verified: false });

export function AutoRenewal({ subscriptionId, value, allowed, onSaved }: { subscriptionId: string | null; value: boolean | null; allowed: boolean; onSaved: () => void }) {
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<AutoRenewalResult | null>(null);
  const once = useRef(false);
  const titleId = useId();
  const actual = result?.ok ? result.autoRenewal : value;
  const canChange = result?.ok ? result.autoRenewalAllowed : allowed;
  const next = !actual;

  async function confirm() {
    if (once.current || !subscriptionId) return;
    once.current = true;
    setPending(true);
    let outcome: AutoRenewalResult;
    try {
      const response = await fetch("/api/account/auto-renewal", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscriptionId, autoRenewal: next }), signal: AbortSignal.timeout(40_000) });
      const data: unknown = await response.json().catch(() => null);
      const parsed = autoRenewalResultSchema.safeParse(data);
      const error = errorSchema.safeParse(data);
      outcome = response.ok && parsed.success ? parsed.data : failed(response.status, error.success ? error.data.code ?? "unavailable" : "local.unreadable", error.success ? error.data.error : "Réponse illisible : actualisez avant de réessayer.");
    } catch {
      outcome = failed(0, "network", "Pas de réponse : le réglage a peut-être changé. Actualisez avant de réessayer.");
    }
    setResult(outcome);
    setPending(false);
  }

  function close() {
    if (pending) return;
    setAsking(false);
    // Reload after displaying the answer, never unmount its confirmation while a write is pending.
    if (once.current) onSaved();
  }

  return <div className="setting-row">
    <div><span className="metric-label">Renouvellement automatique</span><small className="bike-action-raw">Expérimental</small><strong className="setting-value">{actual === null ? "État à actualiser" : actual ? "Activé" : "Désactivé"}</strong></div>
    {canChange && subscriptionId && actual !== null ? <button type="button" role="switch" className="switch" disabled={result !== null} aria-checked={actual} aria-label="Renouvellement automatique" onClick={() => { once.current = false; setResult(null); setAsking(true); }}/> : null}
    {asking ? <Modal titleId={titleId} onClose={close}>
      <h2 id={titleId}>Renouvellement automatique</h2>
      <small className="bike-action-raw">Expérimental</small>
      {!result ? <p>{next ? "Activer le renouvellement automatique de votre abonnement ? Il pourra être renouvelé et facturé à son échéance." : "Désactiver le renouvellement automatique de votre abonnement ?"}</p> : result.ok ? <p role="status">{!result.verified || result.autoRenewal === null ? "Demande acceptée, mais l’état n’a pas pu être relu. Actualisez sans renvoyer la demande." : `État confirmé par Vélo’v : renouvellement ${result.autoRenewal ? "activé" : "désactivé"}.`}</p> : <>
        <p className="form-error" role="alert">{result.message}</p>
        <p className="bike-action-raw">HTTP {result.httpStatus || "aucune réponse"} · code {result.code ?? "—"} · {result.detail ?? result.message}</p>
      </>}
      <div className="modal-actions"><Button variant="secondary" disabled={pending} onClick={close}>{result ? "Fermer" : "Annuler"}</Button>{!result ? <Button pending={pending} onClick={() => void confirm()}>Confirmer</Button> : null}</div>
    </Modal> : null}
  </div>;
}
