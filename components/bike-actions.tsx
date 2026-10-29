"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { ClockIcon, LockOpenIcon, TimerIcon, WarningIcon, XIcon } from "./icons";
import { BOOKING_MINUTES, BOOKING_POINTS, RELEASE_DISTANCE, type Booking, type Outcome, bookResultSchema, capitalize, formatDate, unlockResultSchema } from "@/lib/models";
import { formatDistance, haversine } from "@/lib/geo";
import { Button, CardTag, Modal } from "./ui";

/** Present only while signed in: the bookings, a way to reload them after a booking or a release, and the start of the dock watch after a release. */
export const BookingsContext = createContext<{ bookings: Booking[]; changed: () => void; unlocked: (tripId: string | null) => void } | null>(null);

export type Place = { stationNumber: number; stationName: string; standNumber: number; bikeNumber: number; lat: number | null; lon: number | null };
type Action = "book" | "unlock";
type Step = { kind: "start" } | { kind: "confirm"; action: Action } | { kind: "sending"; action: Action } | { kind: "expired" };
/** Why the last confirmation did not go through, with Vélo’v’s raw status when it answered. */
type Failure = { message: string; outcome?: Outcome };

const errorSchema = z.object({ error: z.string(), code: z.string().optional() });
const signIn = "Connectez-vous pour réserver ou déverrouiller un vélo.";

/** Seconds left until a date, ticking every second; null without a date. */
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

/** The distance to the station, only when the browser already allows geolocation: never prompts. */
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

function Confirm({ action, place, onCancel, onConfirm, sending }: { action: Action; place: Place; onCancel: () => void; onConfirm: () => void; sending: boolean }) {
  const distance = useKnownDistance(place);
  const far = distance != null && distance > RELEASE_DISTANCE;
  return (
    <>
      <p className="bike-action-question">{action === "book" ? "Réserver ce vélo ?" : "Déverrouiller ce vélo ?"}</p>
      {action === "book" ? <p className="bike-action-note">{BOOKING_POINTS} points pour garder ce vélo {BOOKING_MINUTES} minutes.</p>
        : <p className="bike-action-note bike-action-warning">Vous aurez ensuite 60 secondes pour appuyer sur le bouton de la borne {place.standNumber} et retirer le vélo.</p>}
      {action === "unlock" && far ? <p className="bike-action-far" role="alert"><WarningIcon size={16} weight="bold" aria-hidden="true"/>Vous semblez être à plus de {RELEASE_DISTANCE} m de la station. Si quelqu’un d’autre prend le vélo, le trajet vous sera facturé.</p> : null}
      <div className="bike-action-buttons">
        <Button variant="ghost" disabled={sending} onClick={onCancel}>Annuler</Button>
        <Button pending={sending} onClick={onConfirm}>Confirmer</Button>
      </div>
    </>
  );
}

function BookedUntil({ endsAt }: { endsAt: string | null }) {
  const left = useSecondsLeft(endsAt);
  if (!endsAt || left == null) return <strong>Vélo réservé pour {BOOKING_MINUTES} minutes</strong>;
  return <><strong>Vélo réservé jusqu’à <span className="clock">{formatDate(endsAt, { hour: "2-digit", minute: "2-digit" })}</span></strong><span className="bike-action-countdown"><ClockIcon size={15} weight="bold" aria-hidden="true"/>{left > 0 ? <>Il reste <span className="clock">{clock(left)}</span></> : "Réservation expirée"}</span></>;
}

/** Book or release one bike: a confirmation step and exactly one request per confirmation; success hands over to the page, a failure stays with its raw answer. */
export function BikeActions({ place, booking = null, initial, onDone }: { place: Place; booking?: Booking | null; initial?: Action; onDone: () => void }) {
  const account = useContext(BookingsContext);
  const [step, setStep] = useState<Step>(initial ? { kind: "confirm", action: initial } : { kind: "start" });
  const [failure, setFailure] = useState<Failure | null>(null);
  const inFlight = useRef(false);

  if (!account || step.kind === "expired") return <p className="bike-action-signin">{signIn}</p>;

  async function send(action: Action) {
    if (inFlight.current) return;
    inFlight.current = true;
    setFailure(null);
    setStep({ kind: "sending", action });
    try {
      const body = action === "book" ? { stationNumber: place.stationNumber, bikeNumber: place.bikeNumber } : { stationNumber: place.stationNumber, standNumber: place.standNumber, bikeNumber: place.bikeNumber };
      const response = await fetch(action === "book" ? "/api/bookings" : "/api/unlock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const raw: unknown = await response.json().catch(() => null);
      if (response.status === 401) { setStep({ kind: "expired" }); return; }
      if (!response.ok) {
        const error = errorSchema.safeParse(raw);
        setFailure({ message: `${error.success ? error.data.error : "Le service ne répond pas."} (HTTP ${response.status}${error.success && error.data.code ? ` · ${error.data.code}` : ""})` });
        setStep({ kind: "confirm", action });
        return;
      }
      const parsed = action === "book" ? bookResultSchema.safeParse(raw) : unlockResultSchema.safeParse(raw);
      if (!parsed.success) { setFailure({ message: "Réponse inattendue. Vérifiez la borne et vos réservations avant de réessayer." }); setStep({ kind: "confirm", action }); return; }
      const outcome = parsed.data;
      if (!outcome.ok) { setFailure({ message: outcome.message ?? (action === "book" ? "Réservation impossible." : "Déverrouillage impossible."), outcome }); setStep({ kind: "confirm", action }); return; }
      account?.changed();
      if (action === "unlock") account?.unlocked("ongoing" in outcome ? outcome.ongoing?.[0]?.id ?? null : null);
      onDone();
    } catch {
      setFailure({ message: "Le serveur ne répond pas. Vérifiez la borne et vos réservations avant de réessayer." });
      setStep({ kind: "confirm", action });
    } finally {
      inFlight.current = false;
    }
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
          <Confirm action={step.action} place={place} sending={step.kind === "sending"} onCancel={() => { setFailure(null); setStep({ kind: "start" }); }} onConfirm={() => void send(step.action)}/>
          {failure ? <><p className="form-error" role="alert">{failure.message}</p>{failure.outcome ? <Raw outcome={failure.outcome}/> : null}</> : null}
        </>
      )}
    </section>
  );
}

export function placeOf(booking: Booking): Place | null {
  return booking.bikeNumber != null && booking.standNumber != null ? { stationNumber: booking.stationNumber, stationName: booking.stationName, standNumber: booking.standNumber, bikeNumber: booking.bikeNumber, lat: booking.lat, lon: booking.lon } : null;
}

/** "Réservé · mm:ss · Déverrouiller" on one red line, hidden once the booking has run out; the unlock confirmation names the bike, borne and station. */
export function BookingBanner({ booking, onUnlock }: { booking: Booking; onUnlock: () => void }) {
  const left = useSecondsLeft(booking.endsAt);
  const place = placeOf(booking);
  if (left === 0) return null;
  return (
    <div className="booking-banner" role="status">
      <CardTag icon={ClockIcon}>Réservé</CardTag>
      {left != null ? <span className="booking-left clock">{clock(left)}</span> : null}
      {place ? <Button className="button-on-red" onClick={onUnlock}><LockOpenIcon size={17} weight="bold" aria-hidden="true"/>Déverrouiller</Button> : null}
    </div>
  );
}

/** Kept apart from the banner: the release consumes the booking, and its failure must outlive the banner. */
export function UnlockModal({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const place = placeOf(booking);
  if (!place) return null;
  return (
    <Modal titleId="booking-unlock-title" onClose={onClose}>
      <div className="modal-heading">
        <h2 id="booking-unlock-title">Vélo {place.bikeNumber}</h2>
        <button className="icon-button" aria-label="Fermer" onClick={onClose}><XIcon size={20} weight="light"/></button>
      </div>
      <BikeActions place={place} booking={booking} initial="unlock" onDone={onClose}/>
    </Modal>
  );
}
