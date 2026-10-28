"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { StarIcon } from "@phosphor-icons/react/dist/csr/Star";
import { StarHalfIcon } from "@phosphor-icons/react/dist/csr/StarHalf";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { type Bike, type Resource, type Station, bikeSchema, formatDate } from "@/lib/models";
import { Button, EmptyState, Eyebrow, Modal } from "./ui";

const errorSchema = z.object({ error: z.string() });
const unavailable = "Les vélos de cette station sont momentanément indisponibles.";
const types: Record<Bike["type"], { label: string; icon: Icon }> = {
  mechanical: { label: "Mécanique", icon: BicycleIcon },
  electrical: { label: "Électrique", icon: LightningIcon },
  other: { label: "Vélo’v", icon: BicycleIcon }
};
const relative = new Intl.RelativeTimeFormat("fr-FR", { style: "short" });
const steps: [Intl.RelativeTimeFormatUnit, number][] = [["minute", 60], ["hour", 24], ["day", 30], ["month", 12], ["year", Infinity]];

function score(bike: Bike) {
  return bike.rating ? bike.rating.value / 20 : null;
}

function formatScore(value: number) {
  return value.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function ago(value: string | null) {
  if (!value) return null;
  let amount = (Date.now() - new Date(value).getTime()) / 60_000;
  if (!Number.isFinite(amount)) return null;
  if (amount < 1) return "à l’instant";
  for (const [unit, size] of steps) {
    if (amount < size) return relative.format(-Math.floor(amount), unit);
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

function BikeRow({ bike, onOpen }: { bike: Bike; onOpen: () => void }) {
  const type = types[bike.type];
  const rating = score(bike);
  return (
    <li>
      <button className="bike-row" data-bike={bike.number} onClick={onOpen}>
        <span className="trip-icon"><type.icon size={bike.type === "electrical" ? 18 : 20} weight="light" aria-hidden="true"/></span>
        <span className="bike-row-main">
          <strong className="bike-number"><span className="sr-only">Vélo {type.label.toLowerCase()} </span>{bike.number}</strong>
          <span className="bike-meta">{bike.standNumber != null ? `Borne ${bike.standNumber}` : "Borne inconnue"}{bike.isReserved ? <span className="bike-reserved">Réservé</span> : null}</span>
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

function DateFact({ label, value, withAgo = false }: { label: string; value: string | null; withAgo?: boolean }) {
  const since = withAgo ? ago(value) : null;
  const exact = formatDate(value, { day: "numeric", month: "short", year: "numeric", ...(withAgo ? { hour: "2-digit", minute: "2-digit" } : {}) });
  return <div><dt>{label}</dt><dd>{value ? since ? <>{since}<small>{exact}</small></> : exact : "Non renseigné"}</dd></div>;
}

function BikeSheet({ bike }: { bike: Bike }) {
  const type = types[bike.type];
  const rating = score(bike);
  return (
    <div className="bike-sheet">
      <div className="detail-type"><Eyebrow icon={type.icon}>{type.label}</Eyebrow>{bike.isReserved ? <span className="bike-reserved">Réservé</span> : null}</div>
      <p className="bike-sheet-status">{bike.statusLabel ?? "Statut inconnu"}</p>
      <div className="trip-detail-facts bike-facts">
        <span><small>Note</small><strong>{rating != null ? <>{formatScore(rating)}<span className="bike-out-of">/5</span></> : "–"}</strong></span>
        <span><small>Borne</small><strong>{bike.standNumber ?? "–"}</strong></span>
        {bike.type === "electrical" ? <span><small>Batterie</small><strong>{bike.batteryPercent != null ? `${bike.batteryPercent} %` : "–"}</strong></span> : null}
      </div>
      {bike.rating && rating != null ? (
        <p className="bike-rating"><Stars value={rating}/><span className="sr-only">{formatScore(rating)} sur 5, </span>{bike.rating.count} avis{bike.rating.lastAt ? ` · le dernier ${ago(bike.rating.lastAt) ?? ""}` : ""}</p>
      ) : <p className="bike-rating">Pas encore d’avis</p>}
      <dl className="account-details bike-details">
        <DateFact label="Dernier trajet" value={bike.lastTripAt} withAgo/>
        <DateFact label="Dernier contrôle" value={bike.lastControlAt} withAgo/>
        <DateFact label="Dernière révision" value={bike.lastRevisionAt}/>
        <DateFact label="Prochaine révision" value={bike.nextReviewAt}/>
        <div><dt>En service depuis</dt><dd>{bike.createdAt ? formatDate(bike.createdAt, { year: "numeric" }) : "Non renseigné"}</dd></div>
        <div><dt>Cadre</dt><dd className="bike-frame">{bike.frameId ?? "Non renseigné"}</dd></div>
      </dl>
    </div>
  );
}

export function StationBikes({ station, onClose }: { station: Station; onClose: () => void }) {
  const [bikes, setBikes] = useState<Resource<Bike[]>>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const returnTo = useRef<number | null>(null);
  const list = useRef<HTMLUListElement>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch(`/api/stations/${station.number}/bikes`, { cache: "no-store" });
      const raw: unknown = await response.json();
      if (!response.ok) {
        const error = errorSchema.safeParse(raw);
        throw new Error(error.success ? error.data.error : unavailable);
      }
      const parsed = z.array(bikeSchema).safeParse(raw);
      if (!parsed.success) throw new Error(unavailable);
      setBikes({ kind: "ready", data: parsed.data });
    } catch (error) {
      setBikes({ kind: "error", message: error instanceof Error && error.message ? error.message : unavailable });
    } finally {
      setRefreshing(false);
    }
  }, [station.number]);

  useEffect(() => { void load(); }, [load]);

  // Back from a bike sheet, keyboard focus returns to that bike's row.
  useEffect(() => {
    if (selected !== null || returnTo.current === null) return;
    list.current?.querySelector<HTMLElement>(`[data-bike="${returnTo.current}"]`)?.focus();
    returnTo.current = null;
  }, [selected]);

  const bike = bikes.kind === "ready" && selected !== null ? bikes.data.find((item) => item.number === selected) : undefined;
  const count = bikes.kind === "ready" ? bikes.data.length : null;

  function back() {
    returnTo.current = selected;
    setSelected(null);
  }

  return (
    <Modal titleId="station-bikes-title" onClose={onClose} className="bikes-drawer">
      <div className="bikes-header">
        {bike ? (
          <>
            <button className="icon-button" onClick={back} aria-label="Retour à la liste des vélos" autoFocus><ArrowLeftIcon size={20} weight="light"/></button>
            <h2 id="station-bikes-title" className="bikes-title"><span className="sr-only">Vélo </span><span className="bike-sheet-number">{bike.number}</span></h2>
          </>
        ) : (
          <h2 id="station-bikes-title" className="bikes-title">{station.name}</h2>
        )}
        <div className="bikes-actions">
          {!bike ? <button className="icon-button" onClick={() => void load()} disabled={refreshing} aria-label="Actualiser les vélos" title="Actualiser"><ArrowClockwiseIcon size={19} weight="light" className={refreshing ? "spin" : undefined}/></button> : null}
          <button className="icon-button" onClick={onClose} aria-label="Fermer"><XIcon size={20} weight="light"/></button>
        </div>
      </div>
      {bike ? <BikeSheet bike={bike}/> : (
        <>
          <p className="result-count bikes-count" role="status">{count === null ? "Chargement des vélos…" : `${count} vélo${count > 1 ? "s" : ""} à la station`}</p>
          {bikes.kind === "loading" ? (
            <div className="bikes-skeleton" aria-busy="true" aria-label="Chargement des vélos">{[0, 1, 2, 3].map((item) => <div className="skeleton" key={item}/>)}</div>
          ) : bikes.kind === "error" ? (
            <div className="notice-error" role="alert">{bikes.message}<Button variant="secondary" onClick={() => void load()} pending={refreshing}>Réessayer</Button></div>
          ) : bikes.data.length ? (
            <ul className="bikes-list" ref={list} aria-label={`Vélos à ${station.name}`}>
              {bikes.data.map((item) => <BikeRow key={item.number} bike={item} onOpen={() => setSelected(item.number)}/>)}
            </ul>
          ) : <EmptyState>Aucun vélo à cette station.</EmptyState>}
        </>
      )}
    </Modal>
  );
}
