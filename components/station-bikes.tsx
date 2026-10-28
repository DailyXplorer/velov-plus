"use client";

import { type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import type { Icon } from "@phosphor-icons/react";
import { PersonSimpleBikeIcon as BicycleIcon } from "@phosphor-icons/react/dist/csr/PersonSimpleBike";
import { LightningIcon } from "@phosphor-icons/react/dist/csr/Lightning";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { BatteryEmptyIcon } from "@phosphor-icons/react/dist/csr/BatteryEmpty";
import { BatteryFullIcon } from "@phosphor-icons/react/dist/csr/BatteryFull";
import { BatteryHighIcon } from "@phosphor-icons/react/dist/csr/BatteryHigh";
import { BatteryLowIcon } from "@phosphor-icons/react/dist/csr/BatteryLow";
import { BatteryMediumIcon } from "@phosphor-icons/react/dist/csr/BatteryMedium";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { StarIcon } from "@phosphor-icons/react/dist/csr/Star";
import { StarHalfIcon } from "@phosphor-icons/react/dist/csr/StarHalf";
import { ThumbsDownIcon } from "@phosphor-icons/react/dist/csr/ThumbsDown";
import { ThumbsUpIcon } from "@phosphor-icons/react/dist/csr/ThumbsUp";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { type AssessedBike, assessBikes, isCheckOverdue } from "@/lib/bike-score";
import { type Bike, type Resource, type Station, bikeSchema, formatDate } from "@/lib/models";
import { Button, EmptyState, Eyebrow, Modal } from "./ui";
import { BikeActions, BookingsContext } from "./bike-actions";
import { getJson } from "./get-json";

const unavailable = "Les vélos de cette station sont momentanément indisponibles.";
const missing = "Ce vélo est momentanément indisponible.";
const types: Record<Bike["type"], { label: string; icon: Icon }> = {
  mechanical: { label: "Mécanique", icon: BicycleIcon },
  electrical: { label: "Électrique", icon: LightningIcon },
  other: { label: "Vélo’v", icon: BicycleIcon }
};
const relative = new Intl.RelativeTimeFormat("fr-FR", { style: "short" });
const steps: [Intl.RelativeTimeFormatUnit, number][] = [["minute", 60], ["hour", 24], ["day", 30], ["month", 12], ["year", Infinity]];

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

/** Keeps only the newest load: a new one or unmounting aborts the one before, whose answer is then dropped. */
function useLatestLoad<T>(load: (signal: AbortSignal) => Promise<T>, done: (result: Settled<T>) => void) {
  const [refreshing, setRefreshing] = useState(false);
  const current = useRef<AbortController | null>(null);
  const run = useCallback(async () => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    setRefreshing(true);
    try {
      const value = await load(controller.signal);
      if (!controller.signal.aborted) done({ ok: true, value });
    } catch (error) {
      if (!controller.signal.aborted) done({ ok: false, error });
    } finally {
      if (current.current === controller) { current.current = null; setRefreshing(false); }
    }
  }, [load, done]);
  useEffect(() => () => current.current?.abort(), []);
  return { run, refreshing };
}

/** Numbers of the bikes this account has booked: its own booking is no reason to avoid a bike. */
function useOwnBikes() {
  const bookings = useContext(BookingsContext)?.bookings;
  return useMemo(() => new Set(bookings?.flatMap((booking) => booking.bikeNumber != null ? [booking.bikeNumber] : [])), [bookings]);
}

function assessForAccount(bikes: Bike[], own: Set<number>) {
  return assessBikes(bikes.map((bike) => own.has(bike.number) ? { ...bike, isReserved: false } : bike));
}

function score(bike: Bike) {
  return bike.rating ? bike.rating.value / 20 : null;
}

function formatScore(value: number) {
  return value.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Relative to now, in the past ("il y a 3 h") or the future ("dans 2 j"). */
function fromNow(value: string | null) {
  if (!value) return null;
  const minutes = (new Date(value).getTime() - Date.now()) / 60_000;
  if (!Number.isFinite(minutes)) return null;
  let amount = Math.abs(minutes);
  if (amount < 1) return "à l’instant";
  for (const [unit, size] of steps) {
    if (amount < size) return relative.format(Math.sign(minutes) * Math.floor(amount), unit);
    amount /= size;
  }
  return null;
}

function BatteryLevel({ percent }: { percent: number }) {
  const Level = percent >= 90 ? BatteryFullIcon : percent >= 60 ? BatteryHighIcon : percent >= 30 ? BatteryMediumIcon : percent >= 10 ? BatteryLowIcon : BatteryEmptyIcon;
  return <span className="bike-battery"><Level size={18} weight="light" aria-hidden="true"/><span className="sr-only">Batterie </span>{percent} %</span>;
}

function Stars({ value }: { value: number }) {
  return (
    <span className="bike-stars" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((star) => value >= star - .25 ? <StarIcon key={star} size={16} weight="fill"/>
        : value >= star - .75 ? <StarHalfIcon key={star} size={16} weight="fill"/> : <StarIcon key={star} size={16} weight="light"/>)}
    </span>
  );
}

function BikeRow({ item, mine, onOpen }: { item: AssessedBike; mine: boolean; onOpen: () => void }) {
  const { bike, verdict } = item;
  const type = types[bike.type];
  const rating = score(bike);
  return (
    <li>
      <button className={verdict === "avoid" ? "bike-row bike-row-avoid" : "bike-row"} data-bike={bike.number} onClick={onOpen}>
        <span className="trip-icon"><type.icon size={bike.type === "electrical" ? 18 : 20} weight="light" aria-hidden="true"/></span>
        <span className="bike-row-main">
          <strong className="bike-number"><span className="sr-only">Vélo {type.label.toLowerCase()} </span>{bike.number}</strong>
          <span className="bike-meta">{bike.standNumber != null ? `Borne ${bike.standNumber}` : "Borne inconnue"}{bike.isReserved || mine ? <span className="bike-reserved">Réservé</span> : null}</span>
          {verdict === "recommended" ? (
            <span className="bike-verdict"><span className="card-tag bike-pick"><span className="card-tag-icon"><ThumbsUpIcon size={11} weight="bold" aria-hidden="true"/></span>Recommandé</span></span>
          ) : verdict === "avoid" ? <span className="sr-only">À éviter</span> : null}
        </span>
        <span className="bike-row-facts">
          {rating != null ? <span className="bike-score"><StarIcon size={15} weight="fill" aria-hidden="true"/><span className="sr-only">Note </span>{formatScore(rating)}<span className="sr-only"> sur 5</span></span> : null}
          {bike.batteryPercent != null ? <BatteryLevel percent={bike.batteryPercent}/> : null}
        </span>
        <CaretRightIcon className="trip-arrow" size={16} weight="light" aria-hidden="true"/>
      </button>
    </li>
  );
}

function DateFact({ label, value, withAgo = false, children }: { label: string; value: string | null; withAgo?: boolean; children?: ReactNode }) {
  const since = withAgo ? fromNow(value) : null;
  const exact = formatDate(value, { day: "numeric", month: "short", year: "numeric", ...(withAgo ? { hour: "2-digit", minute: "2-digit" } : {}) });
  return <div><dt>{label}</dt><dd>{children}{value ? since ? <>{since}<small>{exact}</small></> : exact : "Non renseigné"}</dd></div>;
}

function VerdictBanner({ verdict, reasons }: AssessedBike) {
  if (verdict === "neutral") return null;
  const recommended = verdict === "recommended";
  const VerdictIcon = recommended ? ThumbsUpIcon : ThumbsDownIcon;
  return (
    <section className={recommended ? "bike-banner bike-banner-pick" : "bike-banner"} aria-label={recommended ? "Vélo recommandé" : "Vélo à éviter"}>
      <span className="card-tag-icon"><VerdictIcon size={15} weight="bold" aria-hidden="true"/></span>
      <div>
        <strong>{recommended ? "Recommandé" : "À éviter"}</strong>
        <ul>{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
      </div>
    </section>
  );
}

/** Offered on a bike hooked to a borne and free, or booked by this account (a reserved bike stays AVAILABLE, § 5.2). */
function StationActions({ bike, station }: { bike: Bike; station: Station }) {
  const account = useContext(BookingsContext);
  if (!account) return <p className="bike-action-signin">Connectez-vous pour réserver ou déverrouiller</p>;
  const booking = account.bookings.find((item) => item.bikeNumber === bike.number) ?? null;
  if (bike.status !== "AVAILABLE" || bike.standNumber == null || (bike.isReserved && !booking)) return null;
  return <BikeActions place={{ stationNumber: station.number, stationName: station.name, standNumber: bike.standNumber, bikeNumber: bike.number, lat: station.lat, lon: station.lon }} booking={booking}/>;
}

function BikeSheet({ item, station }: { item: AssessedBike; station?: Station }) {
  const { bike } = item;
  const type = types[bike.type];
  const rating = score(bike);
  // Booked by this account: the booking block says it all, no verdict and no second "Réservé".
  const mine = useOwnBikes().has(bike.number);
  return (
    <div className="bike-sheet">
      {mine ? null : <VerdictBanner {...item}/>}
      <div className="detail-type"><Eyebrow icon={type.icon}>{type.label}</Eyebrow>{bike.isReserved && !mine ? <span className="bike-reserved">Réservé</span> : null}</div>
      {bike.status !== "AVAILABLE" ? <p className="bike-sheet-status">{bike.statusLabel ?? "Statut inconnu"}</p> : null}
      {station ? <StationActions bike={bike} station={station}/> : null}
      <dl className="account-details bike-details">
        <div><dt>Note</dt><dd>{bike.rating && rating != null ? (
          <><span className="bike-rating"><Stars value={rating}/>{formatScore(rating)}<span className="bike-out-of">/5</span></span><small>{bike.rating.count} avis{fromNow(bike.rating.lastAt) ? ` · le dernier ${fromNow(bike.rating.lastAt)}` : ""}</small></>
        ) : "Pas encore d’avis"}</dd></div>
        {bike.type === "electrical" ? <div><dt>Batterie</dt><dd>{bike.batteryPercent != null ? <BatteryLevel percent={bike.batteryPercent}/> : "Non renseigné"}</dd></div> : null}
        <DateFact label="Dernier trajet" value={bike.lastTripAt} withAgo/>
        <DateFact label="Prochain contrôle" value={bike.nextCheckAt} withAgo>{isCheckOverdue(bike) ? <span className="bike-reserved">En retard</span> : null}</DateFact>
        <div><dt>Borne</dt><dd>{bike.standNumber ?? "Non renseigné"}</dd></div>
      </dl>
      <details className="bike-more">
        <summary>Détails<CaretDownIcon size={14} weight="bold" aria-hidden="true"/></summary>
        <dl className="account-details bike-details">
          <DateFact label="Dernier contrôle" value={bike.lastControlAt} withAgo/>
          <DateFact label="Dernier signal" value={bike.lastSignalAt} withAgo/>
          <DateFact label="Prochaine révision" value={bike.nextReviewAt}/>
          <div><dt>Cadre</dt><dd className="bike-frame">{bike.frameId ?? "Non renseigné"}</dd></div>
        </dl>
      </details>
    </div>
  );
}

export function StationBikes({ station, onClose }: { station: Station; onClose: () => void }) {
  const [bikes, setBikes] = useState<Resource<Bike[]>>({ kind: "loading" });
  const [selected, setSelected] = useState<number | null>(null);
  const own = useOwnBikes();
  const returnTo = useRef<number | null>(null);
  const list = useRef<HTMLUListElement>(null);

  const { run: load, refreshing } = useLatestLoad(
    useCallback((signal: AbortSignal) => getJson(`/api/stations/${station.number}/bikes`, z.array(bikeSchema), unavailable, signal), [station.number]),
    useCallback((result: Settled<Bike[]>) => setBikes(result.ok ? { kind: "ready", data: result.value }
      : { kind: "error", message: result.error instanceof Error && result.error.message ? result.error.message : unavailable }), [])
  );

  useEffect(() => { void load(); }, [load]);

  // Back from a bike sheet, keyboard focus returns to that bike's row.
  useEffect(() => {
    if (selected !== null || returnTo.current === null) return;
    list.current?.querySelector<HTMLElement>(`[data-bike="${returnTo.current}"]`)?.focus();
    returnTo.current = null;
  }, [selected]);

  const assessed = useMemo(() => bikes.kind === "ready" ? assessForAccount(bikes.data, own) : null, [bikes, own]);
  const opened = assessed && selected !== null ? assessed.find((item) => item.bike.number === selected) : undefined;
  const count = assessed ? assessed.length : null;

  function back() {
    returnTo.current = selected;
    setSelected(null);
  }

  return (
    <Modal titleId="station-bikes-title" onClose={onClose} className="bikes-drawer">
      <div className="bikes-header">
        {opened ? (
          <>
            <button className="icon-button" onClick={back} aria-label="Retour à la liste des vélos" autoFocus><ArrowLeftIcon size={20} weight="light"/></button>
            <h2 id="station-bikes-title" className="bikes-title"><span className="sr-only">Vélo </span><span className="bike-sheet-number">{opened.bike.number}</span></h2>
          </>
        ) : (
          <h2 id="station-bikes-title" className="bikes-title">{station.name}</h2>
        )}
        <div className="bikes-actions">
          {!opened ? <button className="icon-button" onClick={() => void load()} disabled={refreshing} aria-label="Actualiser les vélos" title="Actualiser"><ArrowClockwiseIcon size={19} weight="light" className={refreshing ? "spin" : undefined}/></button> : null}
          <button className="icon-button" onClick={onClose} aria-label="Fermer"><XIcon size={20} weight="light"/></button>
        </div>
      </div>
      {opened ? <BikeSheet item={opened} station={station}/> : (
        <>
          <p className="result-count bikes-count" role="status">{count === null ? "Chargement des vélos…" : `${count} vélo${count > 1 ? "s" : ""} à la station`}</p>
          {bikes.kind === "loading" ? (
            <div className="bikes-skeleton" aria-busy="true" aria-label="Chargement des vélos">{[0, 1, 2, 3].map((item) => <div className="skeleton" key={item}/>)}</div>
          ) : bikes.kind === "error" ? (
            <div className="notice-error" role="alert">{bikes.message}<Button variant="secondary" onClick={() => void load()} pending={refreshing}>Réessayer</Button></div>
          ) : assessed?.length ? (
            <ul className="bikes-list" ref={list} aria-label={`Vélos à ${station.name}`}>
              {assessed.map((item) => <BikeRow key={item.bike.number} item={item} mine={own.has(item.bike.number)} onOpen={() => setSelected(item.bike.number)}/>)}
            </ul>
          ) : <EmptyState>Aucun vélo à cette station.</EmptyState>}
        </>
      )}
    </Modal>
  );
}

/** One bike's live sheet, opened on its own (from a trip). */
export function BikeDrawer({ number, onClose }: { number: number; onClose: () => void }) {
  const [bike, setBike] = useState<Resource<Bike>>({ kind: "loading" });
  const own = useOwnBikes();

  const { run: load, refreshing } = useLatestLoad(
    useCallback((signal: AbortSignal) => getJson(`/api/bikes/${number}`, bikeSchema, missing, signal), [number]),
    useCallback((result: Settled<Bike>) => {
      setBike(result.ok ? { kind: "ready", data: result.value } : { kind: "error", message: result.error instanceof Error && result.error.message ? result.error.message : missing });
    }, [])
  );
  const item = useMemo(() => {
    if (bike.kind !== "ready") return null;
    const assessed = assessForAccount([bike.data], own)[0];
    // Alone, a bike is no station's best pick: keep only the warnings.
    return assessed.verdict === "recommended" ? { ...assessed, verdict: "neutral" as const, reasons: [] } : assessed;
  }, [bike, own]);

  useEffect(() => { void load(); }, [load]);

  return (
    <Modal titleId="bike-drawer-title" onClose={onClose} className="bikes-drawer">
      <div className="bikes-header">
        <button className="icon-button" onClick={onClose} aria-label="Retour au trajet" autoFocus><ArrowLeftIcon size={20} weight="light"/></button>
        <h2 id="bike-drawer-title" className="bikes-title"><span className="sr-only">Vélo </span><span className="bike-sheet-number">{number}</span></h2>
      </div>
      {bike.kind === "loading" ? (
        <div className="bikes-skeleton" aria-busy="true" aria-label="Chargement du vélo">{[0, 1, 2].map((item) => <div className="skeleton" key={item}/>)}</div>
      ) : bike.kind === "error" ? (
        <div className="notice-error" role="alert">{bike.message}<Button variant="secondary" onClick={() => void load()} pending={refreshing}>Réessayer</Button></div>
      ) : item ? <BikeSheet item={item}/> : null}
    </Modal>
  );
}
