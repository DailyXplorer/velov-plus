"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CopyIcon, XIcon } from "./icons";
import { promoResultSchema, type PromoResult } from "@/lib/promo-models";
import { preparePromoStorage, promoStorageKey, readPromoCodes, savePromoCode, type SavedPromo } from "@/lib/promo-storage";
import { capitalize } from "@/lib/models";
import { Button, Modal } from "./ui";

const pendingAccounts = new Set<string>();
const storageWarning = "Ce navigateur ne peut pas garder le code. Copiez-le maintenant.";

export function InviteFriend({ cost, balance, account, onChanged }: { onChanged: () => void; cost: number | null; balance: number | null; account: string }) {
  const titleId = useId();
  const [storageKey, setStorageKey] = useState<string | null>(null);
  const [codes, setCodes] = useState<SavedPromo[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<PromoResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    let active = true;
    void promoStorageKey(account).then((key) => {
      const existing = readPromoCodes(localStorage, key);
      if (active) { setCodes(existing); setStorageKey(key); }
    }).catch(() => { if (active) setWarning("Impossible de lire les codes enregistrés sur ce navigateur."); });
    return () => { active = false; };
  }, [account]);

  async function confirm() {
    if (cost === null || inFlight.current || !storageKey || pendingAccounts.has(storageKey)) return;
    // Fail before the debit if persistence is already unavailable; never erase previous codes.
    try { preparePromoStorage(localStorage, storageKey); }
    catch { setWarning("Ce navigateur ne peut pas enregistrer le code. Vos points n’ont pas été utilisés."); return; }
    inFlight.current = true;
    pendingAccounts.add(storageKey);
    setPending(true);
    setOutcome(null);
    setWarning(null);
    try {
      const response = await fetch("/api/account/promocode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedCost: cost }), signal: AbortSignal.timeout(40_000) });
      const data: unknown = await response.json().catch(() => null);
      const parsed = promoResultSchema.safeParse(data);
      let result: PromoResult;
      if (parsed.success) result = parsed.data;
      else {
        const error = data && typeof data === "object" ? data as Record<string, unknown> : {};
        result = { ok: false, httpStatus: response.status, transactionState: null, code: typeof error.code === "string" ? error.code : "local.unreadable", message: typeof error.error === "string" ? error.error : "Réponse inattendue. Vérifiez votre solde de points avant de recommencer.", detail: null, promoCode: null };
      }
      if (result.promoCode) {
        // Persist before any further request or navigation. No subscription process is sent.
        const saved = { code: result.promoCode, createdAt: new Date().toISOString() };
        setCodes((current) => current.some((item) => item.code === saved.code) ? current : [...current, saved]);
        try { setCodes(savePromoCode(localStorage, storageKey, result.promoCode)); }
        catch { setWarning(storageWarning); }
      }
      setOutcome(result);
    } catch {
      setOutcome({ ok: false, httpStatus: 0, transactionState: null, code: "network", message: "Vélo’v ne répond pas. Vos points ont peut-être été débités : vérifiez votre solde avant de recommencer.", detail: null, promoCode: null });
    } finally {
      pendingAccounts.delete(storageKey);
      inFlight.current = false;
      setPending(false);
    }
  }

  function close() {
    if (inFlight.current) return;
    setAsking(false);
    if (outcome) onChanged();
  }

  async function copy(code: string) {
    try { await navigator.clipboard.writeText(code); setCopied(code); }
    catch { setWarning("Copie impossible. Sélectionnez le code pour le copier."); }
  }
  const canObtain = cost !== null && storageKey !== null && balance !== null && balance >= cost && Number.isSafeInteger(cost) && cost >= 0;
  const codeList = codes.length ? <div className="promo-codes"><p className="metric-label">Code à transmettre à votre ami</p>{codes.map((entry) => <div className="promo-code" key={entry.code}><code>{entry.code}</code><Button variant="secondary" onClick={() => void copy(entry.code)}><CopyIcon size={16} aria-hidden="true"/>{copied === entry.code ? "Copié" : "Copier"}</Button></div>)}<small className="soon-note">Enregistré sur ce navigateur.</small></div> : null;
  return <>
    <div className="soon-row invite-row">
      <div><span className="metric-label">Inviter un ami</span><p>Échangez vos points contre un code à offrir à un ami.</p>{cost === null ? <small className="soon-note">L’offre est momentanément indisponible.</small> : null}{cost !== null && balance !== null && balance < cost ? <small className="soon-note">Il vous manque {cost - balance} points.</small> : null}</div>
      <Button variant="secondary" disabled={!canObtain || pending} onClick={() => { setOutcome(null); setAsking(true); }}>{codes.length ? "Obtenir un autre code" : "Obtenir un code"}</Button>
    </div>
    {codeList}
    {!asking && warning ? <p className="form-error" role="alert">{warning}</p> : null}
    {asking ? <Modal titleId={titleId} onClose={close}>
      <div className="modal-heading"><h2 id={titleId}>Échanger {cost} points ?</h2><button className="icon-button" disabled={pending} aria-label="Fermer" onClick={close}><XIcon size={20}/></button></div>
      <p>Les {cost} points sont débités dès la création du code, même s’il n’est jamais utilisé.</p>
      {outcome ? <><p className={outcome.ok ? "write-done" : "form-error"} role="status">{outcome.ok ? "Code créé. Copiez-le pour l’envoyer à votre ami." : outcome.message}</p>{!outcome.ok ? <p className="bike-action-raw">HTTP {outcome.httpStatus || "aucune réponse"} · Code {outcome.code ?? "—"} · {capitalize(outcome.detail ?? outcome.message ?? "—")}</p> : null}{codeList}</> : null}
      {warning ? <p className="form-error" role="alert">{warning}</p> : null}
      <div className="modal-actions"><Button variant="ghost" disabled={pending} onClick={close}>{outcome?.ok ? "Fermer" : "Annuler"}</Button>{!outcome?.ok ? <Button pending={pending} disabled={!canObtain} onClick={() => void confirm()}>Confirmer</Button> : null}</div>
    </Modal> : null}
  </>;
}
