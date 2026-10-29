"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { ClockIcon } from "@phosphor-icons/react/dist/csr/Clock";
import { LockOpenIcon } from "@phosphor-icons/react/dist/csr/LockOpen";
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { BOOKING_MINUTES, BOOKING_POINTS, RELEASE_DISTANCE, type BookResult, type Booking, type Outcome, type UnlockResult, bookResultSchema, capitalize, formatDate, unlockResultSchema } from "@/lib/models";
import { formatDistance, haversine } from "@/lib/geo";
import { Button, CardTag, Modal } from "./ui";

/** Present only while signed in: the bookings and a way to reload them (and the account) after a booking or a release. */
export const BookingsContext = createContext<{ bookings: Booking[]; changed: () => void } | null>(null);

export type Place = { stationNumber: number; stationName: string; standNumber: number; bikeNumber: number; lat: number | null; lon: number | null };
type Action = "book" | "unlock";
type Result = { action: "book"; value: BookResult } | { action: "unlock"; value: UnlockResult };
type Step = { kind: "start" } | { kind: "confirm"; action: Action } | { kind: "sending"; action: Action } | { kind: "done"; result: Result } | { kind: "expired" };

const errorSchema = z.object({ error: z.string(), code: z.string().optional() });
const signIn = "Connectez-vous pour réserver ou déverrouiller";

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
      <p className="bike-action-question">{action === "book" ? "Réserver ce vélo ?" : "Déverrouiller ce vélo ?"}</p>
      <dl className="bike-action-facts">
        <div><dt>Station</dt><dd>{place.stationName}</dd></div>
        <div><dt>Borne</dt><dd>{place.standNumber}</dd></div>
        <div><dt>Vélo</dt><dd>{place.bikeNumber}</dd></div>
        {action === "book" ? <div><dt>Coût</dt><dd>{BOOKING_POINTS} points · {BOOKING_MINUTES} min</dd></div> : null}
        {action === "unlock" && distance != null ? <div><dt>Distance</dt><dd>≈ {formatDistance(distance)}</dd></div> : null}
      </dl>
      {action === "book" ? <p className="bike-action-note">Le vélo vous attend {BOOKING_MINUTES} min, puis la réservation expire. Elle ne s’annule pas.</p>
        : <p className="bike-action-note bike-action-warning">Ensuite, appuyez sur le bouton de la borne dans les 60 secondes, puis retirez le vélo. Passé ce délai, la borne le reverrouille.</p>}
      {action === "unlock" && far ? <p className="bike-action-far" role="alert"><WarningIcon size={16} weight="bold" aria-hidden="true"/>Vous semblez à plus de {RELEASE_DISTANCE} m de la station : un vélo libéré à distance peut partir sur votre compte.</p> : null}
      <div className="bike-action-buttons">
        <Button variant="ghost" disabled={sending} onClick={onCancel}>Annuler</Button>
        <Button pending={sending} onClick={onConfirm}>Confirmer</Button>
      </div>
    </>
  );
}

function BookedUntil({ endsAt }: { endsAt: string | null }) {
  const left = useSecondsLeft(endsAt);
  if (!endsAt || left == null) return <strong>Vélo réservé pour {BOOKING_MINUTES} min</strong>;
  return <><strong>Vélo réservé jusqu’à <span className="clock">{formatDate(endsAt, { hour: "2-digit", minute: "2-digit" })}</span></strong><span className="bike-action-countdown"><ClockIcon size={15} weight="bold" aria-hidden="true"/>{left > 0 ? <>reste <span className="clock">{clock(left)}</span></> : "réservation expirée"}</span></>;
}

function Done({ result, place, onBack, onUnlock }: { result: Result; place: Place; onBack: () => void; onUnlock: () => void }) {
  const { value } = result;
  if (!value.ok) return (
    <>
      <div className="bike-action-result bike-action-failed" role="alert">
        <span className="card-tag-icon"><XIcon size={15} weight="bold" aria-hidden="true"/></span>
        <div><strong>{result.action === "book" ? "Réservation refusée" : "Déverrouillage refusé"}</strong><p>{value.message}</p></div>
      </div>
      <Raw outcome={value}/>
      <div className="bike-action-buttons"><Button variant="secondary" onClick={onBack}>Retour</Button></div>
    </>
  );
  if (result.action === "book") return (
    <>
      <div className="bike-action-result" role="status">
        <span className="card-tag-icon"><CheckIcon size={15} weight="bold" aria-hidden="true"/></span>
        <div><BookedUntil endsAt={result.value.booking?.endsAt ?? null}/><p>Vélo {place.bikeNumber} · Borne {place.standNumber}</p></div>
      </div>
      <div className="bike-action-buttons"><Button variant="secondary" onClick={onBack}>Fermer</Button><Button onClick={onUnlock}><LockOpenIcon size={17} weight="light" aria-hidden="true"/>Déverrouiller</Button></div>
    </>
  );
  const ongoing = result.value.ongoing;
  return (
    <>
      <div className="bike-action-result" role="status">
        <span className="card-tag-icon"><CheckIcon size={15} weight="bold" aria-hidden="true"/></span>
        <div><strong>Vélo déverrouillé — Borne {place.standNumber}</strong><p>Appuyez maintenant sur le bouton de la borne (60 s), puis retirez le vélo.</p>
          <p>{ongoing?.length ? "Trajet en cours." : "Le trajet apparaît une dizaine de secondes après le retrait du vélo."}</p></div>
      </div>
      <Raw outcome={value} extra={`Trips/ongoing ${ongoing ? ongoing.length : "illisible"}`}/>
      <div className="bike-action-buttons"><Button variant="secondary" onClick={onBack}>Fermer</Button></div>
    </>
  );
}

/** Book or release one bike: a confirmation step, exactly one request per confirmation, and the raw answer kept on screen. */
export function BikeActions({ place, booking = null, initial }: { place: Place; booking?: Booking | null; initial?: Action }) {
  const account = useContext(BookingsContext);
  const [step, setStep] = useState<Step>(initial ? { kind: "confirm", action: initial } : { kind: "start" });
  const [failure, setFailure] = useState<string | null>(null);
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
        setFailure(`${error.success ? error.data.error : "Le service ne répond pas."} (HTTP ${response.status}${error.success && error.data.code ? ` · ${error.data.code}` : ""})`);
        setStep({ kind: "confirm", action });
        return;
      }
      let result: Result | null = null;
      if (action === "book") { const parsed = bookResultSchema.safeParse(raw); if (parsed.success) result = { action, value: parsed.data }; }
      else { const parsed = unlockResultSchema.safeParse(raw); if (parsed.success) result = { action, value: parsed.data }; }
      if (!result) { setFailure("Réponse illisible : vérifiez la borne et vos réservations avant de réessayer."); setStep({ kind: "confirm", action }); return; }
      setStep({ kind: "done", result });
      if (result.value.ok) account?.changed();
    } catch {
      setFailure("Pas de réponse du serveur. Vérifiez la borne et vos réservations avant de réessayer.");
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
            {!booking ? <Button variant="secondary" onClick={() => setStep({ kind: "confirm", action: "book" })}>Réserver ({BOOKING_MINUTES} min · {BOOKING_POINTS} points)</Button> : null}
            <Button onClick={() => setStep({ kind: "confirm", action: "unlock" })}><LockOpenIcon size={17} weight="light" aria-hidden="true"/>Déverrouiller</Button>
          </div>
        </>
      ) : step.kind === "done" ? (
        <Done result={step.result} place={place} onBack={() => setStep({ kind: "start" })} onUnlock={() => setStep({ kind: "confirm", action: "unlock" })}/>
      ) : (
        <>
          <Confirm action={step.action} place={place} sending={step.kind === "sending"} onCancel={() => setStep({ kind: "start" })} onConfirm={() => void send(step.action)}/>
          {failure ? <p className="form-error" role="alert">{failure}</p> : null}
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

/** Kept apart from the banner: the release consumes the booking, and its result must outlive the banner. */
export function UnlockModal({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const place = placeOf(booking);
  if (!place) return null;
  return (
    <Modal titleId="booking-unlock-title" onClose={onClose}>
      <div className="modal-heading">
        <h2 id="booking-unlock-title">Vélo {place.bikeNumber}</h2>
        <button className="icon-button" aria-label="Fermer" onClick={onClose}><XIcon size={20} weight="light"/></button>
      </div>
      <BikeActions place={place} booking={booking} initial="unlock"/>
    </Modal>
  );
}
