"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { BicycleIcon, CaretRightIcon, DownloadSimpleIcon, EnvelopeSimpleIcon, type Icon, LetterCirclePIcon, LightningIcon, MagnifyingGlassIcon, NavigationArrowIcon, PencilIcon, SignOutIcon, StarFourIcon, StarIcon, TicketIcon, TrendUpIcon, XIcon } from "./icons";
import { ViaAction } from "./via-action";
import { RedBanner, useSecondsSince } from "./bike-actions";
import { type Dashboard, type Page, type Resource, type Station, type Trip, formatCount, formatCountSans, formatDate, formatDuration, formatName, formatPrice } from "@/lib/models";
import { findPosition, formatDistance, haversine, reportLocationFailure, type Point } from "@/lib/geo";
import { toaster } from "@/lib/toast";
import { type StationFilter, matchesFilter, nearestSupplied, locateMessage } from "@/lib/station-filter";
import { Button, CardTag, CircleArrow, EmptyState, Eyebrow, FavoriteToggle, Ghost, LoadFailure, SectionHeading, SelectField, SelectSkeleton, TextButton } from "./ui";
import { StationBikes } from "./station-bikes";
import { TripSheet } from "./trip-sheet";
import type { UserPosition } from "./station-map";
import { AutoRenewal, AutoSpendSetting, ContactSupport, FavoriteButton, InviteFriend, ProfileCoordinates, Receipts } from "./account-actions";

const StationMap = dynamic(() => import("./station-map"), {
  ssr: false,
  loading: () => <div className="map-placeholder skeleton" aria-label="Chargement de la carte"/>
});
function MapAttribution() {
  return <p className="map-attribution"><a href="https://leafletjs.com" target="_blank" rel="noreferrer">Leaflet</a> <span aria-hidden="true">|</span> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a></p>;
}
type StationData = { stations: Station[]; updatedAt: string };
type Navigation = (page: Page) => void;
type Reload = { reload: () => void; reloading: boolean };
type Favorites = { favorites: number[]; account: string | null; onFavorite: (number: number, favorite: boolean) => void };
const NO_STATIONS: Station[] = [];
const MISSING = "Indisponible pour le moment";
const bikeFilters = [{ value: "all", label: "Tous les vélos" }, { value: "mechanical", label: "Vélos mécaniques" }, { value: "electrical", label: "Vélos électriques" }];
const stationFilters: { value: StationFilter; label: string; short?: string }[] = [{ value: "all", label: "Toutes les stations", short: "Toutes" }, { value: "favorites", label: "Favorites" }, { value: "available", label: "Vélos disponibles", short: "Vélos dispo" }, { value: "electrical", label: "Vélos électriques", short: "Électriques" }, { value: "stands", label: "Places libres", short: "Places" }];

const phoneQuery = "(max-width: 620px)";
function subscribePhone(changed: () => void) {
  const query = window.matchMedia(phoneQuery);
  query.addEventListener("change", changed);
  return () => query.removeEventListener("change", changed);
}
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
                <small>{trip.endStation ?? (trip.startStation ? "Station non renseignée" : "Stations non renseignées")}</small>
              </span>
            </span>
            <span className="trip-date">{formatDate(trip.startedAt)}<small className="clock">{formatDate(trip.startedAt, { hour: "2-digit", minute: "2-digit" })}</small></span>
            <span className="trip-duration">{trip.duration != null ? formatDuration(trip.duration) : "—"}</span>
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
      <span><LetterCirclePIcon size={18} weight="light" aria-hidden="true"/><strong>{station.stands}</strong><small>Places</small></span>
    </div>
  );
}

function OngoingBanner({ trip, stations, account }: { trip: Trip; stations: Station[]; account: string }) {
  const elapsed = useSecondsSince(trip.startedAt);
  return (
    <RedBanner icon={BicycleIcon} seconds={elapsed} label={elapsed != null ? `Trajet en cours depuis ${Math.floor(elapsed / 60)} min` : "Trajet en cours"}>
      <ViaAction stations={stations} account={account} tripId={trip.id}/>
    </RedBanner>
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
      {data.ongoing?.length ? <OngoingBanner trip={data.ongoing[0]} stations={nearby} account={data.profile.email}/> : null}
      <div className="summary-grid">
        <button className="summary-card" onClick={() => navigate("points")}>
          <CardTag icon={StarFourIcon}>Points</CardTag>
          <strong className="metric-value accent">{data.rewards.balance != null ? formatCount(data.rewards.balance) : "—"}</strong>
          <span className="metric-detail">{data.rewards.total != null ? `${formatCountSans(data.rewards.total)} gagnés au total` : MISSING}<CircleArrow outline/></span>
        </button>
        <button className="summary-card" onClick={() => navigate("trips")}>
          <CardTag icon={BicycleIcon}>Trajets</CardTag>
          <strong className="metric-value">{data.trips ? formatCount(data.trips.length) : "—"}</strong>
          <span className="metric-detail">{!data.trips ? MISSING : formatDuration(minutes)}<CircleArrow outline/></span>
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
          {stations.kind === "error" ? <LoadFailure failure={stations} layout="floating" pending={reloading} onRetry={reload}/> : null}
          {phone ? <button className="map-explore" aria-label="Explorer les stations" onClick={() => navigate("stations")}/> : null}
          <div className="map-foot">
            {chosen ? (
              <div className="map-station-card">
                <div className="station-card-heading"><strong>{chosen.name}</strong><button className="icon-button" aria-label="Voir les stations" onClick={() => navigate("stations")}><CaretRightIcon size={18} weight="light"/></button></div>
                <StationNumbers station={chosen} compact/>
                <div className="station-card-actions">
                  <Button onClick={() => setBikesOpen(true)}>Voir les vélos</Button>
                  <a className="button button-secondary" href={directionsTo(chosen)} target="_blank" rel="noreferrer">Itinéraire</a>
                </div>
              </div>
            ) : null}
            <MapAttribution/>
          </div>
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
        <SelectField label="Type de vélo" hideLabel value={filter} onChange={(value) => { setFilter(value); setLimit(10); }}
          options={bikeFilters}/>
        <span className="result-count">{formatCountSans(trips.length)} trajet{trips.length > 1 ? "s" : ""}</span>
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
        <div><Eyebrow icon={StarFourIcon}>Solde actuel</Eyebrow><strong className="points-balance">{data.rewards.balance != null ? formatCount(data.rewards.balance) : "—"}</strong></div>
        <div><Eyebrow icon={TrendUpIcon}>Total gagné</Eyebrow><strong className="points-total">{data.rewards.total != null ? formatCount(data.rewards.total) : "—"}</strong></div>
      </div>
      <AutoSpendSetting value={data.rewards.autoSpend} account={data.profile.email} onChanged={onAutoSpend}/>
      <InviteFriend key={data.profile.email} account={data.profile.email} onChanged={onChanged} cost={invite?.points ?? null} balance={data.rewards.balance}/>
      {rules.length ? (
        <section className="earn-section">
          <SectionHeading title="Gagner des points"/>
          <div className="earn-grid">{rules.map((rule) => <div className="earn-rule" key={rule.name}><span>{rule.label === "Vélo évalué" ? "Évaluation d’un vélo après un trajet" : rule.label}</span><strong>+{formatCount(rule.points)}</strong></div>)}</div>
        </section>
      ) : null}
      <section className="points-history">
        <SectionHeading title="Historique"/>
        {data.rewards.movements.slice(0, limit).map((movement) => (
          <div className="movement" key={movement.id}>
            <span className="movement-description"><strong>{rewardLabel(movement.label)}</strong><small>{formatDate(movement.date, { day: "numeric", month: "long", year: "numeric" })}</small></span>
            <span className={`movement-amount ${movement.amount > 0 ? "is-credit" : ""}`}>{movement.amount > 0 ? "+" : ""}{formatCountSans(movement.amount)}</span>
          </div>
        ))}
        {!data.rewards.movements.length ? <EmptyState>Aucun mouvement de points.</EmptyState> : null}
        {data.rewards.movements.length > limit ? <div className="load-more"><Button variant="secondary" onClick={() => setLimit(limit + 12)}>Voir plus</Button></div> : null}
      </section>
    </div>
  );
}

function directionsTo(station: Station) {
  return `https://www.google.com/maps/dir/?api=1&destination=${station.lat},${station.lon}&travelmode=walking`;
}

function distanceTo(station: Station, position: Point) {
  return haversine(position, station);
}

export function StationsPage({ resource, reload, reloading, favorites: favoriteList, account, onFavorite }: { resource: Resource<StationData> } & Reload & Favorites) {
  const phone = useIsPhone();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StationFilter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [bikesOpen, setBikesOpen] = useState(false);
  const [position, setPosition] = useState<UserPosition | null>(null);
  const [fit, setFit] = useState<Point[] | null>(null);
  const [locating, setLocating] = useState(false);
  const stations = resource.kind === "ready" ? resource.data.stations : NO_STATIONS;
  const latest = useRef(resource);
  useEffect(() => { latest.current = resource; }, [resource]);
  const favorites = useMemo(() => new Set(favoriteList), [favoriteList]);
  const filtered = useMemo(() => {
    const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    return stations.filter((station) => normalize(`${station.name} ${station.address} ${station.number}`).includes(normalize(query)) && matchesFilter(station, filter, favorites))
      .sort((left, right) => Number(favorites.has(right.number)) - Number(favorites.has(left.number)) || Number(right.open) - Number(left.open)
        || (position ? distanceTo(left, position) - distanceTo(right, position) : left.name.localeCompare(right.name, "fr")));
  }, [stations, query, filter, position, favorites]);
  const chosen = filtered.find((station) => station.id === selected) ?? (phone ? undefined : filtered.find((station) => station.number === 2002) ?? filtered[0]);
  const chosenDistance = chosen && position ? formatDistance(distanceTo(chosen, position)) : null;
  const directions = chosen ? directionsTo(chosen) : "";

  function located(coords: GeolocationCoordinates) {
    const here: UserPosition = { lat: coords.latitude, lon: coords.longitude, accuracy: coords.accuracy };
    const current = latest.current;
    const supplied = nearestSupplied(current.kind === "ready" ? current.data.stations : NO_STATIONS, here, filter, favorites);
    setPosition(here);
    setSelected(supplied[0]?.id ?? null);
    setFit([here, ...supplied]);
    const message = locateMessage(current, supplied.length);
    if (message) toaster.show(message);
    setLocating(false);
  }

  function locate() {
    if (!window.isSecureContext) { toaster.show("Localisation indisponible sur cette page. Recherchez une station par son nom."); return; }
    if (!("geolocation" in navigator)) { toaster.show("Ce navigateur ne permet pas la localisation. Recherchez une station par son nom."); return; }
    setLocating(true);
    findPosition(navigator.geolocation).then((result) => located(result.coords),
      async (error: unknown) => { await reportLocationFailure(error); setLocating(false); });
  }

  return (
    <div className="page-content stations-page">
      <div className="stations-toolbar">
        <div className="search-field">
          <label className="search-input"><MagnifyingGlassIcon size={19} weight="light" aria-hidden="true"/>
            <input aria-label="Rechercher une station" placeholder={phone ? "Rechercher" : "Rechercher une station"} value={query} onChange={(event) => { setQuery(event.target.value); }}/>
            {query ? <button className="icon-button" aria-label="Effacer la recherche" onClick={() => setQuery("")}><XIcon size={16} weight="light"/></button> : null}
          </label>
          <SelectField className="select-inline" label="Afficher" hideLabel value={filter} onChange={(value) => { setFilter(value); }}
            options={stationFilters}/>
        </div>
        <Button variant="secondary" pending={locating} onClick={locate} aria-label="Stations autour de moi" title="Autour de moi"><NavigationArrowIcon size={18} weight="light"/><span className="location-label">Autour de moi</span></Button>
      </div>
      <div className="stations-explorer">
        {query && resource.kind === "ready" ? (
          <div className="stations-list" role="list" aria-label="Résultats de recherche">
            {filtered.slice(0, 6).map((station) => (
              <button className={`station-item ${chosen?.id === station.id ? "selected" : ""}`} key={station.id} onClick={() => { setSelected(station.id); setQuery(""); }}>
                <div className="station-item-title"><strong>{station.name}{favorites.has(station.number) ? <StarIcon className="favorite-mark" size={14} weight="fill" aria-label="Favorite"/> : null}</strong><CaretRightIcon size={16} weight="light"/></div>
                <small className="station-meta">{position ? `${formatDistance(distanceTo(station, position))} · ` : ""}N° {station.number}{!station.open ? " · Fermée" : ""}</small>
              </button>
            ))}
            {!filtered.length ? <EmptyState>Aucune station trouvée.</EmptyState> : null}
          </div>
        ) : null}
        <div className="explorer-map">
          <StationMap stations={filtered} selected={chosen?.id ?? null} onSelect={setSelected} onClear={phone ? () => setSelected(null) : undefined} userPosition={position} fit={fit}/>
          {resource.kind === "error" ? <LoadFailure failure={resource} layout="floating" pending={reloading} onRetry={reload}/> : null}
          {!query && filter !== "all" && resource.kind === "ready" && !filtered.length ? (
            <div className="filter-empty" role="status"><span>Aucune station pour ce filtre.</span><TextButton onClick={() => setFilter("all")}>Toutes les stations</TextButton></div>
          ) : null}
          <div className="map-foot">
            {chosen && phone ? (
              <section className="station-sheet" aria-label={chosen.name}>
                <div className="station-sheet-heading">
                  <StationTitle station={chosen} favorite={favorites.has(chosen.number)} account={account} onFavorite={onFavorite}/>
                  {!chosen.open ? <span className="closed-station">Fermée</span> : null}
                  <button className="icon-button" aria-label="Fermer" onClick={() => setSelected(null)}><XIcon size={18} weight="light"/></button>
                </div>
                <div className="station-sheet-facts">
                  <StationNumbers station={chosen} compact/>
                  {chosenDistance ? <span className="station-distance">{chosenDistance}</span> : null}
                </div>
                <div className="station-sheet-actions">
                  <Button onClick={() => setBikesOpen(true)}>Voir les vélos</Button>
                  <a className="button button-secondary" href={directions} target="_blank" rel="noreferrer">Itinéraire</a>
                </div>
              </section>
            ) : chosen ? (
              <div className="selected-station-panel">
                <div className="station-card-heading"><StationTitle station={chosen} favorite={favorites.has(chosen.number)} account={account} onFavorite={onFavorite}/>{!chosen.open ? <span className="closed-station">Fermée</span> : null}</div>
                {chosenDistance ? <p className="station-distance">{chosenDistance}</p> : null}
                <StationNumbers station={chosen}/>
                <Button onClick={() => setBikesOpen(true)}>Voir les vélos</Button>
                <a className="button button-secondary" href={directions} target="_blank" rel="noreferrer">Itinéraire</a>
              </div>
            ) : resource.kind === "loading" && !phone ? <StationPanelGhost/> : null}
            <MapAttribution/>
          </div>
          {bikesOpen && chosen ? <StationBikes key={chosen.id} station={chosen} onClose={() => setBikesOpen(false)}/> : null}
        </div>
      </div>
    </div>
  );
}

function StationTitle({ station, favorite, account, onFavorite }: { station: Station; favorite: boolean } & Pick<Favorites, "account" | "onFavorite">) {
  return (
    <div className="station-title"><h2>{station.name}</h2>{account ? <FavoriteButton station={station} favorite={favorite} account={account} onChanged={onFavorite}/>
      : <FavoriteToggle favorite={favorite} onClick={() => onFavorite(station.number, !favorite)}/>}</div>
  );
}

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
          <p className="profile-name">{formatName(`${data.profile.firstName} ${data.profile.lastName}`) || "Compte Vélo’v"}</p>
          <p className="profile-email">{data.profile.email}</p>
          {data.profile.locked || !data.profile.complete || data.paymentValid === false ? (
            <dl className="account-details">
              {data.profile.locked ? <div><dt>Compte</dt><dd>À vérifier</dd></div> : null}
              {!data.profile.complete ? <div><dt>Profil</dt><dd>À compléter</dd></div> : null}
              {data.paymentValid === false ? <div><dt>Paiement</dt><dd>À vérifier</dd></div> : null}
            </dl>
          ) : null}
          <ProfileCoordinates profile={data.profile} account={data.profile.email} onSaved={onSaved}/>
        </section>
        <section className="account-section">
          <h2>Abonnement</h2>
          <p className="subscription-name">{data.subscription === "unavailable" ? MISSING : subscription?.title ?? "Aucun abonnement"}</p>
          {subscription && (subscription.validUntil || !subscription.active) ? <p className="subscription-validity">{subscription.validUntil ? `Jusqu’au ${formatDate(subscription.validUntil, { day: "numeric", month: "long", year: "numeric" })}` : "Inactif"}</p> : null}
          {subscription?.type === "LT" ? <AutoRenewal key={`${subscription.id}:${data.updatedAt}`} subscriptionId={subscription.id} account={data.profile.email} value={subscription.autoRenewal} allowed={subscription.autoRenewalAllowed} onSaved={onSaved}/> : null}
          <Receipts receipts={data.receipts}/>
          <a className="text-link" href="https://velov.grandlyon.com/" target="_blank" rel="noreferrer">Gérer sur Vélo’v</a>
        </section>
        <section className="account-section">
          <h2>Service client</h2>
          <div className="account-contact"><ContactSupport trips={data.trips} account={data.profile.email}/></div>
        </section>
      </div>
      <div className="account-logout"><Button variant="secondary" onClick={onLogout}><SignOutIcon size={19} weight="regular" aria-hidden="true"/>Se déconnecter</Button></div>
    </div>
  );
}



const GHOST_ROUTES = [["Bellecour", "Part-Dieu Villette"], ["Hôtel de Ville", "Saxe-Gambetta"], ["Croix-Rousse", "Terreaux"], ["Perrache", "Jean Macé"]];

function TripsTableSkeleton({ rows }: { rows: number }) {
  return (
    <div className="trips-table">
      <div className="table-head"><span>Trajet</span><span>Date</span><span>Durée</span><span>Montant</span><span/></div>
      {Array.from({ length: rows }, (_, index) => {
        const [from, to] = GHOST_ROUTES[index % GHOST_ROUTES.length];
        return (
          <div className="trip-row" key={index}>
            <span className="trip-description"><span className="trip-icon skeleton"/><span className="trip-route"><strong><Ghost>{from}</Ghost></strong><small><Ghost>{to}</Ghost></small></span></span>
            <span className="trip-date"><Ghost>12 oct.</Ghost><small className="clock"><Ghost>08:42</Ghost></small></span>
            <span className="trip-duration"><Ghost>14 min</Ghost></span>
            <span className="trip-price"><Ghost>0,00 €</Ghost></span>
            <span/>
          </div>
        );
      })}
    </div>
  );
}

function SummaryCardSkeleton({ icon, label, detail, subscription = false }: { icon: Icon; label: string; detail: string; subscription?: boolean }) {
  return (
    <div className="summary-card skeleton" aria-hidden="true">
      <CardTag icon={icon}>{label}</CardTag>
      {subscription ? <strong className="metric-subscription">Plus 1 an</strong> : <strong className="metric-value">0</strong>}
      <span className="metric-detail">{detail}<CircleArrow outline/></span>
    </div>
  );
}

function LinkSkeleton({ children }: { children: string }) {
  return <span className="text-button"><Ghost>{children}</Ghost></span>;
}

function LoadMoreSkeleton() {
  return <div className="load-more"><span className="button skeleton" aria-hidden="true">Voir plus</span></div>;
}

export function OverviewSkeleton() {
  return (
    <div className="page-content" aria-busy="true" aria-label="Chargement du compte">
      <div className="summary-grid">
        <SummaryCardSkeleton icon={StarFourIcon} label="Points" detail="1 380 gagnés au total"/>
        <SummaryCardSkeleton icon={BicycleIcon} label="Trajets" detail="12 h 40 min"/>
        <SummaryCardSkeleton icon={TicketIcon} label="Abonnement" detail="Jusqu’au 1 mars 2027" subscription/>
      </div>
      <section className="map-section">
        <SectionHeading title="Stations"><LinkSkeleton>Tout voir</LinkSkeleton></SectionHeading>
        <div className="overview-map skeleton" aria-hidden="true"/>
      </section>
      <section className="recent-trips">
        <SectionHeading title="Derniers trajets"><LinkSkeleton>Tout voir</LinkSkeleton></SectionHeading>
        <TripsTableSkeleton rows={4}/>
      </section>
    </div>
  );
}

export function TripsSkeleton() {
  return (
    <div className="page-content" aria-busy="true" aria-label="Chargement des trajets">
      <div className="filter-line">
        <SelectSkeleton options={bikeFilters}/>
        <span className="result-count"><Ghost>10 trajets</Ghost></span>
      </div>
      <TripsTableSkeleton rows={10}/>
      <LoadMoreSkeleton/>
    </div>
  );
}

const GHOST_RULES = ["Départ d’une station pleine", "Arrivée dans une station vide", "Évaluation d’un vélo après un trajet"];
const GHOST_MOVEMENTS = ["Bonus de trajet", "Évaluation", "Arrivée dans une station vide", "Réduction sur un trajet"];

export function PointsSkeleton() {
  return (
    <div className="page-content" aria-busy="true" aria-label="Chargement des points">
      <div className="points-summary" aria-hidden="true">
        <div className="skeleton"><Eyebrow icon={StarFourIcon}>Solde actuel</Eyebrow><strong className="points-balance">0</strong></div>
        <div className="skeleton"><Eyebrow icon={TrendUpIcon}>Total gagné</Eyebrow><strong className="points-total">0</strong></div>
      </div>
      <div className="setting-row skeleton" aria-hidden="true"><div><span className="metric-label">Utilisation automatique</span><strong className="setting-value">Activée</strong></div><span className="switch"/></div>
      <div className="soon-row invite-row skeleton" aria-hidden="true">
        <div><span className="metric-label">Inviter un ami</span><p>Échangez vos points contre un code à offrir à un ami.</p></div>
        <span className="button button-secondary"><span className="button-content"><TicketIcon size={17} weight="light"/>Obtenir un code</span></span>
      </div>
      <section className="earn-section">
        <SectionHeading title="Gagner des points"/>
        <div className="earn-grid">{GHOST_RULES.map((rule) => <div className="earn-rule skeleton" aria-hidden="true" key={rule}><span>{rule}</span><strong>+5</strong></div>)}</div>
      </section>
      <section className="points-history">
        <SectionHeading title="Historique"/>
        {Array.from({ length: 8 }, (_, index) => (
          <div className="movement" key={index}>
            <span className="movement-description"><strong><Ghost>{GHOST_MOVEMENTS[index % GHOST_MOVEMENTS.length]}</Ghost></strong><small><Ghost>12 octobre 2026</Ghost></small></span>
            <span className="movement-amount"><Ghost>+5</Ghost></span>
          </div>
        ))}
        <LoadMoreSkeleton/>
      </section>
    </div>
  );
}

const GHOST_STATION: Station = { id: "ghost", number: 0, name: "", address: "", lat: 0, lon: 0, electrical: 3, mechanical: 6, stands: 12, open: true };

function StationPanelGhost() {
  return (
    <div className="selected-station-panel" aria-hidden="true">
      <div className="station-card-heading"><div className="station-title"><h2 className="skeleton-text">Bellecour / Ferrandière</h2></div></div>
      <div className="skeleton-text"><StationNumbers station={GHOST_STATION}/></div>
      <span className="button skeleton"><span className="button-content">Voir les vélos</span></span>
      <span className="button skeleton"><span className="button-content">Itinéraire</span></span>
    </div>
  );
}

export function StationsSkeleton() {
  return (
    <div className="page-content stations-page" aria-busy="true" aria-label="Chargement des stations">
      <div className="stations-toolbar" aria-hidden="true">
        <div className="search-field skeleton">
          <span className="search-input"><MagnifyingGlassIcon size={19} weight="light"/><input tabIndex={-1} readOnly/></span>
          <SelectSkeleton className="select-inline" options={stationFilters}/>
        </div>
        <span className="button skeleton"><span className="button-content"><NavigationArrowIcon size={18} weight="light"/><span className="location-label">Autour de moi</span></span></span>
      </div>
      <div className="stations-explorer">
        <div className="explorer-map" aria-hidden="true">
          <div className="map-skeleton skeleton"/>
          <div className="map-foot station-panel-ghost">
            <StationPanelGhost/>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AccountSkeleton() {
  return (
    <div className="page-content" aria-busy="true" aria-label="Chargement du compte">
      <div className="account-grid" aria-hidden="true">
        <section className="account-section skeleton">
          <h2>Profil</h2>
          <p className="profile-name">Prénom Nom</p>
          <p className="profile-email">prenom.nom@exemple.fr</p>
          <dl className="account-details">
            <div><dt>Adresse</dt><dd>1 rue de la République<small>69002 Lyon · France</small></dd></div>
            <div><dt>Téléphone</dt><dd>06 00 00 00 00</dd></div>
          </dl>
          <span className="button button-secondary"><span className="button-content"><PencilIcon size={17} weight="light"/>Modifier mes coordonnées</span></span>
        </section>
        <section className="account-section skeleton">
          <h2>Abonnement</h2>
          <p className="subscription-name">Vélo’v Plus 1 an</p>
          <p className="subscription-validity">Jusqu’au 1 janvier 2027</p>
          <div className="setting-row renewal-setting"><div><span className="metric-label">Renouvellement automatique</span><strong className="setting-value">Désactivé</strong></div><span className="switch"/></div>
          <div className="receipts">
            <h3 className="metric-label">Reçus</h3>
            <ul>{[0, 1].map((row) => <li className="receipt-row" key={row}><span><strong>Vélo’v Plus 1 an Jeunes</strong><small>Du 1 janv. 2026 au 1 janv. 2027</small></span><span className="button button-secondary"><span className="button-content"><DownloadSimpleIcon size={17} weight="light"/>Reçu</span></span></li>)}</ul>
          </div>
          <span className="text-link">Gérer sur Vélo’v</span>
        </section>
        <section className="account-section skeleton">
          <h2>Service client</h2>
          <div className="account-contact"><span className="button button-secondary"><span className="button-content"><EnvelopeSimpleIcon size={18} weight="light"/>Écrire au service client</span></span></div>
        </section>
      </div>
      <div className="account-logout"><span className="button skeleton" aria-hidden="true"><span className="button-content">Se déconnecter</span></span></div>
    </div>
  );
}
