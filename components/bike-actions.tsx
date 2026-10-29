"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { ClockIcon, LockOpenIcon, TimerIcon, WarningIcon, XIcon } from "./icons";
import { BOOKING_MINUTES, BOOKING_POINTS, RELEASE_DISTANCE, type Booking, type Outcome, capitalize, formatDate } from "@/lib/models";
import { formatDistance, haversine } from "@/lib/geo";
import { UNCERTAIN, UNCERTAIN_UNLOCK, isUncertain } from "@/lib/outcome";
import { sendBikeAction } from "@/lib/bike-action";
import { BUSY, runOnce } from "@/lib/operations";
import { operations, useOperation, useSending } from "./operations";
import { Button, Modal } from "./ui";

export const BookingsContext = createContext<{ bookings: Booking[]; changed: () => void; unlocked: (tripId: string | null) => void } | null>(null);

export type Place = { stationNumber: number; stationName: string; standNumber: number; bikeNumber: number; lat: number | null; lon: number | null };
type Action = "book" | "unlock";
type Step = { kind: "start" } | { kind: "confirm"; action: Action } | { kind: "sending"; action: Action } | { kind: "expired" };

const signIn = "Connectez-vous pour réserver ou déverrouiller un vélo.";

export function useSecondsLeft(until: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [until]);
  if (!until) return null;
  const end = new Date(until).getTime();
  return Number.isFinite(end) ? Math.max(0, Math.round((end - now) / 1_000)) : null;
}

function clock(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function useKnownDistance(place: Place) {
  const [distance, setDistance] = useState<number | null>(null);
  useEffect(() => {
    if (place.lat == null || place.lon == null || !navigator.geolocation || !navigator.permissions) return;
    const target = { lat: place.lat, lon: place.lon };
    let live = true;
    void navigator.permissions.query({ name: "geolocation" }).then((status) => {
      if (status.state !== "granted" || !live) return;
      navigator.geolocation.getCurrentPosition((position) => { if (live) setDistance(haversine({ lat: position.coords.latitude, lon: position.coords.longitude }, target)); }, () => {}, { maximumAge: 120_000, timeout: 8_000 });
    }, () => {});
    return () => { live = false; };
  }, [place.lat, place.lon]);
  return distance;
}

function Raw({ outcome, extra }: { outcome: Outcome; extra?: string }) {
  const parts = [`TransactionState ${outcome.transactionState ?? "—"}`, `Code ${outcome.code ?? "—"}`, `HTTP ${outcome.httpStatus || "aucune réponse"}`, outcome.detail && capitalize(outcome.detail), extra].filter(Boolean);
  return <p className="bike-action-raw">{parts.join(" · ")}</p>;
}

function Confirm({ action, place, onCancel, onClose, onConfirm, sending, uncertain }: { action: Action; place: Place; onCancel: () => void; onClose: () => void; onConfirm: () => void; sending: boolean; uncertain: boolean }) {
  const distance = useKnownDistance(place);
  const far = distance != null && distance > RELEASE_DISTANCE;
  return (
    <>
      <p className="bike-action-question">{action === "book" ? "Réserver ce vélo ?" : "Déverrouiller ce vélo ?"}</p>
      {action === "book" ? <p className="bike-action-note">{BOOKING_POINTS} points pour garder ce vélo {BOOKING_MINUTES} minutes.</p>
        : <p className="bike-action-note bike-action-warning">Vous aurez ensuite 60 secondes pour appuyer sur le bouton de la borne {place.standNumber} et retirer le vélo.</p>}
      {action === "unlock" && far ? <p className="bike-action-far" role="alert"><WarningIcon size={16} weight="bold" aria-hidden="true"/>Vous semblez être à plus de {RELEASE_DISTANCE} m de la station. Si quelqu’un d’autre prend le vélo, le trajet vous sera facturé.</p> : null}
      <div className="bike-action-buttons">
        {uncertain ? <Button variant="ghost" onClick={onClose}>Fermer</Button> : <>
          <Button variant="ghost" disabled={sending} onClick={onCancel}>Annuler</Button>
          <Button pending={sending} onClick={onConfirm}>Confirmer</Button>
        </>}
      </div>
    </>
  );
}

function BookedUntil({ endsAt }: { endsAt: string | null }) {
  const left = useSecondsLeft(endsAt);
  if (!endsAt || left == null) return <strong>Vélo réservé pour {BOOKING_MINUTES} minutes</strong>;
  return <><strong>Vélo réservé jusqu’à <span className="clock">{formatDate(endsAt, { hour: "2-digit", minute: "2-digit" })}</span></strong><span className="bike-action-countdown"><ClockIcon size={15} weight="bold" aria-hidden="true"/>{left > 0 ? <>Il reste <span className="clock">{clock(left)}</span></> : "Réservation expirée"}</span></>;
}

export function BikeActions({ place, booking = null, initial, onDone }: { place: Place; booking?: Booking | null; initial?: Action; onDone: () => void }) {
  const account = useContext(BookingsContext);
  const [chosen, setStep] = useState<Step>(initial ? { kind: "confirm", action: initial } : { kind: "start" });
  const [refused, setFailure] = useState<Outcome | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const unlocking = useOperation(`unlock:${place.bikeNumber}`);
  const reserving = useOperation(`book:${place.bikeNumber}`);
  const wantsUnlock = chosen.kind !== "start" && chosen.kind !== "expired" && chosen.action === "unlock";
  const held = unlocking ? { action: "unlock" as const, operation: unlocking } : reserving && !wantsUnlock ? { action: "book" as const, operation: reserving } : null;
  const bookedNow = booking !== null && reserving?.status === "uncertain";

  useEffect(() => { if (bookedNow) { operations.clear(`book:${place.bikeNumber}`); setFailure(null); setStep({ kind: "start" }); } }, [bookedNow, place.bikeNumber]);
  const step: Step = held && chosen.kind !== "expired" ? { kind: held.operation.status === "sending" ? "sending" : "confirm", action: held.action } : chosen;
  const failure = held ? held.operation.outcome : refused;

  if (!account || step.kind === "expired") return <p className="bike-action-signin">{signIn}</p>;

  async function send(action: Action) {
    setFailure(null);
    setNotice(null);
    const key = `${action}:${place.bikeNumber}`;
    const outcome = await runOnce(operations, key, () => sendBikeAction(action, place));
    if (outcome === "busy" || outcome === "unsaved") { if (!operations.get(key)) setNotice(BUSY); return; }
    if (outcome.httpStatus === 401) { setStep({ kind: "expired" }); return; }
    if (outcome.ok) {
      account?.changed();
      if (action === "unlock") account?.unlocked("ongoing" in outcome ? outcome.ongoing?.[0]?.id ?? null : null);
      onDone();
      return;
    }
    setFailure({ ...outcome, message: outcome.message ?? (action === "book" ? "Réservation impossible." : "Déverrouillage impossible.") });
    setStep({ kind: "confirm", action });
    if (action === "book" && isUncertain(outcome)) account?.changed();
  }

  return (
    <section className="bike-action" aria-label="Réserver ou déverrouiller">
      {step.kind === "start" ? (
        <>
          {booking ? <p className="bike-action-mine"><BookedUntil endsAt={booking.endsAt}/></p> : null}
          <div className="bike-action-buttons">
            {!booking ? <Button variant="secondary" onClick={() => setStep({ kind: "confirm", action: "book" })}><TimerIcon size={17} weight="light" aria-hidden="true"/>Réserver</Button> : null}
            <Button onClick={() => setStep({ kind: "confirm", action: "unlock" })}><LockOpenIcon size={17} weight="light" aria-hidden="true"/>Déverrouiller</Button>
          </div>
        </>
      ) : (
        <>
          <Confirm action={step.action} place={place} sending={step.kind === "sending"} uncertain={failure !== null && isUncertain(failure)} onCancel={() => { setFailure(null); setNotice(null); setStep({ kind: "start" }); }} onClose={onDone} onConfirm={() => void send(step.action)}/>
          {notice ? <p className="form-error" role="alert">{notice}</p> : null}
          {failure ? <><p className="form-error" role="alert">{failure.message ?? (step.action === "book" ? "Réservation impossible." : "Déverrouillage impossible.")}</p><Raw outcome={failure}/>{isUncertain(failure) ? <p className="uncertain-note">{step.action === "unlock" ? UNCERTAIN_UNLOCK : UNCERTAIN}</p> : null}</> : null}
        </>
      )}
    </section>
  );
}

export function placeOf(booking: Booking): Place | null {
  return booking.bikeNumber != null && booking.standNumber != null ? { stationNumber: booking.stationNumber, stationName: booking.stationName, standNumber: booking.standNumber, bikeNumber: booking.bikeNumber, lat: booking.lat, lon: booking.lon } : null;
}

export function BookingBanner({ booking, onUnlock }: { booking: Booking; onUnlock: () => void }) {
  const left = useSecondsLeft(booking.endsAt);
  const place = placeOf(booking);
  if (left === 0) return null;
  return (
    <div className="booking-banner" role="status" aria-label={left != null ? `Vélo réservé, ${Math.floor(left / 60)} min ${String(left % 60).padStart(2, "0")} restantes` : "Vélo réservé"}>
      <span className="booking-left"><ClockIcon size={18} weight="bold" aria-hidden="true"/>{left != null ? <span className="booking-time">{clock(left)}</span> : null}</span>
      {place ? <Button className="button-on-red" onClick={onUnlock}><LockOpenIcon size={16} weight="bold" aria-hidden="true"/>Déverrouiller</Button> : null}
    </div>
  );
}

export function UnlockModal({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const place = placeOf(booking);
  const sending = useSending();
  if (!place) return null;
  return (
    <Modal titleId="booking-unlock-title" onClose={sending ? () => {} : onClose}>
      <div className="modal-heading">
        <h2 id="booking-unlock-title">Vélo {place.bikeNumber}</h2>
        <button className="icon-button" aria-label="Fermer" disabled={sending} onClick={onClose}><XIcon size={20} weight="light"/></button>
      </div>
      <BikeActions place={place} booking={booking} initial="unlock" onDone={onClose}/>
    </Modal>
  );
}
