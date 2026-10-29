"use client";

import { useId, useState } from "react";
import { z } from "zod";
import { autoRenewalResultSchema, type AutoRenewalResult } from "@/lib/renewal-models";
import { type Outcome, capitalize } from "@/lib/models";
import { UNCERTAIN, isUncertain } from "@/lib/outcome";
import { BUSY, UNSAVED, runOnce, settleHeld } from "@/lib/operations";
import { renewalCheck } from "@/lib/checks";
import { readDashboard } from "./get-json";
import { operations, useAccountKey, useOperation, useSending } from "./operations";
import { Button, Modal } from "./ui";

const errorSchema = z.object({ error: z.string(), code: z.string().optional() });
const failed = (status: number, code: string, message: string): AutoRenewalResult => ({ ok: false, httpStatus: status, code, message, detail: message, transactionState: null, autoRenewal: null, autoRenewalAllowed: false, verified: false });

export function AutoRenewal({ subscriptionId, account, value, allowed, onSaved }: { subscriptionId: string | null; account: string; value: boolean | null; allowed: boolean; onSaved: () => void }) {
  const digest = useAccountKey(account);
  const operationKey = digest && subscriptionId ? `renewal:${digest}:${subscriptionId}` : null;
  const operation = useOperation(operationKey);
  const sendingHere = useSending();
  const [asking, setAsking] = useState(false);
  const [refusal, setFailure] = useState<Outcome | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [saved, setSaved] = useState<AutoRenewalResult | null>(null);
  const titleId = useId();
  const actual = saved ? saved.autoRenewal : value;
  const canChange = saved ? saved.autoRenewalAllowed : allowed;
  const next = operation ? operation.meta.wanted === 1 : !actual;
  const pending = operation?.status === "sending";
  const uncertain = operation?.status === "uncertain";
  const failure = operation?.outcome ?? refusal;

  async function confirm() {
    if (!operationKey || !subscriptionId) return;
    setFailure(null);
    setNotice(null);
    const outcome = await runOnce(operations, operationKey, async (): Promise<AutoRenewalResult> => {
      try {
        const response = await fetch("/api/account/auto-renewal", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscriptionId, autoRenewal: next }), signal: AbortSignal.timeout(40_000) });
        const data: unknown = await response.json().catch(() => null);
        const parsed = autoRenewalResultSchema.safeParse(data);
        const error = errorSchema.safeParse(data);
        return response.ok && parsed.success ? parsed.data : failed(response.status, error.success ? error.data.code ?? "unavailable" : "local.unreadable", error.success ? error.data.error : "Réponse inattendue. Actualisez la page avant de réessayer.");
      } catch {
        return failed(0, "network", "Vélo’v ne répond pas. Actualisez la page pour voir si le réglage a changé.");
      }
    }, { keep: true, meta: { wanted: next ? 1 : 0 } });
    if (outcome === "busy" || outcome === "unsaved") { if (outcome === "unsaved" || !operations.get(operationKey)) setNotice(outcome === "unsaved" ? UNSAVED : BUSY); return; }
    if (!outcome.ok) { if (isUncertain(outcome)) await resolve(); else setFailure(outcome); return; }
    if ("verified" in outcome && outcome.verified && outcome.autoRenewal !== null) setSaved(outcome);
    setAsking(false);
    onSaved();
  }

  async function resolve() {
    if (!operationKey || !subscriptionId || checking) return;
    setChecking(true);
    const settled = await settleHeld(operations, operationKey, async () => renewalCheck(await readDashboard(), subscriptionId, next));
    setChecking(false);
    if (settled?.kind === "refused") setFailure(settled.outcome);
    else if (settled?.kind === "done") { setAsking(false); onSaved(); }
  }

  function close() {
    if (!(pending && sendingHere) && !checking) setAsking(false);
  }

  return <div className="setting-row renewal-setting">
    <div><span className="metric-label">Renouvellement automatique</span><strong className="setting-value">{actual === null ? "Indisponible pour le moment" : actual ? "Activé" : "Désactivé"}</strong></div>
    {canChange && subscriptionId && actual !== null ? <button type="button" role="switch" className="switch" aria-checked={actual} aria-label="Renouvellement automatique" onClick={() => { setFailure(null); setNotice(null); setAsking(true); }}/> : null}
    {asking ? <Modal titleId={titleId} onClose={close}>
      <h2 id={titleId}>{next ? "Activer le renouvellement automatique ?" : "Désactiver le renouvellement automatique ?"}</h2>
      {next ? <p>Votre abonnement sera renouvelé et facturé à son échéance.</p> : null}
      {failure ? <>
        <p className="form-error" role="alert">{failure.message}</p>
        <p className="bike-action-raw">HTTP {failure.httpStatus || "aucune réponse"} · Code {failure.code ?? "—"} · {capitalize(failure.detail ?? failure.message ?? "")}</p>
        {uncertain ? <p className="uncertain-note">{UNCERTAIN}</p> : null}
      </> : null}
      {notice ? <p className="form-error" role="alert">{notice}</p> : null}
      <div className="modal-actions">{uncertain && failure ? <><Button variant="secondary" disabled={checking} onClick={close}>Fermer</Button><Button variant="secondary" pending={checking} onClick={() => void resolve()}>Vérifier</Button></>
        : <><Button variant="secondary" disabled={pending} onClick={close}>Annuler</Button><Button pending={pending} disabled={!operationKey} onClick={() => void confirm()}>Confirmer</Button></>}</div>
    </Modal> : null}
  </div>;
}
