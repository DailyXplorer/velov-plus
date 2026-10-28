"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { BicycleIcon } from "@phosphor-icons/react/dist/csr/Bicycle";
import { LightningIcon } from "@phosphor-icons/react/dist/csr/Lightning";
import { SquareIcon } from "@phosphor-icons/react/dist/csr/Square";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { NavigationArrowIcon } from "@phosphor-icons/react/dist/csr/NavigationArrow";
import { SignOutIcon } from "@phosphor-icons/react/dist/csr/SignOut";
import { StarFourIcon } from "@phosphor-icons/react/dist/csr/StarFour";
import { TicketIcon } from "@phosphor-icons/react/dist/csr/Ticket";
import { TrendUpIcon } from "@phosphor-icons/react/dist/csr/TrendUp";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { type Dashboard, type Page, type Resource, type Station, type Trip, formatDate, formatPrice } from "@/lib/models";
import { Button, CardTag, CircleArrow, EmptyState, Eyebrow, Modal, SectionHeading, SelectField, TextButton } from "./ui";

const StationMap = dynamic(() => import("./station-map"), {
  ssr: false,
  loading: () => <div className="map-placeholder" aria-label="Chargement de la carte"/>
});
type StationData = { stations: Station[]; updatedAt: string };
type Navigation = (page: Page) => void;

function BikeType({ type }: { type: Trip["bikeType"] }) {
  return (
    <Eyebrow icon={type === "electrical" ? LightningIcon : BicycleIcon}>
      {type === "electrical" ? "Électrique" : type === "mechanical" ? "Mécanique" : "Vélo’v"}
    </Eyebrow>
  );
}

export function TripsTable({ trips }: { trips: Trip[] }) {
  const [selected, setSelected] = useState<Trip | null>(null);
  return (
    <>
      <div className="trips-table">
        <div className="table-head"><span>Trajet</span><span>Date</span><span>Durée</span><span>Montant</span><span/></div>
        {trips.map((trip) => (
          <button className="trip-row" key={trip.id} onClick={() => setSelected(trip)} aria-label={`Détails du trajet du ${formatDate(trip.startedAt)}`}>
            <span className="trip-description">
              <span className="trip-icon">
                {trip.bikeType === "electrical" ? <LightningIcon size={18} weight="light" aria-label="Vélo électrique"/>
                  : <BicycleIcon size={20} weight="light" aria-label={trip.bikeType === "mechanical" ? "Vélo mécanique" : "Vélo’v"}/>}
              </span>
              <span className="trip-route">
                <strong>{trip.startStation ?? "Trajet Vélo’v"}</strong>
                <small>{trip.endStation ?? (trip.bikeType === "electrical" ? "Électrique" : trip.bikeType === "mechanical" ? "Mécanique" : "Stations non renseignées")}</small>
              </span>
            </span>
            <span className="trip-date">{formatDate(trip.startedAt)}<small>{formatDate(trip.startedAt, { hour: "2-digit", minute: "2-digit" })}</small></span>
            <span className="trip-duration">{trip.duration} min</span>
            <span className="trip-price">{formatPrice(trip.price)}</span>
            <CaretRightIcon className="trip-arrow" size={16} weight="light"/>
          </button>
        ))}
        {!trips.length ? <EmptyState>Aucun trajet.</EmptyState> : null}
      </div>
      {selected ? (
        <Modal titleId="trip-detail-title" onClose={() => setSelected(null)}>
          <div className="modal-heading">
            <h2 id="trip-detail-title">Trajet</h2>
            <button className="icon-button" aria-label="Fermer les détails" onClick={() => setSelected(null)}><XIcon size={20} weight="light"/></button>
          </div>
          <p className="detail-date">{formatDate(selected.startedAt, { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
          <div className="trip-detail-route">
            <div><small>Départ</small><span>{selected.startStation ?? "Non renseigné"}</span></div>
            <div><small>Arrivée</small><span>{selected.endStation ?? "Non renseignée"}</span></div>
          </div>
          <div className="trip-detail-facts">
            <span><small>Durée</small><strong>{selected.duration} min</strong></span>
            <span><small>Montant</small><strong>{formatPrice(selected.price)}</strong></span>
            <span><small>Points gagnés</small><strong>+{selected.pointsEarned}</strong></span>
          </div>
          <div className="detail-type"><BikeType type={selected.bikeType}/>{selected.bikeNumber ? <span>Vélo n° {selected.bikeNumber}</span> : null}</div>
        </Modal>
      ) : null}
    </>
  );
}

function StationNumbers({ station, compact = false }: { station: Station; compact?: boolean }) {
  return (
    <div className={`station-numbers ${compact ? "station-numbers-compact" : ""}`}>
      <span><BicycleIcon size={18} weight="light" aria-hidden="true"/><strong>{station.mechanical}</strong><small>Mécaniques</small></span>
      <span><LightningIcon size={17} weight="light" aria-hidden="true"/><strong>{station.electrical}</strong><small>Électriques</small></span>
      <span><SquareIcon size={16} weight="light" aria-hidden="true"/><strong>{station.stands}</strong><small>Places libres</small></span>
    </div>
  );
}

export function Overview({ data, stations, navigate }: { data: Dashboard; stations: Resource<StationData>; navigate: Navigation }) {
  const [selectedStation, setSelectedStation] = useState<string | null>(null);
  const nearby = stations.kind === "ready" ? stations.data.stations : [];
  const chosen = nearby.find((station) => station.id === selectedStation) ?? nearby.find((station) => station.number === 2002) ?? nearby[0];
  const minutes = data.trips.reduce((total, trip) => total + trip.duration, 0);
  return (
    <div className="page-content">
      {data.ongoing.length ? (
        <div className="ongoing-banner"><Eyebrow icon={BicycleIcon}>Trajet en cours</Eyebrow><span>{data.ongoing[0].startStation}</span></div>
      ) : null}
      <div className="summary-grid">
        <button className="summary-card" onClick={() => navigate("points")}>
          <CardTag icon={StarFourIcon}>Points</CardTag>
          <strong className="metric-value accent">{data.rewards.balance}</strong>
          <span className="metric-detail">{data.rewards.total.toLocaleString("fr-FR")} gagnés au total<CircleArrow outline/></span>
        </button>
        <button className="summary-card" onClick={() => navigate("trips")}>
          <CardTag icon={BicycleIcon}>Trajets</CardTag>
          <strong className="metric-value">{data.trips.length}</strong>
          <span className="metric-detail">{minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`}<CircleArrow outline/></span>
        </button>
        <button className="summary-card" onClick={() => navigate("account")}>
          <CardTag icon={TicketIcon}>Abonnement</CardTag>
          <strong className="metric-subscription">{data.subscription?.title ?? "Aucun abonnement"}</strong>
          <span className="metric-detail">{data.subscription?.validUntil ? `Jusqu’au ${formatDate(data.subscription.validUntil, { day: "numeric", month: "short", year: "numeric" })}` : "Voir les formules"}<CircleArrow outline/></span>
        </button>
      </div>
      <section className="map-section">
        <SectionHeading title="Stations"><TextButton onClick={() => navigate("stations")}>Tout voir</TextButton></SectionHeading>
        <div className="overview-map">
          <StationMap stations={nearby} selected={chosen?.id ?? null} onSelect={setSelectedStation}/>
          {stations.kind === "error" ? <p className="map-error" role="status">{stations.message}</p> : null}
          {chosen ? (
            <div className="map-station-card">
              <div className="station-card-heading"><strong>{chosen.name}</strong><button className="icon-button" aria-label="Voir les stations" onClick={() => navigate("stations")}><CaretRightIcon size={18} weight="light"/></button></div>
              <StationNumbers station={chosen}/>
            </div>
          ) : null}
        </div>
      </section>
      <section className="recent-trips">
        <SectionHeading title="Derniers trajets"><TextButton onClick={() => navigate("trips")}>Tout voir</TextButton></SectionHeading>
        <TripsTable trips={data.trips.slice(0, 4)}/>
      </section>
    </div>
  );
}

export function TripsPage({ data }: { data: Dashboard }) {
  const [filter, setFilter] = useState("all");
  const [limit, setLimit] = useState(10);
  const trips = data.trips.filter((trip) => filter === "all" || trip.bikeType === filter);
  return (
    <div className="page-content">
      <div className="filter-line">
        <SelectField label="Type de vélo" value={filter} onChange={(value) => { setFilter(value); setLimit(10); }}
          options={[{ value: "all", label: "Tous" }, { value: "mechanical", label: "Mécaniques" }, { value: "electrical", label: "Électriques" }]}/>
        <span className="result-count">{trips.length} trajet{trips.length > 1 ? "s" : ""}</span>
      </div>
      <TripsTable trips={trips.slice(0, limit)}/>
      {trips.length > limit ? <div className="load-more"><Button variant="secondary" onClick={() => setLimit(limit + 10)}>Voir plus</Button></div> : null}
    </div>
  );
}

function rewardLabel(label: string) {
  return label === "Vélo évalué" ? "Évaluation" : label;
}

export function PointsPage({ data }: { data: Dashboard }) {
  const [limit, setLimit] = useState(8);
  const rules = data.rewards.rules.filter((rule) => rule.kind === "earn").slice(0, 3);
  return (
    <div className="page-content">
      <div className="points-summary">
        <div><Eyebrow icon={StarFourIcon}>Solde</Eyebrow><strong className="points-balance">{data.rewards.balance}<span>points</span></strong></div>
        <div><Eyebrow icon={TrendUpIcon}>Total gagné</Eyebrow><strong className="points-total">{data.rewards.total.toLocaleString("fr-FR")}</strong></div>
      </div>
      <div className="setting-row">
        <div><span className="metric-label">Utilisation automatique</span><strong className="setting-value">{data.rewards.autoSpend ? "Activée" : "Désactivée"}</strong></div>
        <a className="button button-secondary" href="https://velov.grandlyon.com/" target="_blank" rel="noreferrer" aria-label="Modifier l’utilisation des points sur Vélo’v">Modifier<CircleArrow external/></a>
      </div>
      {rules.length ? (
        <section className="earn-section">
          <SectionHeading title="Gagner des points"/>
          <div className="earn-grid">{rules.map((rule) => <div className="earn-rule" key={rule.name}><span>{rewardLabel(rule.label)}</span><strong>+{rule.points}</strong></div>)}</div>
        </section>
      ) : null}
      <section className="points-history">
        <SectionHeading title="Historique"/>
        {data.rewards.movements.slice(0, limit).map((movement) => (
          <div className="movement" key={movement.id}>
            <span className="movement-description"><strong>{rewardLabel(movement.label)}</strong><small>{formatDate(movement.date, { day: "numeric", month: "long", year: "numeric" })}</small></span>
            <span className={`movement-amount ${movement.amount > 0 ? "is-credit" : ""}`}>{movement.amount > 0 ? "+" : ""}{movement.amount}</span>
          </div>
        ))}
        {!data.rewards.movements.length ? <EmptyState>Aucun mouvement.</EmptyState> : null}
        {data.rewards.movements.length > limit ? <div className="load-more"><Button variant="secondary" onClick={() => setLimit(limit + 12)}>Voir plus</Button></div> : null}
      </section>
    </div>
  );
}

function distanceTo(station: Station, position: GeolocationCoordinates) {
  const radians = Math.PI / 180;
  const latitude = (station.lat - position.latitude) * radians;
  const longitude = (station.lon - position.longitude) * radians;
  const arc = Math.sin(latitude / 2) ** 2 + Math.cos(position.latitude * radians) * Math.cos(station.lat * radians) * Math.sin(longitude / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(1 - arc));
}

export function StationsPage({ resource, reload }: { resource: Resource<StationData>; reload: () => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "available" | "electrical" | "stands">("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [position, setPosition] = useState<GeolocationCoordinates | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [limit, setLimit] = useState(30);
  const stations = resource.kind === "ready" ? resource.data.stations : [];
  const filtered = useMemo(() => {
    const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    return stations.filter((station) => normalize(`${station.name} ${station.address} ${station.number}`).includes(normalize(query))
      && (filter !== "available" || station.mechanical + station.electrical > 0)
      && (filter !== "electrical" || station.electrical > 0)
      && (filter !== "stands" || station.stands > 0))
      .sort((left, right) => Number(right.open) - Number(left.open) || (position ? distanceTo(left, position) - distanceTo(right, position) : left.name.localeCompare(right.name, "fr")));
  }, [stations, query, filter, position]);
  const chosen = filtered.find((station) => station.id === selected) ?? filtered.find((station) => station.number === 2002) ?? filtered[0];

  function locate() {
    setLocationError("");
    setLocating(true);
    if (!navigator.geolocation) { setLocationError("Position indisponible."); setLocating(false); return; }
    navigator.geolocation.getCurrentPosition((result) => {
      setPosition(result.coords);
      const closest = [...stations].sort((left, right) => distanceTo(left, result.coords) - distanceTo(right, result.coords))[0];
      if (closest) setSelected(closest.id);
      setLocating(false);
    }, () => { setLocationError("Position indisponible. Recherchez une station par son nom."); setLocating(false); }, { timeout: 10_000, maximumAge: 60_000 });
  }

  return (
    <div className="page-content stations-page">
      <div className="stations-toolbar">
        <label className="search-field"><MagnifyingGlassIcon size={19} weight="light" aria-hidden="true"/>
          <input aria-label="Rechercher une station" placeholder="Rechercher une station" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(30); }}/>
          {query ? <button className="icon-button" aria-label="Effacer la recherche" onClick={() => setQuery("")}><XIcon size={16} weight="light"/></button> : null}
        </label>
        <Button variant="secondary" pending={locating} onClick={locate} aria-label="Stations autour de moi" title="Autour de moi"><NavigationArrowIcon size={18} weight="light"/><span className="location-label">Autour de moi</span></Button>
      </div>
      {locationError ? <p className="inline-notice" role="status">{locationError}</p> : null}
      <div className="filter-line">
        <SelectField label="Afficher" value={filter} onChange={(value) => { setFilter(value); setLimit(30); }}
          options={[{ value: "all", label: "Toutes les stations" }, { value: "available", label: "Vélos disponibles" }, { value: "electrical", label: "Vélos électriques" }, { value: "stands", label: "Places libres" }]}/>
        <span className="result-count">{filtered.length} stations</span>
      </div>
      {resource.kind === "error" ? <div className="notice-error" role="status">{resource.message}<Button variant="secondary" onClick={reload}>Réessayer</Button></div> : null}
      <div className="stations-explorer">
        <div className="stations-list">
          {resource.kind === "loading" ? <p className="empty-state">Chargement…</p> : filtered.slice(0, limit).map((station) => (
            <button className={`station-item ${chosen?.id === station.id ? "selected" : ""}`} key={station.id} onClick={() => setSelected(station.id)}>
              <div className="station-item-title"><strong>{station.name}</strong><CaretRightIcon size={16} weight="light"/></div>
              <small className="station-meta">{position ? `${Math.round(distanceTo(station, position) / 10) * 10} m · ` : ""}n° {station.number}{!station.open ? " · Fermée" : ""}</small>
              <StationNumbers station={station} compact/>
            </button>
          ))}
          {resource.kind === "ready" && !filtered.length ? <EmptyState>Aucune station trouvée.</EmptyState> : null}
          {filtered.length > limit ? <div className="load-more"><TextButton onClick={() => setLimit(limit + 30)}>Voir plus</TextButton></div> : null}
        </div>
        <div className="explorer-map">
          <StationMap stations={filtered} selected={chosen?.id ?? null} onSelect={setSelected}/>
          {chosen ? (
            <div className="selected-station-panel">
              <div className="station-card-heading"><h2>{chosen.name}</h2>{!chosen.open ? <span className="closed-station">Fermée</span> : null}</div>
              <StationNumbers station={chosen}/>
              <a className="button button-primary" href={`https://www.google.com/maps/dir/?api=1&destination=${chosen.lat},${chosen.lon}&travelmode=walking`} target="_blank" rel="noreferrer">Itinéraire<CircleArrow external/></a>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function AccountPage({ data, onLogout }: { data: Dashboard; onLogout: () => void }) {
  return (
    <div className="page-content">
      <div className="account-grid">
        <section className="account-section">
          <h2>Profil</h2>
          <p className="profile-name">{[data.profile.firstName, data.profile.lastName].filter(Boolean).join(" ") || "Compte Vélo’v"}</p>
          <p className="profile-email">{data.profile.email}</p>
          <dl className="account-details">
            <div><dt>Compte</dt><dd>{data.profile.locked ? "À vérifier" : "Actif"}</dd></div>
            <div><dt>Profil</dt><dd>{data.profile.complete ? "Complet" : "À compléter"}</dd></div>
            <div><dt>Paiement</dt><dd>{data.paymentValid ? "Valide" : "À vérifier"}</dd></div>
          </dl>
          <a className="text-link" href="https://velov.grandlyon.com/" target="_blank" rel="noreferrer">Gérer sur Vélo’v<CircleArrow external outline/></a>
        </section>
        <section className="account-section">
          <h2>Abonnement</h2>
          <p className="subscription-name">{data.subscription?.title ?? "Aucun abonnement"}</p>
          {data.subscription ? <p className="subscription-validity">{data.subscription.validUntil ? `Jusqu’au ${formatDate(data.subscription.validUntil, { day: "numeric", month: "long", year: "numeric" })}` : data.subscription.active ? "Actif" : "Inactif"}</p> : null}
          <a className="text-link" href="https://velov.grandlyon.com/" target="_blank" rel="noreferrer">Gérer sur Vélo’v<CircleArrow external outline/></a>
        </section>
      </div>
      <div className="account-logout"><Button variant="ghost" onClick={onLogout}><SignOutIcon size={19} weight="light"/>Se déconnecter</Button></div>
    </div>
  );
}
