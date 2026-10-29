"use client";

import { useId, useRef, useState } from "react";
import { TimerIcon } from "./icons";
import { type Outcome, type Station, capitalize, outcomeSchema } from "@/lib/models";
import { fullStations } from "@/lib/via-models";
import { formatDistance, haversine, type Point } from "@/lib/geo";
import { Button, Modal, SelectField } from "./ui";

/** Mounted only during an ongoing trip. Every confirmation is one request, and a result cannot be submitted again. */
export function ViaAction({ stations }: { stations: Station[] }) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [position, setPosition] = useState<Point | null>(null);
  const [locationError, setLocationError] = useState("");
  const [locating, setLocating] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Outcome | null>(null);
  const inFlight = useRef(false);
  const choices = fullStations(stations, query, position);
  const station = choices.find((item) => String(item.number) === selected);

  function close() { if (!inFlight.current) setOpen(false); }
  function locate() {
    if (!navigator.geolocation) { setLocationError("La localisation n’est pas disponible. Recherchez une station."); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(({ coords }) => { setPosition({ lat: coords.latitude, lon: coords.longitude }); setLocationError(""); setLocating(false); }, () => { setLocationError("Position indisponible. Recherchez une station par son nom."); setLocating(false); }, { timeout: 15_000, maximumAge: 30_000 });
  }
  async function confirm() {
    if (inFlight.current || result || !station) return;
    inFlight.current = true;
    setPending(true);
    try {
      const response = await fetch("/api/account/via", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stationNumber: station.number }), signal: AbortSignal.timeout(40_000) });
      const body: unknown = await response.json().catch(() => null);
      const parsed = outcomeSchema.safeParse(body);
      if (parsed.success) setResult(parsed.data);
      else {
        const error = body && typeof body === "object" ? body as Record<string, unknown> : {};
        setResult({ ok: false, httpStatus: response.status, transactionState: null, code: typeof error.code === "string" ? error.code : null, message: typeof error.error === "string" ? error.error : "Réponse illisible. Vérifiez le trajet dans l’app Vélo’v avant de réessayer.", detail: null });
      }
    } catch {
      setResult({ ok: false, httpStatus: 0, transactionState: null, code: "network", message: "Pas de réponse : les minutes ont peut-être été accordées. Vérifiez le trajet dans l’app Vélo’v avant de réessayer.", detail: null });
    } finally { inFlight.current = false; setPending(false); }
  }
  return <span className="ongoing-extra">
    <Button variant="secondary" onClick={() => setOpen(true)}><TimerIcon size={17} weight="light" aria-hidden="true"/>15 minutes de plus</Button>
    {open ? <Modal titleId={titleId} onClose={close}>
      <div onKeyDownCapture={(event) => { if (pending && event.key === "Escape") event.preventDefault(); }}>
        <div className="modal-heading"><h2 id={titleId}>15 minutes de plus</h2></div>
        {result ? <>
          <p className={result.ok ? "write-done" : "form-error"} role={result.ok ? "status" : "alert"}>{result.ok ? "Vélo’v a accepté la demande de minutes supplémentaires." : result.message}</p>
          {!result.ok ? <p className="bike-action-raw">HTTP {result.httpStatus || "aucune réponse"} · Code {result.code ?? "—"} · {capitalize(result.detail ?? result.message ?? "")}</p> : null}
          <div className="modal-actions"><Button variant="secondary" onClick={close}>Fermer</Button></div>
        </> : reviewing && station ? <>
          <p className="write-question">Demander 15 minutes supplémentaires pour rendre votre vélo à une autre station ? La station <strong>{station.name} (n° {station.number})</strong> est pleine.</p>
          <div className="modal-actions"><Button variant="ghost" disabled={pending} onClick={() => setReviewing(false)}>Retour</Button><Button pending={pending} onClick={() => void confirm()}>Confirmer</Button></div>
        </> : <>
          <p>Choisissez la station pleine où vous souhaitez rendre votre vélo. Sa disponibilité sera revérifiée avant l’envoi.</p>
          <label className="field"><span className="metric-label">Rechercher une station pleine</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nom, adresse ou numéro"/></label>
          <Button variant="ghost" pending={locating} onClick={locate}>Les plus proches</Button>
          {locationError ? <p className="soon-note">{locationError}</p> : null}
          {choices.length ? <SelectField label="Station pleine" value={selected} onChange={setSelected} options={[{ value: "", label: "Choisir une station" }, ...choices.map((item) => ({ value: String(item.number), label: `${item.name} · N° ${item.number}${position ? ` · ${formatDistance(haversine(position, item))}` : ""}` }))]}/> : <p>Aucune station pleine ne correspond à votre recherche.</p>}
          <div className="modal-actions"><Button variant="ghost" onClick={close}>Annuler</Button><Button disabled={!station} onClick={() => setReviewing(true)}>Continuer</Button></div>
        </>}
      </div>
    </Modal> : null}
  </span>;
}
