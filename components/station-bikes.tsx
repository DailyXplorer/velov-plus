"use client";

import { type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { ArrowClockwiseIcon, ArrowLeftIcon, BatteryEmptyIcon, BatteryFullIcon, BatteryHighIcon, BatteryLowIcon, BatteryMediumIcon, BicycleIcon, CaretDownIcon, CaretRightIcon, type Icon, LightningIcon, SignInIcon, StarHalfIcon, StarIcon, ThumbsUpIcon, WarningIcon, XIcon } from "./icons";
import { type AssessedBike, assessBikes, isCheckOverdue } from "@/lib/bike-score";
import { type Bike, type Resource, type Station, bikeSchema, capitalize, formatCountSans, formatDate } from "@/lib/models";
import { EmptyState, Eyebrow, Ghost, LoadFailure, Modal } from "./ui";
import { BikeActions, BookingsContext, SignInContext } from "./bike-actions";
import { useSending } from "./operations";
import { getJson, loadError } from "./get-json";
import { toaster } from "@/lib/toast";

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
  return <span className="bike-battery"><Level size={18} weight="light" aria-hidden="true"/><span className="sr-only">Batterie </span>{percent} %</span>;
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
  return <div><dt>{label}</dt><dd>{children}{value ? since ? <>{capitalize(since)}<small>{exact}</small></> : exact : "Non renseigné"}</dd></div>;
}

function VerdictMark({ verdict }: { verdict: AssessedBike["verdict"] }) {
  if (verdict === "neutral") return null;
  const recommended = verdict === "recommended";
  const MarkIcon = recommended ? ThumbsUpIcon : WarningIcon;
  const label = recommended ? "Recommandé" : "À éviter";
  return <span className={recommended ? "verdict-mark" : "verdict-mark verdict-mark-avoid"} role="img" aria-label={label} title={label}><MarkIcon size={18} weight="bold" aria-hidden="true"/></span>;
}

function StationActions({ bike, station, onDone }: { bike: Bike; station: Station; onDone: () => void }) {
  const account = useContext(BookingsContext);
  const signIn = useContext(SignInContext);
  if (!account) return signIn ? <button className="text-button bike-signin" onClick={signIn}><SignInIcon size={18} weight="light" aria-hidden="true"/>Se connecter pour réserver ou déverrouiller</button> : null;
  const booking = account.bookings.find((item) => item.bikeNumber === bike.number) ?? null;
  if (bike.status !== "AVAILABLE" || bike.standNumber == null || (bike.isReserved && !booking)) return null;
  return <BikeActions place={{ stationNumber: station.number, stationName: station.name, standNumber: bike.standNumber, bikeNumber: bike.number, lat: station.lat, lon: station.lon }} booking={booking} onDone={onDone}/>;
}

function BikeSheet({ item, actions }: { item: AssessedBike; actions?: ReactNode }) {
  const { bike } = item;
  const type = types[bike.type];
  const rating = score(bike);
  const mine = useOwnBikes().has(bike.number);
  return (
    <div className="bike-sheet">
      <div className="detail-type"><Eyebrow icon={type.icon}>{type.label}</Eyebrow>{bike.isReserved && !mine ? <span className="bike-reserved">Réservé</span> : null}</div>
      {bike.status !== "AVAILABLE" ? <p className="bike-sheet-status">{bike.statusLabel ?? "Statut inconnu"}</p> : null}
      {actions}
      <dl className="account-details bike-details">
        <div><dt>Note</dt><dd>{bike.rating && rating != null ? (
          <><span className="bike-rating"><Stars value={rating}/><span>{formatScore(rating)}<span className="bike-out-of">/5</span></span></span><small>{formatCountSans(bike.rating.count)} avis{fromNow(bike.rating.lastAt) ? ` · Dernier avis ${fromNow(bike.rating.lastAt)}` : ""}</small></>
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

function BikesSkeleton({ station }: { station: Station }) {
  const count = station.mechanical + station.electrical;
  const picks = Number(station.mechanical > 0) + Number(station.electrical > 0);
  if (!count) return <EmptyState><Ghost>Aucun vélo à cette station.</Ghost></EmptyState>;
  return (
    <ul className="bikes-list" aria-busy="true" aria-label="Chargement des vélos">
      {Array.from({ length: count }, (_, index) => (
        <li key={index}>
          <div className="bike-row">
            <span className="trip-icon skeleton"/>
            <span className="bike-row-main"><strong className="bike-number"><Ghost>{12000 + index * 731}</Ghost></strong><span className="bike-meta"><Ghost>Borne {index + 1}</Ghost></span>
              {index < picks ? <span className="bike-verdict"><span className="card-tag bike-pick skeleton"><span className="card-tag-icon"/>Recommandé</span></span> : null}
            </span>
            <span className="bike-row-facts"><Ghost>4,5</Ghost></span>
            <span/>
          </div>
        </li>
      ))}
    </ul>
  );
}

function BikeSheetSkeleton() {
  const twoLines = <><Ghost>Il y a 2 h</Ghost><small><Ghost>12 oct. 2026, 08:42</Ghost></small></>;
  return (
    <div className="bike-sheet" aria-busy="true" aria-label="Chargement du vélo">
      <div className="detail-type"><span className="eyebrow skeleton" aria-hidden="true"><span className="eyebrow-icon"/>Mécanique</span></div>
      <dl className="account-details bike-details">
        <div><dt>Note</dt><dd><span className="bike-rating skeleton-text" aria-hidden="true"><Stars value={4.5}/><span>4,5<span className="bike-out-of">/5</span></span></span><small><Ghost>12 avis · Dernier avis il y a 3 j</Ghost></small></dd></div>
        <div><dt>Dernier trajet</dt><dd>{twoLines}</dd></div>
        <div><dt>Prochain contrôle</dt><dd>{twoLines}</dd></div>
        <div><dt>Borne</dt><dd><Ghost>12</Ghost></dd></div>
      </dl>
      <details className="bike-more" inert><summary>Détails<CaretDownIcon size={14} weight="bold" aria-hidden="true"/></summary></details>
    </div>
  );
}

export function StationBikes({ station, onClose }: { station: Station; onClose: () => void }) {
  const [bikes, setBikes] = useState<Resource<Bike[]>>({ kind: "loading" });
  const [selected, setSelected] = useState<number | null>(null);
  const own = useOwnBikes();
  const returnTo = useRef<number | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const sending = useSending();
  const shown = useRef(false);

  const { run: load, refreshing } = useLatestLoad(
    useCallback((signal: AbortSignal) => getJson(`/api/stations/${station.number}/bikes`, z.array(bikeSchema), unavailable, signal), [station.number]),
    useCallback((result: Settled<Bike[]>) => {
      if (result.ok) { shown.current = true; setBikes({ kind: "ready", data: result.value }); return; }
      const failure = loadError(result.error, unavailable);
      if (shown.current) toaster.show(failure.message);
      else setBikes({ kind: "error", ...failure });
    }, [])
  );

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (selected !== null || returnTo.current === null) return;
    list.current?.querySelector<HTMLElement>(`[data-bike="${returnTo.current}"]`)?.focus();
    returnTo.current = null;
  }, [selected]);

  const assessed = useMemo(() => bikes.kind === "ready" ? assessForAccount(bikes.data, own) : null, [bikes, own]);
  const opened = assessed && selected !== null ? assessed.find((item) => item.bike.number === selected) : undefined;
  const count = assessed ? assessed.length : null;

  function back() {
    if (sending) return;
    returnTo.current = selected;
    setSelected(null);
  }

  return (
    <Modal titleId="station-bikes-title" onClose={sending ? () => {} : onClose} className="bikes-drawer">
      <div className="bikes-header">
        {opened ? (
          <>
            <button className="icon-button" onClick={back} disabled={sending} aria-label="Retour à la liste des vélos" autoFocus><ArrowLeftIcon size={20} weight="light"/></button>
            <h2 id="station-bikes-title" className="bikes-title"><span className="sr-only">Vélo </span><span className="bike-sheet-number">{opened.bike.number}</span>{own.has(opened.bike.number) ? null : <VerdictMark verdict={opened.verdict}/>}</h2>
          </>
        ) : (
          <h2 id="station-bikes-title" className="bikes-title">{station.name}</h2>
        )}
        <div className="bikes-actions">
          {!opened ? <button className="icon-button" onClick={() => void load()} disabled={refreshing} aria-label="Actualiser les vélos" title="Actualiser"><ArrowClockwiseIcon size={19} weight="light" className={refreshing ? "spin" : undefined}/></button> : null}
          <button className="icon-button" onClick={onClose} disabled={sending} aria-label="Fermer"><XIcon size={20} weight="light"/></button>
        </div>
      </div>
      {opened ? <BikeSheet item={opened} actions={<StationActions bike={opened.bike} station={station} onDone={onClose}/>}/> : (
        <>
          <p className="result-count bikes-count" role="status">{count === null ? "Chargement des vélos…" : `${count} vélo${count > 1 ? "s" : ""} à la station`}</p>
          {bikes.kind === "loading" ? (
            <BikesSkeleton station={station}/>
          ) : bikes.kind === "error" ? (
            <LoadFailure failure={bikes} layout="inline" pending={refreshing} onRetry={() => void load()}/>
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

export function BikeDrawer({ number, onClose }: { number: number; onClose: () => void }) {
  const [bike, setBike] = useState<Resource<Bike>>({ kind: "loading" });
  const own = useOwnBikes();

  const { run: load, refreshing } = useLatestLoad(
    useCallback((signal: AbortSignal) => getJson(`/api/bikes/${number}`, bikeSchema, missing, signal), [number]),
    useCallback((result: Settled<Bike>) => {
      setBike(result.ok ? { kind: "ready", data: result.value } : { kind: "error", ...loadError(result.error, missing) });
    }, [])
  );
  const item = useMemo(() => {
    if (bike.kind !== "ready") return null;
    const assessed = assessForAccount([bike.data], own)[0];
    return assessed.verdict === "recommended" ? { ...assessed, verdict: "neutral" as const, reasons: [] } : assessed;
  }, [bike, own]);

  useEffect(() => { void load(); }, [load]);

  return (
    <Modal titleId="bike-drawer-title" onClose={onClose} className="bikes-drawer">
      <div className="bikes-header">
        <button className="icon-button" onClick={onClose} aria-label="Retour au trajet" autoFocus><ArrowLeftIcon size={20} weight="light"/></button>
        <h2 id="bike-drawer-title" className="bikes-title"><span className="sr-only">Vélo </span><span className="bike-sheet-number">{number}</span>{item && !own.has(number) ? <VerdictMark verdict={item.verdict}/> : null}</h2>
      </div>
      {bike.kind === "loading" ? (
        <BikeSheetSkeleton/>
      ) : bike.kind === "error" ? (
        <LoadFailure failure={bike} layout="inline" pending={refreshing} onRetry={() => void load()}/>
      ) : item ? <BikeSheet item={item}/> : null}
    </Modal>
  );
}
