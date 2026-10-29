"use client";

import { useId, useRef, useState } from "react";
import { TimerIcon } from "./icons";
import { type Outcome, type Station, capitalize, outcomeSchema } from "@/lib/models";
import { fullStations } from "@/lib/via-models";
import { UNCERTAIN, isUncertain, noAnswer, routeFailure } from "@/lib/outcome";
import { describeLocationFailure, findPosition, formatDistance, haversine, type Point } from "@/lib/geo";
import { Button, Modal, SelectField } from "./ui";

export function ViaAction({ stations }: { stations: Station[] }) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [position, setPosition] = useState<Point | null>(null);
  const [locationError, setLocationError] = useState<{ message: string; raw?: string } | null>(null);
  const [locating, setLocating] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Outcome | null>(null);
  const inFlight = useRef(false);
  const choices = fullStations(stations, query, position);
  const station = choices.find((item) => String(item.number) === selected);

  function close() { if (!inFlight.current) { setOpen(false); setReviewing(false); setFailure(null); } }
  function locate() {
    if (!navigator.geolocation) { setLocationError({ message: "Localisation indisponible. Recherchez une station par son nom." }); return; }
    setLocating(true);
    findPosition(navigator.geolocation).then(({ coords }) => { setPosition({ lat: coords.latitude, lon: coords.longitude }); setLocationError(null); setLocating(false); },
      async (error: unknown) => { setLocationError(await describeLocationFailure(error, navigator)); setLocating(false); });
  }
  async function confirm() {
    if (inFlight.current || !station) return;
    inFlight.current = true;
    setPending(true);
    setFailure(null);
    let outcome: Outcome;
    try {
      const response = await fetch("/api/account/via", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stationNumber: station.number }), signal: AbortSignal.timeout(40_000) });
      const body: unknown = await response.json().catch(() => null);
      const parsed = outcomeSchema.safeParse(body);
      outcome = parsed.success ? parsed.data : routeFailure(response.status, body, "Réponse inattendue. Les 15 minutes ont peut-être été ajoutées.");
    } catch {
      outcome = noAnswer("Vélo’v ne répond pas. Les 15 minutes ont peut-être été ajoutées.");
    } finally { inFlight.current = false; setPending(false); }
    if (!outcome.ok) { setFailure(outcome); return; }
    setOpen(false); setReviewing(false); setSelected(""); setQuery("");
  }
  return <span className="ongoing-extra">
    <Button variant="secondary" onClick={() => setOpen(true)}><TimerIcon size={17} weight="light" aria-hidden="true"/>15 minutes de plus</Button>
    {open ? <Modal titleId={titleId} onClose={close}>
      <div onKeyDownCapture={(event) => { if (pending && event.key === "Escape") event.preventDefault(); }}>
        <div className="modal-heading"><h2 id={titleId}>15 minutes de plus</h2></div>
        {reviewing && station ? <>
          <p className="write-question">La station <strong>{station.name} (n° {station.number})</strong> est pleine. Demander 15 minutes de plus pour rejoindre une autre station ?</p>
          {failure ? <><p className="form-error" role="alert">{failure.message}</p><p className="bike-action-raw">HTTP {failure.httpStatus || "aucune réponse"} · Code {failure.code ?? "—"} · {capitalize(failure.detail ?? failure.message ?? "")}</p>{isUncertain(failure) ? <p className="uncertain-note">{UNCERTAIN}</p> : null}</> : null}
          <div className="modal-actions">{failure && isUncertain(failure) ? <Button variant="ghost" onClick={close}>Fermer</Button> : <><Button variant="ghost" disabled={pending} onClick={() => { setFailure(null); setReviewing(false); }}>Retour</Button><Button pending={pending} onClick={() => void confirm()}>Confirmer</Button></>}</div>
        </> : <>
          <p>Choisissez la station pleine où vous vouliez rendre votre vélo.</p>
          <label className="field"><span className="metric-label">Rechercher une station pleine</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nom, adresse ou numéro"/></label>
          <Button variant="ghost" pending={locating} onClick={locate}>Les plus proches</Button>
          {locationError ? <><p className="soon-note">{locationError.message}</p>{locationError.raw ? <p className="bike-action-raw">{locationError.raw}</p> : null}</> : null}
          {choices.length ? <SelectField label="Station pleine" hideLabel value={selected} onChange={setSelected} options={[{ value: "", label: "Choisir une station" }, ...choices.map((item) => ({ value: String(item.number), label: `${item.name} · N° ${item.number}${position ? ` · ${formatDistance(haversine(position, item))}` : ""}` }))]}/> : <p>Aucune station pleine ne correspond à votre recherche.</p>}
          <div className="modal-actions"><Button variant="ghost" onClick={close}>Annuler</Button><Button disabled={!station} onClick={() => setReviewing(true)}>Continuer</Button></div>
        </>}
      </div>
    </Modal> : null}
  </span>;
}
