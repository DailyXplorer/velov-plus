"use client";

import { type ReactNode, createContext, useContext, useEffect, useState } from "react";
import { z } from "zod";
import { ClockIcon, type Icon, LockOpenIcon, TimerIcon, WarningIcon, XIcon } from "./icons";
import { BOOKING_MINUTES, BOOKING_POINTS, RELEASE_DISTANCE, type Booking, type Outcome, bookingSchema, formatDate } from "@/lib/models";
import { formatDistance, haversine } from "@/lib/geo";
import { UNCERTAIN, UNCERTAIN_UNLOCK, UNVERIFIED, isUncertain } from "@/lib/outcome";
import { bookingCheck, pollUnlock, sendBikeAction, unlockCheck } from "@/lib/bike-action";
import { tripCheckSchema } from "@/lib/trip-end";
import { blockedMessage, runOnce, settleHeld } from "@/lib/operations";
import { sessionGate } from "@/lib/session-gate";
import { accountJson } from "./get-json";
import { operations, useOperation, useSending } from "./operations";
import { Button, Modal } from "./ui";

export const BookingsContext = createContext<{ bookings: Booking[]; changed: () => void; unlocked: (tripId: string | null, bikeNumber: number) => void; expired: () => void; email: string | null } | null>(null);
export const SignInContext = createContext<(() => void) | null>(null);

export type Place = { stationNumber: number; stationName: string; standNumber: number; bikeNumber: number; lat: number | null; lon: number | null };
type Action = "book" | "unlock";
type Step = { kind: "start" } | { kind: "confirm"; action: Action } | { kind: "sending"; action: Action };

const signIn = "Connectez-vous pour réserver ou déverrouiller un vélo.";

function useNow(ticking: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}

export function useSecondsLeft(until: string | null) {
  const now = useNow(until !== null);
  const end = until ? new Date(until).getTime() : NaN;
  return Number.isFinite(end) ? Math.max(0, Math.round((end - now) / 1_000)) : null;
}

export function useSecondsSince(since: string | null) {
  const now = useNow(since !== null);
  const start = since ? new Date(since).getTime() : NaN;
  return Number.isFinite(start) ? Math.max(0, Math.floor((now - start) / 1_000)) : null;
}

const pad = (value: number) => String(value).padStart(2, "0");

export function clock(seconds: number) {
  const hours = Math.floor(seconds / 3_600);
  const minutes = `${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
  return hours ? `${hours}:${minutes}` : minutes;
}

export function RedBanner({ icon: BannerIcon, seconds, label, children }: { icon: Icon; seconds: number | null; label: string; children?: ReactNode }) {
  return (
    <div className="booking-banner" role="status" aria-label={label}>
      <span className="booking-left"><span className="booking-clock"><BannerIcon size={17} weight="light" aria-hidden="true"/></span>{seconds != null ? <span className="booking-time">{clock(seconds)}</span> : null}</span>
      {children}
    </div>
  );
}

export function OnRedPill({ icon: PillIcon, children, onClick }: { icon: Icon; children: ReactNode; onClick: () => void }) {
  return <Button className="button-on-red" onClick={onClick}><span className="eyebrow-icon"><PillIcon size={15} weight="light" aria-hidden="true"/></span>{children}</Button>;
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

function Confirm({ action, place, onCancel, onClose, onConfirm, onVerify, sending, checking, uncertain, children }: { action: Action; place: Place; onCancel: () => void; onClose: () => void; onConfirm: () => void; onVerify: () => void; sending: boolean; checking: boolean; uncertain: boolean; children: ReactNode }) {
  const distance = useKnownDistance(place);
  const far = distance != null && distance > RELEASE_DISTANCE;
  return (
    <>
      <p className="bike-action-question">{action === "book" ? "Réserver ce vélo ?" : `Déverrouiller le vélo ${place.bikeNumber} ?`}</p>
      {action === "book" ? <p className="bike-action-note">{BOOKING_POINTS} points pour garder ce vélo {BOOKING_MINUTES} minutes.</p>
        : <><p className="bike-action-place">{place.stationName} · Borne {place.standNumber}</p><p className="bike-action-note bike-action-warning">Vous aurez ensuite 60 secondes pour appuyer sur le bouton de la borne et retirer le vélo.</p></>}
      {action === "unlock" && far ? <p className="bike-action-far" role="alert"><WarningIcon size={16} weight="bold" aria-hidden="true"/>Vous semblez être à plus de {RELEASE_DISTANCE} m de la station. Si quelqu’un d’autre prend le vélo, le trajet vous sera facturé.</p> : null}
      {children}
      <div className="bike-action-buttons">
        {uncertain ? <><Button variant="ghost" onClick={onClose}>Fermer</Button><Button variant="secondary" pending={checking} onClick={onVerify}>Vérifier</Button></> : <>
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

export function BikeActions({ place, booking = null, initial, dialog = false, onDone }: { place: Place; booking?: Booking | null; initial?: Action; dialog?: boolean; onDone: () => void }) {
  const account = useContext(BookingsContext);
  const [chosen, setStep] = useState<Step>(initial ? { kind: "confirm", action: initial } : { kind: "start" });
  const [refused, setFailure] = useState<Outcome | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const unlocking = useOperation(`unlock:${place.bikeNumber}`);
  const reserving = useOperation(`book:${place.bikeNumber}`);
  const wantsUnlock = chosen.kind !== "start" && chosen.action === "unlock";
  const held = unlocking ? { action: "unlock" as const, operation: unlocking } : reserving && !wantsUnlock ? { action: "book" as const, operation: reserving } : null;
  const bookedNow = booking !== null && reserving?.status === "uncertain";

  const reservingId = reserving?.id ?? "";
  useEffect(() => { if (bookedNow) { void operations.clear(`book:${place.bikeNumber}`, reservingId); setFailure(null); setStep({ kind: "start" }); } }, [bookedNow, place.bikeNumber, reservingId]);
  const pollId = account && unlocking?.status === "uncertain" ? unlocking.id : null;
  const pollAt = unlocking?.at ?? 0;
  useEffect(() => {
    if (!pollId) return;
    return pollUnlock(() => verify("unlock", false), pollAt);
  }, [pollId, pollAt]);
  const step: Step = held ? { kind: held.operation.status === "sending" ? "sending" : "confirm", action: held.action } : chosen;
  const failure = held ? held.operation.outcome : refused;

  if (!account) return <p className="bike-action-signin">{signIn}</p>;

  async function send(action: Action) {
    setFailure(null);
    setNotice(null);
    const key = `${action}:${place.bikeNumber}`;
    const stamp = sessionGate.stamp();
    const outcome = await runOnce(operations, key, () => sendBikeAction(action, { ...place, account: account?.email ?? null }), { keep: true, meta: { stationNumber: place.stationNumber, standNumber: place.standNumber, bikeNumber: place.bikeNumber } });
    if (!stamp.live()) return;
    if (typeof outcome === "string") { setNotice(blockedMessage(outcome, operations.get(key) !== null)); return; }
    if (outcome.httpStatus === 401) { account?.expired(); return; }
    if (outcome.ok) {
      account?.changed();
      if (action === "unlock") account?.unlocked("ongoing" in outcome ? outcome.ongoing?.[0]?.id ?? null : null, place.bikeNumber);
      onDone();
      return;
    }
    setFailure({ ...outcome, message: outcome.message ?? (action === "book" ? "Réservation impossible." : "Déverrouillage impossible.") });
    setStep({ kind: "confirm", action });
    if (action === "book" && isUncertain(outcome)) account?.changed();
    if (action === "unlock" && isUncertain(outcome)) account?.unlocked(null, place.bikeNumber);
  }

  async function verify(action: Action, asked = true): Promise<boolean> {
    const key = `${action}:${place.bikeNumber}`;
    let tripId: string | null = null;
    const stamp = sessionGate.stamp();
    setChecking(true);
    setNotice(null);
    const settled = await settleHeld(operations, key, async (held) => {
      const bikeNumber = Number(held.meta.bikeNumber ?? place.bikeNumber);
      if (action === "book") return bookingCheck(await accountJson("/api/bookings", z.array(bookingSchema), ""), bikeNumber);
      const found = unlockCheck(await accountJson("/api/trips/current", tripCheckSchema, ""), bikeNumber, held.at);
      tripId = found.tripId;
      return found.check;
    });
    setChecking(false);
    if (!stamp.live()) return settled?.kind !== "uncertain";
    if (settled?.kind === "done") {
      account?.changed();
      if (action === "unlock") account?.unlocked(tripId, place.bikeNumber);
      onDone();
    } else if (settled?.kind === "refused") {
      setFailure(settled.outcome);
      setStep({ kind: "confirm", action });
    } else if (settled && asked) setNotice(UNVERIFIED);
    return settled?.kind !== "uncertain";
  }

  return (
    <section className={dialog ? "bike-action bike-action-dialog" : "bike-action"} aria-label="Réserver ou déverrouiller">
      {step.kind === "start" ? (
        <>
          {booking ? <p className="bike-action-mine"><BookedUntil endsAt={booking.endsAt}/></p> : null}
          <div className="bike-action-buttons bike-action-start">
            {!booking ? <Button variant="secondary" onClick={() => setStep({ kind: "confirm", action: "book" })}><TimerIcon size={17} weight="light" aria-hidden="true"/>Réserver</Button> : null}
            <Button onClick={() => setStep({ kind: "confirm", action: "unlock" })}><LockOpenIcon size={17} weight="light" aria-hidden="true"/>Déverrouiller</Button>
          </div>
        </>
      ) : (
        <>
          <Confirm action={step.action} place={place} sending={step.kind === "sending"} checking={checking} onVerify={() => void verify(step.action)} uncertain={failure !== null && isUncertain(failure)} onCancel={() => { setFailure(null); setNotice(null); setStep({ kind: "start" }); }} onClose={onDone} onConfirm={() => void send(step.action)}>
            {notice ? <p className="form-error" role="alert">{notice}</p> : null}
            {failure ? <><p className="form-error" role="alert">{failure.message ?? (step.action === "book" ? "Réservation impossible." : "Déverrouillage impossible.")}</p>{isUncertain(failure) ? <p className="uncertain-note">{step.action === "unlock" ? UNCERTAIN_UNLOCK : UNCERTAIN}</p> : null}</> : null}
          </Confirm>
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
    <RedBanner icon={ClockIcon} seconds={left} label={left != null ? `Vélo réservé, ${Math.ceil(left / 60)} min restantes` : "Vélo réservé"}>
      {place ? <OnRedPill icon={LockOpenIcon} onClick={onUnlock}>Déverrouiller</OnRedPill> : null}
    </RedBanner>
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
      <BikeActions place={place} booking={booking} initial="unlock" dialog onDone={onClose}/>
    </Modal>
  );
}
