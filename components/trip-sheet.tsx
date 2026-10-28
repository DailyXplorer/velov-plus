"use client";

import { useState } from "react";
import { z } from "zod";
import { PersonSimpleBikeIcon as BicycleIcon } from "@phosphor-icons/react/dist/csr/PersonSimpleBike";
import { LightningIcon } from "@phosphor-icons/react/dist/csr/Lightning";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { CopyIcon } from "@phosphor-icons/react/dist/csr/Copy";
import { ThumbsDownIcon } from "@phosphor-icons/react/dist/csr/ThumbsDown";
import { ThumbsUpIcon } from "@phosphor-icons/react/dist/csr/ThumbsUp";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { type Trip, canRate, formatDate, formatPrice } from "@/lib/models";
import { Button, Eyebrow, Modal } from "./ui";
import { BikeDrawer } from "./station-bikes";

type Vote = { recommended: true; rating: null } | { recommended: false; rating: 30 | 60 };
type RatingStep = { kind: "start" } | { kind: "reasons" } | { kind: "confirm"; vote: Vote; error?: string } | { kind: "sending"; vote: Vote } | { kind: "done" };

const errorSchema = z.object({ error: z.string() });
const notSent = "La note n’a pas pu être envoyée. Réessayez dans un instant.";
// The defect list (GET /defect-type-groups) refuses the web client token, so its two rating levels stand in for it.
const defects: { rating: 30 | 60; label: string }[] = [
  { rating: 30, label: "Problème grave (freins, crevaison, ne démarre pas)" },
  { rating: 60, label: "Autre problème" }
];
const statuses: Record<string, string> = { REQUESTED: "Demandé", STARTED: "En cours", PAUSED: "En pause", FINISHED: "Terminé", AUTO_FINISHED: "Terminé automatiquement", REJECTED: "Refusé", TIMEOUT: "Expiré", ERROR: "En erreur", WARNING: "Avertissement", REVERSED: "Annulé" };
// Only origin 4 (smartphone) has been observed.
const origins: Record<number, string> = { 4: "Application" };
// Dashboard data comes back stale until the next reload; remember ratings sent from this tab.
const ratedHere = new Set<string>();

function tripTimes(trip: Trip) {
  if (!trip.startedAt) return "Date indisponible";
  const time = (value: string) => formatDate(value, { hour: "2-digit", minute: "2-digit" });
  return `${formatDate(trip.startedAt, { day: "numeric", month: "long", year: "numeric" })} · ${time(trip.startedAt)}${trip.endedAt ? ` → ${time(trip.endedAt)}` : ""}`;
}

function formatDistance(meters: number) {
  return meters >= 1000 ? `≈ ${(meters / 1000).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km` : `≈ ${Math.max(10, Math.round(meters / 10) * 10)} m`;
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

function RateBike({ trip, bikeNumber }: { trip: Trip; bikeNumber: number }) {
  const [step, setStep] = useState<RatingStep>({ kind: "start" });

  async function send(vote: Vote) {
    setStep({ kind: "sending", vote });
    try {
      const response = await fetch(`/api/trips/${encodeURIComponent(trip.id)}/rate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bikeNumber, ...vote }) });
      if (!response.ok) {
        const error = errorSchema.safeParse(await response.json().catch(() => null));
        throw new Error(error.success ? error.data.error : notSent);
      }
      ratedHere.add(trip.id);
      setStep({ kind: "done" });
    } catch (error) {
      setStep({ kind: "confirm", vote, error: error instanceof Error && error.message ? error.message : notSent });
    }
  }

  if (step.kind === "done") return <p className="trip-rate-done" role="status"><CheckIcon size={16} weight="bold" aria-hidden="true"/>Merci, +5 points</p>;
  return (
    <section className="trip-rate" aria-labelledby="trip-rate-title">
      <h3 id="trip-rate-title" className="trip-rate-title">Noter ce vélo · <span>+5 points</span></h3>
      {step.kind === "start" ? (
        <div className="trip-rate-actions">
          <Button variant="secondary" onClick={() => setStep({ kind: "confirm", vote: { recommended: true, rating: null } })}><ThumbsUpIcon size={17} weight="light" aria-hidden="true"/>Je recommande</Button>
          <Button variant="secondary" onClick={() => setStep({ kind: "reasons" })}><ThumbsDownIcon size={17} weight="light" aria-hidden="true"/>Je déconseille</Button>
        </div>
      ) : step.kind === "reasons" ? (
        <>
          <p className="trip-rate-question" id="trip-rate-reasons">Quel problème ?</p>
          <div className="trip-rate-reasons" role="group" aria-labelledby="trip-rate-reasons">
            {defects.map((defect) => <button key={defect.rating} className="trip-rate-reason" onClick={() => setStep({ kind: "confirm", vote: { recommended: false, rating: defect.rating } })}>{defect.label}<CaretRightIcon size={15} weight="light" aria-hidden="true"/></button>)}
          </div>
          <div className="trip-rate-actions"><Button variant="ghost" onClick={() => setStep({ kind: "start" })}>Annuler</Button></div>
        </>
      ) : (
        <>
          <p className="trip-rate-question">Envoyer la note ?</p>
          <p className="trip-rate-summary">{step.vote.recommended ? "Je recommande ce vélo" : `Je déconseille ce vélo · ${defects.find((defect) => defect.rating === step.vote.rating)?.label}`}</p>
          {step.kind === "confirm" && step.error ? <p className="form-error" role="alert">{step.error}</p> : null}
          <div className="trip-rate-actions">
            <Button variant="ghost" disabled={step.kind === "sending"} onClick={() => setStep({ kind: "start" })}>Annuler</Button>
            <Button pending={step.kind === "sending"} onClick={() => void send(step.vote)}>Envoyer</Button>
          </div>
        </>
      )}
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
          <span><small>Durée</small><strong>{trip.duration} min</strong></span>
          <span><small>Distance</small><strong>{trip.distance != null && !sameStation ? formatDistance(trip.distance) : "—"}</strong>{trip.distance != null && !sameStation ? <span className="trip-fact-note">à vol d’oiseau</span> : null}</span>
          <span><small>Payé</small><strong>{formatPrice(trip.price)}</strong>{trip.discount > 0 && trip.fullPrice != null ? <span className="trip-fact-note">Prix {formatPrice(trip.fullPrice)} · remise {formatPrice(trip.discount)}</span> : null}</span>
        </div>
        {points ? <p className="trip-points">{points}</p> : null}
        <div className="detail-type">
          <Eyebrow icon={trip.bikeType === "electrical" ? LightningIcon : BicycleIcon}>{trip.bikeType === "electrical" ? "Électrique" : trip.bikeType === "mechanical" ? "Mécanique" : "Vélo’v"}</Eyebrow>
          {trip.bikeNumber != null ? <button className="text-button" onClick={() => setBikeOpen(true)}>Vélo n° {trip.bikeNumber}<CaretRightIcon size={14} weight="bold" aria-hidden="true"/></button> : null}
        </div>
        {trip.litigious ? (
          <div className="trip-alert" role="note">
            <p>Trajet signalé comme litigieux par Vélo’v</p>
            <a className="text-link" href={`mailto:contact.velov@jcdecaux.com?subject=${encodeURIComponent(subject)}`}>Contacter le service client</a>
          </div>
        ) : null}
        {rated ? <p className="trip-rated">Vélo noté</p> : trip.bikeNumber != null && canRate(trip) ? <RateBike trip={trip} bikeNumber={trip.bikeNumber}/> : null}
        <details className="bike-more">
          <summary>Détails<CaretDownIcon size={14} weight="bold" aria-hidden="true"/></summary>
          <dl className="account-details bike-details">
            {trip.token ? <div><dt>Code du trajet</dt><CopyCode token={trip.token}/></div> : null}
            <div><dt>Statut</dt><dd>{statuses[trip.status] ?? trip.status}</dd></div>
            {trip.origin != null && origins[trip.origin] ? <div><dt>Déverrouillage</dt><dd>{origins[trip.origin]}</dd></div> : null}
          </dl>
        </details>
      </Modal>
      {bikeOpen && trip.bikeNumber != null ? <BikeDrawer number={trip.bikeNumber} onClose={() => setBikeOpen(false)}/> : null}
    </>
  );
}
