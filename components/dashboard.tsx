"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { PersonSimpleBikeIcon as BicycleIcon } from "@phosphor-icons/react/dist/csr/PersonSimpleBike";
import { LightningIcon } from "@phosphor-icons/react/dist/csr/Lightning";
import { LetterCirclePIcon } from "@phosphor-icons/react/dist/csr/LetterCircleP";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { NavigationArrowIcon } from "@phosphor-icons/react/dist/csr/NavigationArrow";
import { SignOutIcon } from "@phosphor-icons/react/dist/csr/SignOut";
import { StarFourIcon } from "@phosphor-icons/react/dist/csr/StarFour";
import { ViaAction } from "./via-action";
import { StarIcon } from "@phosphor-icons/react/dist/csr/Star";
import { TicketIcon } from "@phosphor-icons/react/dist/csr/Ticket";
import { TrendUpIcon } from "@phosphor-icons/react/dist/csr/TrendUp";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { type Dashboard, type Page, type Resource, type Station, type Trip, formatDate, formatPrice } from "@/lib/models";
import { formatDistance, haversine, type Point } from "@/lib/geo";
import { Button, CardTag, CircleArrow, EmptyState, Eyebrow, SectionHeading, SelectField, TextButton } from "./ui";
import { StationBikes } from "./station-bikes";
import { TripSheet } from "./trip-sheet";
import type { UserPosition } from "./station-map";
import { AutoRenewal, AutoSpendSetting, ContactSupport, FavoriteButton, InviteFriend, ProfileCoordinates, Receipts } from "./account-actions";

const StationMap = dynamic(() => import("./station-map"), {
  ssr: false,
  loading: () => <div className="map-placeholder" aria-label="Chargement de la carte"/>
});
type StationData = { stations: Station[]; updatedAt: string };
type Navigation = (page: Page) => void;
type Reload = { reload: () => void; reloading: boolean };
type Favorites = { favorites: number[]; onFavorite: (number: number, favorite: boolean) => void };
// One reference while stations load, so the map does not rebuild its pins on every render.
const NO_STATIONS: Station[] = [];
const MISSING = "Indisponible pour le moment";

const phoneQuery = "(max-width: 620px)";
function subscribePhone(changed: () => void) {
  const query = window.matchMedia(phoneQuery);
  query.addEventListener("change", changed);
  return () => query.removeEventListener("change", changed);
}
/** Phones get no preselected station and a compact sheet; the CSS breakpoint matches. */
function useIsPhone() {
  return useSyncExternalStore(subscribePhone, () => window.matchMedia(phoneQuery).matches, () => false);
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
            <span className="trip-date">{formatDate(trip.startedAt)}<small className="clock">{formatDate(trip.startedAt, { hour: "2-digit", minute: "2-digit" })}</small></span>
            <span className="trip-duration">{trip.duration != null ? `${trip.duration} min` : "—"}</span>
            <span className="trip-price">{trip.price != null ? formatPrice(trip.price) : "—"}</span>
            <CaretRightIcon className="trip-arrow" size={16} weight="light"/>
          </button>
        ))}
        {!trips.length ? <EmptyState>Aucun trajet.</EmptyState> : null}
      </div>
      {selected ? <TripSheet trip={selected} onClose={() => setSelected(null)}/> : null}
    </>
  );
}

function StationNumbers({ station, compact = false }: { station: Station; compact?: boolean }) {
  return (
    <div className={`station-numbers ${compact ? "station-numbers-compact" : ""}`}>
      <span><BicycleIcon size={18} weight="light" aria-hidden="true"/><strong>{station.mechanical}</strong><small>Mécaniques</small></span>
      <span><LightningIcon size={17} weight="light" aria-hidden="true"/><strong>{station.electrical}</strong><small>Électriques</small></span>
      <span><LetterCirclePIcon size={18} weight="light" aria-hidden="true"/><strong>{station.stands}</strong><small>Places libres</small></span>
    </div>
  );
}

export function Overview({ data, stations, navigate, reload, reloading }: { data: Dashboard; stations: Resource<StationData>; navigate: Navigation } & Reload) {
  const [selectedStation, setSelectedStation] = useState<string | null>(null);
  const [bikesOpen, setBikesOpen] = useState(false);
  const phone = useIsPhone();
  const nearby = stations.kind === "ready" ? stations.data.stations : NO_STATIONS;
  const chosen = nearby.find((station) => station.id === selectedStation) ?? (phone ? undefined : nearby.find((station) => station.number === 2002) ?? nearby[0]);
  const minutes = data.trips?.reduce((total, trip) => total + (trip.duration ?? 0), 0) ?? 0;
  const subscription = data.subscription === "unavailable" ? null : data.subscription;
  return (
    <div className="page-content">
      {data.ongoing?.length ? (
        <div className="ongoing-banner">
          <Eyebrow icon={BicycleIcon}>Trajet en cours</Eyebrow><span className="ongoing-station">{data.ongoing[0].startStation ?? "Trajet Vélo’v"}</span>
          <ViaAction stations={nearby}/>
        </div>
      ) : null}
      <div className="summary-grid">
        <button className="summary-card" onClick={() => navigate("points")}>
          <CardTag icon={StarFourIcon}>Points</CardTag>
          <strong className="metric-value accent">{data.rewards.balance ?? "—"}</strong>
          <span className="metric-detail">{data.rewards.total != null ? `${data.rewards.total.toLocaleString("fr-FR")} gagnés au total` : MISSING}<CircleArrow outline/></span>
        </button>
        <button className="summary-card" onClick={() => navigate("trips")}>
          <CardTag icon={BicycleIcon}>Trajets</CardTag>
          <strong className="metric-value">{data.trips?.length ?? "—"}</strong>
          <span className="metric-detail">{!data.trips ? MISSING : minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`}<CircleArrow outline/></span>
        </button>
        <button className="summary-card" onClick={() => navigate("account")}>
          <CardTag icon={TicketIcon}>Abonnement</CardTag>
          <strong className="metric-subscription" title={subscription?.title}>{data.subscription === "unavailable" ? "—" : shortPlan(subscription?.title)}</strong>
          <span className="metric-detail">{data.subscription === "unavailable" ? MISSING : subscription?.validUntil ? `Jusqu’au ${formatDate(subscription.validUntil, { day: "numeric", month: "short", year: "numeric" })}` : "Voir les formules"}<CircleArrow outline/></span>
        </button>
      </div>
      <section className="map-section">
        <SectionHeading title="Stations"><TextButton onClick={() => navigate("stations")}>Tout voir</TextButton></SectionHeading>
        <div className="overview-map">
          <StationMap stations={nearby} selected={chosen?.id ?? null} onSelect={setSelectedStation}/>
          {stations.kind === "error" ? <div className="map-error" role="status">{stations.message}<Button variant="secondary" pending={reloading} onClick={reload}>Réessayer</Button></div> : null}
          {phone ? <button className="map-explore" onClick={() => navigate("stations")}><span>Toucher pour explorer</span></button> : null}
          {chosen ? (
            <div className="map-station-card">
              <div className="station-card-heading"><strong>{chosen.name}</strong><button className="icon-button" aria-label="Voir les stations" onClick={() => navigate("stations")}><CaretRightIcon size={18} weight="light"/></button></div>
              <StationNumbers station={chosen}/>
              <Button variant="secondary" onClick={() => setBikesOpen(true)}>Voir les vélos</Button>
            </div>
          ) : null}
          {bikesOpen && chosen ? <StationBikes key={chosen.id} station={chosen} onClose={() => setBikesOpen(false)}/> : null}
        </div>
      </section>
      <section className="recent-trips">
        <SectionHeading title="Derniers trajets"><TextButton onClick={() => navigate("trips")}>Tout voir</TextButton></SectionHeading>
        {data.trips ? <TripsTable trips={data.trips.slice(0, 4)}/> : <EmptyState>{MISSING}.</EmptyState>}
      </section>
    </div>
  );
}

export function TripsPage({ data }: { data: Dashboard }) {
  const [filter, setFilter] = useState("all");
  const [limit, setLimit] = useState(10);
  if (!data.trips) return <div className="page-content"><EmptyState>{MISSING}.</EmptyState></div>;
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

export function PointsPage({ data, onAutoSpend, onChanged }: { onChanged: () => void; data: Dashboard; onAutoSpend: (value: boolean) => void }) {
  const [limit, setLimit] = useState(8);
  const rules = data.rewards.rules.filter((rule) => rule.kind === "earn").slice(0, 3);
  const invite = data.rewards.rules.find((rule) => rule.name === "PROMOCODE");
  return (
    <div className="page-content">
      <div className="points-summary">
        <div><Eyebrow icon={StarFourIcon}>Solde</Eyebrow><strong className="points-balance">{data.rewards.balance ?? "—"}<span>points</span></strong></div>
        <div><Eyebrow icon={TrendUpIcon}>Total gagné</Eyebrow><strong className="points-total">{data.rewards.total?.toLocaleString("fr-FR") ?? "—"}<span>points</span></strong></div>
      </div>
      <AutoSpendSetting value={data.rewards.autoSpend} onChanged={onAutoSpend}/>
      <InviteFriend key={data.profile.email} account={data.profile.email} onChanged={onChanged} cost={invite?.points ?? null} balance={data.rewards.balance}/>
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

type StationFilter = "all" | "favorites" | "available" | "electrical" | "stands";

function matchesFilter(station: Station, filter: StationFilter, favorites: Set<number>) {
  return (filter !== "favorites" || favorites.has(station.number))
    && (filter !== "available" || station.mechanical + station.electrical > 0)
    && (filter !== "electrical" || station.electrical > 0)
    && (filter !== "stands" || station.stands > 0);
}

function distanceTo(station: Station, position: Point) {
  return haversine(position, station);
}

function locationErrorMessage(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) return "Localisation refusée. Autorisez-la pour ce site : Réglages > Safari > Position (iPhone) ou l’icône à gauche de l’adresse (ordinateur).";
  if (error.code === error.TIMEOUT) return "La localisation a pris trop de temps. Réessayez.";
  return "Position introuvable pour le moment.";
}

export function StationsPage({ resource, reload, reloading, favorites: favoriteList, onFavorite }: { resource: Resource<StationData> } & Reload & Favorites) {
  const phone = useIsPhone();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StationFilter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [bikesOpen, setBikesOpen] = useState(false);
  const [position, setPosition] = useState<UserPosition | null>(null);
  const [fit, setFit] = useState<Point[] | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const stations = resource.kind === "ready" ? resource.data.stations : NO_STATIONS;
  const favorites = useMemo(() => new Set(favoriteList), [favoriteList]);
  // Favourites first, then open stations, then the nearest (or by name).
  const filtered = useMemo(() => {
    const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    return stations.filter((station) => normalize(`${station.name} ${station.address} ${station.number}`).includes(normalize(query)) && matchesFilter(station, filter, favorites))
      .sort((left, right) => Number(favorites.has(right.number)) - Number(favorites.has(left.number)) || Number(right.open) - Number(left.open)
        || (position ? distanceTo(left, position) - distanceTo(right, position) : left.name.localeCompare(right.name, "fr")));
  }, [stations, query, filter, position, favorites]);
  const chosen = filtered.find((station) => station.id === selected) ?? (phone ? undefined : filtered.find((station) => station.number === 2002) ?? filtered[0]);
  const chosenDistance = chosen && position ? formatDistance(distanceTo(chosen, position)) : null;
  const directions = chosen ? `https://www.google.com/maps/dir/?api=1&destination=${chosen.lat},${chosen.lon}&travelmode=walking` : "";

  function located(coords: GeolocationCoordinates) {
    const here: UserPosition = { lat: coords.latitude, lon: coords.longitude, accuracy: coords.accuracy };
    const open = stations.filter((station) => station.open && matchesFilter(station, filter, favorites))
      .sort((left, right) => distanceTo(left, here) - distanceTo(right, here));
    const withSupply = open.filter((station) => filter === "stands" ? station.stands > 0 : station.mechanical + station.electrical > 0).slice(0, 3);
    setPosition(here);
    setSelected(open[0]?.id ?? null);
    setFit([here, ...open.slice(0, 1), ...withSupply]);
    if (!open.length) setLocationError("Aucune station ouverte ne correspond à ce filtre.");
    setLocating(false);
  }

  function locate() {
    setLocationError("");
    if (!window.isSecureContext) { setLocationError("La localisation demande une connexion sécurisée (https). Recherchez une station par son nom."); return; }
    if (!("geolocation" in navigator)) { setLocationError("Ce navigateur ne permet pas la localisation. Recherchez une station par son nom."); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition((result) => located(result.coords),
      (error) => { setLocationError(locationErrorMessage(error)); setLocating(false); },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 30_000 });
  }

  return (
    <div className="page-content stations-page">
      <div className="stations-toolbar">
        <label className="search-field"><MagnifyingGlassIcon size={19} weight="light" aria-hidden="true"/>
          <input aria-label="Rechercher une station" placeholder="Rechercher une station" value={query} onChange={(event) => { setQuery(event.target.value); }}/>
          {query ? <button className="icon-button" aria-label="Effacer la recherche" onClick={() => setQuery("")}><XIcon size={16} weight="light"/></button> : null}
        </label>
        <Button variant="secondary" pending={locating} onClick={locate} aria-label="Stations autour de moi" title="Autour de moi"><NavigationArrowIcon size={18} weight="light"/><span className="location-label">Autour de moi</span></Button>
      </div>
      {locationError ? <p className="inline-notice" role="status">{locationError}</p> : null}
      <div className="filter-line">
        <SelectField label="Afficher" value={filter} onChange={(value) => { setFilter(value); }}
          options={[{ value: "all", label: "Toutes les stations" }, { value: "favorites", label: "Favorites" }, { value: "available", label: "Vélos disponibles" }, { value: "electrical", label: "Vélos électriques" }, { value: "stands", label: "Places libres" }]}/>
      </div>
      {resource.kind === "error" ? <div className="notice-error" role="status">{resource.message}<Button variant="secondary" pending={reloading} onClick={reload}>Réessayer</Button></div> : null}
      <div className="stations-explorer">
        {query && resource.kind === "ready" ? (
          <div className="stations-list" role="list" aria-label="Résultats de recherche">
            {filtered.slice(0, 6).map((station) => (
              <button className={`station-item ${chosen?.id === station.id ? "selected" : ""}`} key={station.id} onClick={() => { setSelected(station.id); setQuery(""); }}>
                <div className="station-item-title"><strong>{station.name}</strong>{favorites.has(station.number) ? <StarIcon className="favorite-mark" size={14} weight="fill" aria-label="Favorite"/> : null}<CaretRightIcon size={16} weight="light"/></div>
                <small className="station-meta">{position ? `${formatDistance(distanceTo(station, position))} · ` : ""}N° {station.number}{!station.open ? " · Fermée" : ""}</small>
              </button>
            ))}
            {!filtered.length ? <EmptyState>Aucune station trouvée.</EmptyState> : null}
          </div>
        ) : null}
        <div className="explorer-map">
          <StationMap stations={filtered} selected={chosen?.id ?? null} onSelect={setSelected} onClear={phone ? () => setSelected(null) : undefined} userPosition={position} fit={fit}/>
          {chosen && phone ? (
            <section className="station-sheet" aria-label={chosen.name}>
              <div className="station-sheet-heading">
                <h2>{chosen.name}</h2>
                {!chosen.open ? <span className="closed-station">Fermée</span> : null}
                <FavoriteButton station={chosen} favorite={favorites.has(chosen.number)} onChanged={onFavorite}/>
                <button className="icon-button" aria-label="Fermer" onClick={() => setSelected(null)}><XIcon size={18} weight="light"/></button>
              </div>
              <div className="station-sheet-facts">
                <StationNumbers station={chosen} compact/>
                {chosenDistance ? <span className="station-distance">{chosenDistance}</span> : null}
              </div>
              <div className="station-sheet-actions">
                <Button variant="secondary" onClick={() => setBikesOpen(true)}>Voir les vélos</Button>
                <a className="button button-primary" href={directions} target="_blank" rel="noreferrer">Itinéraire<CircleArrow external/></a>
              </div>
            </section>
          ) : chosen ? (
            <div className="selected-station-panel">
              <div className="station-card-heading"><h2>{chosen.name}</h2>{!chosen.open ? <span className="closed-station">Fermée</span> : null}<FavoriteButton station={chosen} favorite={favorites.has(chosen.number)} onChanged={onFavorite}/></div>
              {chosenDistance ? <p className="station-distance">À {chosenDistance}</p> : null}
              <StationNumbers station={chosen}/>
              <Button variant="secondary" onClick={() => setBikesOpen(true)}>Voir les vélos</Button>
              <a className="button button-primary" href={directions} target="_blank" rel="noreferrer">Itinéraire<CircleArrow external/></a>
            </div>
          ) : null}
          {bikesOpen && chosen ? <StationBikes key={chosen.id} station={chosen} onClose={() => setBikesOpen(false)}/> : null}
        </div>
      </div>
    </div>
  );
}

/** Card headline: plan name without the brand prefix and payment suffix ("Vélo’v Plus 1 an Jeunes – paiement comptant" -> "Plus 1 an Jeunes"). */
function shortPlan(title?: string) {
  if (!title) return "Aucun";
  return title.split(/\s[–-]\s/)[0].replace(/^V[ée]lo[’']v\s+/i, "") || title;
}

export function AccountPage({ data, onLogout, onSaved }: { data: Dashboard; onLogout: () => void; onSaved: () => void }) {
  const subscription = data.subscription === "unavailable" ? null : data.subscription;
  return (
    <div className="page-content">
      <div className="account-grid">
        <section className="account-section">
          <h2>Profil</h2>
          <p className="profile-name">{[data.profile.firstName, data.profile.lastName].filter(Boolean).join(" ") || "Compte Vélo’v"}</p>
          <p className="profile-email">{data.profile.email}</p>
          {/* Only what needs attention: an active account, a complete profile and a valid card go without saying. */}
          {data.profile.locked || !data.profile.complete || data.paymentValid === false ? (
            <dl className="account-details">
              {data.profile.locked ? <div><dt>Compte</dt><dd>À vérifier</dd></div> : null}
              {!data.profile.complete ? <div><dt>Profil</dt><dd>À compléter</dd></div> : null}
              {data.paymentValid === false ? <div><dt>Paiement</dt><dd>À vérifier</dd></div> : null}
            </dl>
          ) : null}
          <ProfileCoordinates profile={data.profile} onSaved={onSaved}/>
        </section>
        <section className="account-section">
          <h2>Abonnement</h2>
          <p className="subscription-name">{data.subscription === "unavailable" ? MISSING : subscription?.title ?? "Aucun abonnement"}</p>
          {subscription ? <p className="subscription-validity">{subscription.validUntil ? `Jusqu’au ${formatDate(subscription.validUntil, { day: "numeric", month: "long", year: "numeric" })}` : subscription.active ? "Actif" : "Inactif"}</p> : null}
          {subscription?.type === "LT" ? <AutoRenewal key={`${subscription.id}:${data.updatedAt}`} subscriptionId={subscription.id} value={subscription.autoRenewal} allowed={subscription.autoRenewalAllowed} onSaved={onSaved}/> : null}
          <Receipts receipts={data.receipts}/>
          <a className="text-link" href="https://velov.grandlyon.com/" target="_blank" rel="noreferrer">Gérer sur Vélo’v<CircleArrow external outline/></a>
        </section>
        <section className="account-section">
          <h2>Service client</h2>
          <div className="account-contact"><ContactSupport trips={data.trips}/></div>
        </section>
      </div>
      <div className="account-logout"><Button variant="secondary" onClick={onLogout}><SignOutIcon size={19} weight="regular" aria-hidden="true"/>Se déconnecter</Button></div>
    </div>
  );
}

