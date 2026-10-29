"use client";

import { useRef, useState } from "react";
import { BicycleIcon, CaretDownIcon, CaretRightIcon, CheckIcon, CopyIcon, LightningIcon, StarIcon, XIcon } from "./icons";
import { type Outcome, type Trip, canRate, formatDate, formatPrice } from "@/lib/models";
import { type Stars, dismissTrip, sendStars, starLabels } from "@/lib/trip-end";
import { UNCERTAIN, isUncertain, settle } from "@/lib/outcome";
import { ratingCheck } from "@/lib/checks";
import { readDashboard } from "./get-json";
import { formatDistance } from "@/lib/geo";
import { Button, Eyebrow, Modal, TextButton } from "./ui";
import { BikeDrawer } from "./station-bikes";

const statuses: Record<string, string> = { REQUESTED: "Demandé", STARTED: "En cours", PAUSED: "En pause", FINISHED: "Terminé", AUTO_FINISHED: "Terminé automatiquement", REJECTED: "Refusé", TIMEOUT: "Expiré", ERROR: "En erreur", WARNING: "Avertissement", REVERSED: "Annulé" };
const ratedHere = new Set<string>();

function tripTimes(trip: Trip) {
  if (!trip.startedAt) return "Date indisponible";
  const time = (value: string) => formatDate(value, { hour: "2-digit", minute: "2-digit" });
  return <>{formatDate(trip.startedAt, { day: "numeric", month: "long", year: "numeric" })} · <span className="clock">{time(trip.startedAt)}{trip.endedAt ? ` → ${time(trip.endedAt)}` : ""}</span></>;
}

function pointsLine({ pointsEarned: earned, pointsSpent: spent }: Trip) {
  const points = (count: number) => `${count} point${count > 1 ? "s" : ""}`;
  if (earned > 0 && spent > 0) return `+${points(earned)} gagné${earned > 1 ? "s" : ""} · ${spent} dépensé${spent > 1 ? "s" : ""}`;
  if (earned > 0) return `+${points(earned)} gagné${earned > 1 ? "s" : ""}`;
  if (spent > 0) return `${points(spent)} dépensé${spent > 1 ? "s" : ""}`;
  return null;
}

function Stop({ label, station, stand }: { label: string; station: string | null; stand: number | null }) {
  return <div><small>{label}</small><span>{station ?? "Non renseignée"}{stand != null ? <span className="trip-stand">Borne {stand}</span> : null}</span></div>;
}

type RatingStep = { kind: "choose"; failure?: Outcome } | { kind: "sending" } | { kind: "uncertain"; failure: Outcome; checking: boolean } | { kind: "done" };
const starNumbers: Stars[] = [1, 2, 3, 4, 5];

function RateBike({ trip, bikeNumber, onLater }: { trip: Trip; bikeNumber: number; onLater: () => void }) {
  const [stars, setStars] = useState<Stars | null>(null);
  const [step, setStep] = useState<RatingStep>({ kind: "choose" });
  const inFlight = useRef(false);

  async function submit(chosen: Stars) {
    if (inFlight.current) return;
    inFlight.current = true;
    setStep({ kind: "sending" });
    const outcome = await sendStars(trip.id, bikeNumber, chosen);
    inFlight.current = false;
    if (outcome.ok) return rated();
    if (!isUncertain(outcome)) return setStep({ kind: "choose", failure: outcome });
    await verify(outcome);
  }

  function rated() {
    ratedHere.add(trip.id);
    setStep({ kind: "done" });
  }

  async function verify(failure: Outcome) {
    if (inFlight.current) return;
    inFlight.current = true;
    setStep({ kind: "uncertain", failure, checking: true });
    const settled = await settle(failure, async () => ratingCheck(await readDashboard(), trip.id));
    inFlight.current = false;
    if (settled.kind === "done") rated();
    else setStep(settled.kind === "refused" ? { kind: "choose", failure: settled.outcome } : { kind: "uncertain", failure, checking: false });
  }

  if (step.kind === "done") return <p className="trip-rate-done" role="status"><CheckIcon size={16} weight="bold" aria-hidden="true"/>Merci ! +5 points</p>;
  const sending = step.kind === "sending" || step.kind === "uncertain";
  return (
    <section className="trip-rate" aria-labelledby="trip-rate-title">
      <h3 id="trip-rate-title" className="trip-rate-title">Noter ce vélo</h3>
      <div className="trip-rate-stars" role="radiogroup" aria-labelledby="trip-rate-title">
        {starNumbers.map((value) => (
          <button key={value} type="button" role="radio" aria-checked={stars === value} aria-label={`${value} étoile${value > 1 ? "s" : ""} sur 5 · ${starLabels[value]}`}
            className={`trip-rate-star${stars != null && value <= stars ? " is-on" : ""}`} disabled={sending} onClick={() => { setStars(value); setStep({ kind: "choose" }); }}>
            <StarIcon size={34} weight={stars != null && value <= stars ? "fill" : "light"} aria-hidden="true"/>
          </button>
        ))}
      </div>
      <p className={`trip-rate-label${stars == null ? " is-empty" : ""}`} aria-live="polite">{stars != null ? starLabels[stars] : "Touchez une étoile"}</p>
      {(step.kind === "choose" || step.kind === "uncertain") && step.failure ? (
        <div className="trip-rate-failure" role="alert"><p className="form-error">{step.failure.message}</p><p className="bike-action-raw">{[`HTTP ${step.failure.httpStatus || "aucune réponse"}`, step.failure.code && !step.failure.code.startsWith("local.") && step.failure.code !== "network" ? `Code ${step.failure.code}` : null].filter(Boolean).join(" · ")}</p>{step.kind === "uncertain" ? <p className="uncertain-note">{UNCERTAIN}</p> : null}</div>
      ) : null}
      <div className="trip-rate-actions">
        {step.kind === "uncertain" ? <><TextButton onClick={onLater}>Plus tard</TextButton><Button variant="secondary" pending={step.checking} onClick={() => void verify(step.failure)}>Vérifier</Button></> : <>
          {!sending ? <TextButton onClick={onLater}>Plus tard</TextButton> : null}
          <Button pending={sending} disabled={stars == null} onClick={() => { if (stars != null) void submit(stars); }}>Envoyer · +5 points</Button>
        </>}
      </div>
    </section>
  );
}

function CopyCode({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <dd className="trip-token">{token}
      <button className="icon-button" aria-label={copied ? "Code copié" : "Copier le code du trajet"} title={copied ? "Copié" : "Copier"}
        onClick={() => void navigator.clipboard?.writeText(token).then(() => setCopied(true), () => setCopied(false))}>
        {copied ? <CheckIcon size={16} weight="bold"/> : <CopyIcon size={16} weight="light"/>}
      </button>
    </dd>
  );
}

export function TripSheet({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const [bikeOpen, setBikeOpen] = useState(false);
  const points = pointsLine(trip);
  const rated = trip.isRated === true || ratedHere.has(trip.id);
  const sameStation = trip.startStationNumber != null && trip.startStationNumber === trip.endStationNumber;
  const subject = `Trajet litigieux${trip.token ? ` ${trip.token}` : ""}`;
  return (
    <>
      <Modal titleId="trip-detail-title" onClose={onClose}>
        <div className="modal-heading">
          <h2 id="trip-detail-title">Trajet</h2>
          <button className="icon-button" aria-label="Fermer les détails" onClick={onClose}><XIcon size={20} weight="light"/></button>
        </div>
        <p className="detail-date">{tripTimes(trip)}</p>
        <div className="trip-detail-route">
          <Stop label="Départ" station={trip.startStation} stand={trip.startStand}/>
          <Stop label="Arrivée" station={trip.endStation} stand={trip.endStand}/>
        </div>
        <div className="trip-detail-facts">
          <span><small>Durée</small><strong>{trip.duration != null ? `${trip.duration} min` : "—"}</strong></span>
          <span><small>Distance</small><strong>{trip.distance != null && !sameStation ? `≈ ${formatDistance(trip.distance)}` : "—"}</strong></span>
          <span><small>Payé</small><strong>{trip.price != null ? formatPrice(trip.price) : "—"}</strong>{trip.discount > 0 && trip.fullPrice != null ? <span className="trip-fact-note">Prix {formatPrice(trip.fullPrice)} · Remise {formatPrice(trip.discount)}</span> : null}</span>
        </div>
        {points ? <p className="trip-points">{points}</p> : null}
        {trip.litigious ? (
          <div className="trip-alert" role="note">
            <p>Vélo’v a signalé ce trajet comme litigieux.</p>
            <a className="text-link" href={`mailto:contact.velov@jcdecaux.com?subject=${encodeURIComponent(subject)}`}>Contacter le service client</a>
          </div>
        ) : null}
        {!rated && trip.bikeNumber != null && canRate(trip) ? <RateBike trip={trip} bikeNumber={trip.bikeNumber} onLater={() => { dismissTrip(localStorage, trip.id); onClose(); }}/> : null}
        <details className="bike-more">
          <summary>Détails<CaretDownIcon size={14} weight="bold" aria-hidden="true"/></summary>
          <div className="detail-type">
            <Eyebrow icon={trip.bikeType === "electrical" ? LightningIcon : BicycleIcon}>{trip.bikeType === "electrical" ? "Électrique" : trip.bikeType === "mechanical" ? "Mécanique" : "Vélo’v"}</Eyebrow>
            {trip.bikeNumber != null ? <button className="text-button" onClick={() => setBikeOpen(true)}>Vélo n° {trip.bikeNumber}<CaretRightIcon size={14} weight="bold" aria-hidden="true"/></button> : null}
          </div>
          <dl className="account-details bike-details">
            {rated ? <div><dt>Note du vélo</dt><dd>Déjà noté</dd></div> : null}
            {trip.token ? <div><dt>Code du trajet</dt><CopyCode token={trip.token}/></div> : null}
            {trip.status !== "FINISHED" ? <div><dt>Statut</dt><dd>{statuses[trip.status] ?? trip.status}</dd></div> : null}
          </dl>
        </details>
      </Modal>
      {bikeOpen && trip.bikeNumber != null ? <BikeDrawer number={trip.bikeNumber} onClose={() => setBikeOpen(false)}/> : null}
    </>
  );
}

export function TripEndedSheet({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const close = () => { dismissTrip(localStorage, trip.id); onClose(); };
  const [rateable] = useState(() => trip.isRated !== true && !ratedHere.has(trip.id) && canRate(trip));
  return (
    <Modal titleId="trip-ended-title" onClose={close}>
      <div className="modal-heading">
        <h2 id="trip-ended-title">Trajet terminé</h2>
        <button className="icon-button" aria-label="Fermer" onClick={close}><XIcon size={20} weight="light"/></button>
      </div>
      <p className="detail-date">{tripTimes(trip)}</p>
      <div className="trip-detail-route">
        <Stop label="Station d’arrivée" station={trip.endStation} stand={trip.endStand}/>
      </div>
      <div className="trip-detail-facts trip-ended-facts">
        <span><small>Durée</small><strong>{trip.duration != null ? `${trip.duration} min` : "—"}</strong></span>
        <span><small>Prix</small><strong>{trip.price != null ? formatPrice(trip.price) : "—"}</strong></span>
      </div>
      {rateable && trip.bikeNumber != null ? <RateBike trip={trip} bikeNumber={trip.bikeNumber} onLater={close}/>
        : <div className="modal-actions"><Button variant="secondary" onClick={close}>Fermer</Button></div>}
    </Modal>
  );
}
