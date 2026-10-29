"use client";

import { useEffect, useId, useState } from "react";
import { CopyIcon, XIcon } from "./icons";
import { promoResultSchema, type PromoResult } from "@/lib/promo-models";
import { preparePromoStorage, promoStorageKey, readPromoCodes, savePromoCode, type SavedPromo } from "@/lib/promo-storage";
import { type Outcome, capitalize } from "@/lib/models";
import { UNCERTAIN, isUncertain, noAnswer, routeFailure } from "@/lib/outcome";
import { BUSY, UNSAVED, type DebitCheck, inviteDebit, runOnce } from "@/lib/operations";
import { readDashboard } from "./get-json";
import { operations, useAccountKey, useOperation, useSending } from "./operations";
import { Button, Modal } from "./ui";

const storageWarning = "Ce navigateur ne peut pas garder le code. Copiez-le maintenant.";
type Verification = { kind: "checking" } | { kind: DebitCheck } | { kind: "failed" };

function RawLine({ outcome }: { outcome: Outcome }) {
  return <p className="bike-action-raw">HTTP {outcome.httpStatus || "aucune réponse"} · Code {outcome.code ?? "—"} · {capitalize(outcome.detail ?? outcome.message ?? "—")}</p>;
}

export function InviteFriend({ cost, balance, account, onChanged }: { onChanged: () => void; cost: number | null; balance: number | null; account: string }) {
  const titleId = useId();
  const digest = useAccountKey(account);
  const operationKey = digest ? `invite:${digest}` : null;
  const operation = useOperation(operationKey);
  const sendingHere = useSending();
  const [storageKey, setStorageKey] = useState<string | null>(null);
  const [codes, setCodes] = useState<SavedPromo[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [outcome, setOutcome] = useState<PromoResult | null>(null);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void promoStorageKey(account).then((key) => {
      const existing = readPromoCodes(localStorage, key);
      if (active) { setCodes(existing); setStorageKey(key); }
    }).catch(() => { if (active) setWarning("Impossible de lire les codes enregistrés sur ce navigateur."); });
    return () => { active = false; };
  }, [account]);

  async function confirm() {
    if (cost === null || !storageKey || !operationKey) return;
    try { preparePromoStorage(localStorage, storageKey); }
    catch { setWarning("Ce navigateur ne peut pas enregistrer le code. Vos points n’ont pas été utilisés."); return; }
    setOutcome(null);
    setWarning(null);
    setVerification(null);
    const result = await runOnce(operations, operationKey, async (): Promise<PromoResult> => {
      try {
        const response = await fetch("/api/account/promocode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedCost: cost }), signal: AbortSignal.timeout(40_000) });
        const data: unknown = await response.json().catch(() => null);
        const parsed = promoResultSchema.safeParse(data);
        const answer: PromoResult = parsed.success ? parsed.data : { ...routeFailure(response.status, data, "Réponse inattendue. Vos points ont peut-être été débités."), promoCode: null };
        if (answer.promoCode) {
          const saved = { code: answer.promoCode, createdAt: new Date().toISOString() };
          setCodes((current) => current.some((item) => item.code === saved.code) ? current : [...current, saved]);
          try { setCodes(savePromoCode(localStorage, storageKey, answer.promoCode)); }
          catch { setWarning(storageWarning); }
        }
        return answer;
      } catch {
        return { ...noAnswer("Vélo’v ne répond pas. Vos points ont peut-être été débités."), promoCode: null };
      }
    }, { keep: true, meta: { cost, balance: balance ?? -1 } });
    if (result === "unsaved") { setWarning(UNSAVED); return; }
    if (result === "busy") { if (!operations.get(operationKey)) setWarning(BUSY); return; }
    setOutcome({ promoCode: null, ...result });
  }

  async function verify() {
    if (!operation || operation.status !== "uncertain" || !operationKey) return;
    const before = { at: operation.at, cost: Number(operation.meta.cost), balance: Number(operation.meta.balance) >= 0 ? Number(operation.meta.balance) : null };
    setVerification({ kind: "checking" });
    try {
      const data = await readDashboard();
      const check = inviteDebit(before, { balance: data.rewards.balance, movements: data.rewards.movements }, Date.now());
      if (check === "debited") operations.clear(operationKey);
      setVerification({ kind: check });
    } catch {
      setVerification({ kind: "failed" });
    }
  }

  function retry() {
    if (!operationKey || verification?.kind !== "not-debited") return;
    operations.clear(operationKey);
    void confirm();
  }

  function close() {
    if (operations.sending()) return;
    setAsking(false);
    if (outcome || verification) onChanged();
    setVerification(null);
  }

  function open() {
    if (!operation) setOutcome(null);
    setVerification(null);
    setAsking(true);
  }

  async function copy(code: string) {
    try { await navigator.clipboard.writeText(code); setCopied(code); }
    catch { setWarning("Copie impossible. Sélectionnez le code pour le copier."); }
  }
  const pending = operation?.status === "sending";
  const blocked = pending && sendingHere;
  const uncertain = operation?.status === "uncertain" ? operation.outcome : null;
  const shown = uncertain ?? outcome;
  const settled = shown !== null && (shown.ok || isUncertain(shown)) || verification?.kind === "debited";
  const canObtain = cost !== null && storageKey !== null && operationKey !== null && balance !== null && balance >= cost && Number.isSafeInteger(cost) && cost >= 0;
  const codeList = codes.length ? <div className="promo-codes"><p className="metric-label">Code à transmettre à votre ami</p>{codes.map((entry) => <div className="promo-code" key={entry.code}><code>{entry.code}</code><Button variant="secondary" onClick={() => void copy(entry.code)}><CopyIcon size={16} aria-hidden="true"/>{copied === entry.code ? "Copié" : "Copier"}</Button></div>)}<small className="soon-note">Enregistré sur ce navigateur.</small></div> : null;
  return <>
    <div className="soon-row invite-row">
      <div><span className="metric-label">Inviter un ami</span><p>Échangez vos points contre un code à offrir à un ami.</p>{cost === null ? <small className="soon-note">L’offre est momentanément indisponible.</small> : null}{cost !== null && balance !== null && balance < cost ? <small className="soon-note">Il vous manque {cost - balance} points.</small> : null}</div>
      <Button variant="secondary" disabled={!operation && !canObtain} onClick={open}>{codes.length ? "Obtenir un autre code" : "Obtenir un code"}</Button>
    </div>
    {codeList}
    {!asking && warning ? <p className="form-error" role="alert">{warning}</p> : null}
    {asking ? <Modal titleId={titleId} onClose={close}>
      <div className="modal-heading"><h2 id={titleId}>Échanger {cost} points ?</h2><button className="icon-button" disabled={blocked} aria-label="Fermer" onClick={close}><XIcon size={20}/></button></div>
      <p>Les {cost} points sont débités dès la création du code, même s’il n’est jamais utilisé.</p>
      {verification?.kind === "debited" ? <p className="form-error" role="status">Vos points ont été débités, mais aucun code n’a été reçu. Contactez Vélo’v pour le récupérer.</p>
        : shown ? <><p className={shown.ok ? "write-done" : "form-error"} role="status">{shown.ok ? "Code créé. Copiez-le pour l’envoyer à votre ami." : shown.message}</p>{!shown.ok ? <RawLine outcome={shown}/> : null}{isUncertain(shown) ? <p className="uncertain-note">{UNCERTAIN}</p> : null}{codeList}</> : null}
      {verification?.kind === "not-debited" ? <p className="soon-note" role="status">Aucun débit de {cost} points n’apparaît sur votre compte.</p> : null}
      {verification?.kind === "unknown" ? <p className="soon-note" role="status">Votre solde ne permet pas encore de savoir si vos points ont été débités. Vérifiez de nouveau dans un instant.</p> : null}
      {verification?.kind === "failed" ? <p className="form-error" role="alert">Votre solde n’a pas pu être lu. Réessayez dans un instant.</p> : null}
      {warning ? <p className="form-error" role="alert">{warning}</p> : null}
      <div className="modal-actions">
        <Button variant="ghost" disabled={blocked} onClick={close}>{settled ? "Fermer" : "Annuler"}</Button>
        {uncertain && verification?.kind === "not-debited" ? <Button onClick={retry}>Je n’ai pas été débité, réessayer</Button>
          : uncertain ? <Button variant="secondary" pending={verification?.kind === "checking"} onClick={() => void verify()}>Vérifier mon solde</Button>
          : !settled ? <Button pending={pending} disabled={!canObtain} onClick={() => void confirm()}>Confirmer</Button> : null}
      </div>
    </Modal> : null}
  </>;
}
