"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { HouseIcon } from "@phosphor-icons/react/dist/csr/House";
import { PersonSimpleBikeIcon as BicycleIcon } from "@phosphor-icons/react/dist/csr/PersonSimpleBike";
import { StarFourIcon } from "@phosphor-icons/react/dist/csr/StarFour";
import { MapPinIcon } from "@phosphor-icons/react/dist/csr/MapPin";
import { UserCircleIcon } from "@phosphor-icons/react/dist/csr/UserCircle";
import { SignOutIcon } from "@phosphor-icons/react/dist/csr/SignOut";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { bookingSchema, dashboardSchema, stationsSchema, type Booking, type Dashboard, type Page, type Resource, formatDate } from "@/lib/models";
import { AccountPage, Overview, PointsPage, StationsPage, TripsPage } from "./dashboard";
import { Button, Modal } from "./ui";
import { Login } from "./login";
import { BookingBanner, BookingsContext, UnlockModal } from "./bike-actions";
import { ApiError, getJson } from "./get-json";

const navigation = [
  { id: "overview", label: "Vue d’ensemble", mobile: "Accueil", icon: HouseIcon },
  { id: "trips", label: "Trajets", mobile: "Trajets", icon: BicycleIcon },
  { id: "points", label: "Points", mobile: "Points", icon: StarFourIcon },
  { id: "stations", label: "Stations", mobile: "Stations", icon: MapPinIcon },
  { id: "account", label: "Compte", mobile: "Compte", icon: UserCircleIcon }
] satisfies { id: Page; label: string; mobile: string; icon: typeof HouseIcon }[];
const logoutSchema = z.object({ remoteLogout: z.boolean().optional() });
const remoteLogoutUnconfirmed = "Déconnecté ici, mais Vélo’v n’a pas confirmé la fin de session.";
type State = { kind: "guest"; message: string | null } | { kind: "loading" } | { kind: "ready"; data: Dashboard } | { kind: "error"; message: string };
type StationData = z.infer<typeof stationsSchema>;

function pageFromHash(): Page {
  return navigation.find((item) => item.id === window.location.hash.slice(1))?.id ?? "overview";
}

export function Companion({ initialSession }: { initialSession: boolean }) {
  const [state, setState] = useState<State>(initialSession ? { kind: "loading" } : { kind: "guest", message: null });
  const [page, setPage] = useState<Page>("overview");
  const [stations, setStations] = useState<Resource<StationData>>({ kind: "loading" });
  const [stationsPending, setStationsPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // One load of each at a time: a second click or a retry joins nothing and sends nothing.
  const dashboardInFlight = useRef(false);
  const stationsInFlight = useRef(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [unlocking, setUnlocking] = useState<Booking | null>(null);

  // Read-only and best effort: without it the app only misses the booking banner.
  const loadBookings = useCallback(async () => {
    try { setBookings(await getJson("/api/bookings", z.array(bookingSchema), "")); }
    catch { /* Keep the last known bookings. */ }
  }, []);
  const account = useMemo(() => ({ bookings, changed: () => void loadBookings() }), [bookings, loadBookings]);

  const loadStations = useCallback(async () => {
    if (stationsInFlight.current) return;
    stationsInFlight.current = true;
    setStationsPending(true);
    try {
      setStations({ kind: "ready", data: await getJson("/api/stations", stationsSchema, "Stations indisponibles.") });
    } catch (error) {
      setStations({ kind: "error", message: error instanceof ApiError ? error.message : "Stations indisponibles." });
    } finally {
      stationsInFlight.current = false;
      setStationsPending(false);
    }
  }, []);

  // An account write that succeeded: its effect is applied here instead of reading the whole account again.
  const patchData = useCallback((change: (data: Dashboard) => Dashboard) => {
    setState((current) => current.kind === "ready" ? { kind: "ready", data: change(current.data) } : current);
  }, []);
  const setAutoSpend = useCallback((autoSpend: boolean) => patchData((data) => ({ ...data, rewards: { ...data.rewards, autoSpend } })), [patchData]);
  const setFavorite = useCallback((number: number, favorite: boolean) => patchData((data) => {
    const others = data.profile.favorites.filter((item) => item !== number);
    return { ...data, profile: { ...data.profile, favorites: favorite ? [...others, number] : others } };
  }), [patchData]);

  const loadDashboard = useCallback(async () => {
    if (dashboardInFlight.current) return;
    dashboardInFlight.current = true;
    setRefreshing(true);
    try {
      setState({ kind: "ready", data: await getJson("/api/dashboard", dashboardSchema, "Compte indisponible.") });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setState({ kind: "guest", message: "Session expirée. Reconnectez-vous." });
      else setState({ kind: "error", message: error instanceof ApiError ? error.message : "Compte indisponible." });
    } finally {
      dashboardInFlight.current = false;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setPage(pageFromHash());
    const changed = () => { setPage(pageFromHash()); window.scrollTo({ top: 0, behavior: "auto" }); };
    window.addEventListener("hashchange", changed);
    if (initialSession) { void loadDashboard(); void loadStations(); void loadBookings(); }
    return () => window.removeEventListener("hashchange", changed);
  }, [initialSession, loadDashboard, loadStations, loadBookings]);

  function navigate(next: Page) {
    setPage(next);
    window.location.hash = next;
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function connected() {
    setState({ kind: "loading" });
    void loadDashboard();
    void loadStations();
    void loadBookings();
  }

  function openLogout() { setLogoutError(null); setLogoutOpen(true); }

  async function logout() {
    setLoggingOut(true);
    setLogoutError(null);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", signal: AbortSignal.timeout(25_000) });
      if (!response.ok) throw new Error("Déconnexion impossible.");
      const answer = logoutSchema.safeParse(await response.json().catch(() => null));
      setLogoutOpen(false);
      setBookings([]);
      setState({ kind: "guest", message: answer.success && answer.data.remoteLogout === false ? remoteLogoutUnconfirmed : null });
      window.location.hash = "";
    } catch {
      setLogoutError("Déconnexion impossible. Réessayez.");
    } finally {
      setLoggingOut(false);
    }
  }

  if (state.kind === "guest") return (
    <>
      {state.message ? <p className="session-notice" role="status">{state.message}</p> : null}
      <Login onConnected={connected}/>
    </>
  );

  const data = state.kind === "ready" ? state.data : null;
  const initial = data?.profile.firstName ? data.profile.firstName.slice(0, 1).toUpperCase() : null;
  const label = navigation.find((item) => item.id === page)?.label ?? "Vue d’ensemble";

  return (
    <BookingsContext.Provider value={account}>
      <div className="app-layout">
        <a className="skip-link" href="#main-content">Aller au contenu</a>
        <aside className="sidebar">
          <nav className="main-navigation" aria-label="Navigation principale">
            {navigation.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.id} className={`nav-link ${page === item.id ? "active" : ""}`}
                  aria-current={page === item.id ? "page" : undefined} onClick={() => navigate(item.id)}>
                  <Icon size={21} weight="light" aria-hidden="true"/>{item.label}
                </button>
              );
            })}
          </nav>
          <div className="sidebar-bottom">
            <button className="sidebar-user" aria-label="Compte" onClick={() => navigate("account")}>
              <UserCircleIcon size={22} weight="light" aria-hidden="true"/>
            </button>
            <button className="icon-button" aria-label="Se déconnecter" onClick={openLogout}>
              <SignOutIcon size={20} weight="light"/>
            </button>
          </div>
        </aside>
        <div className="app-main">
          <header className="app-header">
            <h1>{label}</h1>
            <div className="header-actions">
              <button className="icon-button" title={data ? `Actualisé à ${formatDate(data.updatedAt, { hour: "2-digit", minute: "2-digit" })}` : "Actualiser"}
                aria-label="Actualiser mon compte" onClick={() => { void loadDashboard(); void loadStations(); void loadBookings(); }} disabled={refreshing}>
                <ArrowClockwiseIcon className={refreshing ? "spin" : ""} size={20} weight="light"/>
              </button>
              <button className="user-avatar" onClick={() => navigate("account")} aria-label="Mon compte">{initial ?? <UserCircleIcon size={22} weight="light" aria-hidden="true"/>}</button>
            </div>
          </header>
          <main id="main-content" className="main-content">
            {bookings.map((booking) => <BookingBanner key={booking.id} booking={booking} onUnlock={() => setUnlocking(booking)}/>)}
            {state.kind === "loading" ? <DashboardSkeleton/> : state.kind === "error" ? (
              <div className="dashboard-error">
                <p role="alert">{state.message}</p>
                <Button variant="secondary" pending={refreshing} onClick={() => void loadDashboard()}>Réessayer</Button>
              </div>
            ) : (
              <>
                {state.data.warnings.length ? (
                  <details className="data-notice">
                    <summary><WarningCircleIcon size={17} weight="light"/>Informations indisponibles</summary>
                    <ul>{state.data.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                  </details>
                ) : null}
                {page === "overview" ? <Overview data={state.data} stations={stations} navigate={navigate} reload={() => void loadStations()} reloading={stationsPending}/>
                  : page === "trips" ? <TripsPage data={state.data}/>
                    : page === "points" ? <PointsPage data={state.data} onAutoSpend={setAutoSpend} onChanged={() => void loadDashboard()}/>
                      : page === "stations" ? <StationsPage resource={stations} reload={() => void loadStations()} reloading={stationsPending} favorites={state.data.profile.favorites} onFavorite={setFavorite}/>
                        : <AccountPage data={state.data} onLogout={openLogout} onSaved={() => void loadDashboard()}/>}
              </>
            )}
          </main>
        </div>
        <nav className="mobile-navigation" aria-label="Navigation mobile">
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={page === item.id ? "active" : ""}
                aria-current={page === item.id ? "page" : undefined} onClick={() => navigate(item.id)}>
                <Icon size={22} weight="light" aria-hidden="true"/><span>{item.mobile}</span>
              </button>
            );
          })}
        </nav>
        {logoutOpen ? (
          <Modal titleId="logout-title" onClose={() => setLogoutOpen(false)}>
            <div className="modal-heading">
              <h2 id="logout-title">Se déconnecter ?</h2>
              <button className="icon-button" aria-label="Fermer" onClick={() => setLogoutOpen(false)}><XIcon size={20} weight="light"/></button>
            </div>
            {logoutError ? <p className="form-error" role="alert">{logoutError}</p> : null}
            <div className="modal-actions">
              <Button variant="secondary" onClick={() => setLogoutOpen(false)}>Annuler</Button>
              <Button pending={loggingOut} onClick={() => void logout()}>Se déconnecter</Button>
            </div>
          </Modal>
        ) : null}
        {unlocking ? <UnlockModal booking={unlocking} onClose={() => setUnlocking(null)}/> : null}
      </div>
    </BookingsContext.Provider>
  );
}

function DashboardSkeleton() {
  return (
    <div className="dashboard-skeleton" aria-label="Chargement du compte" aria-busy="true">
      <div className="summary-grid">{[0, 1, 2].map((item) => <div className="skeleton skeleton-card" key={item}/>)}</div>
      <div className="skeleton skeleton-map"/>
    </div>
  );
}

