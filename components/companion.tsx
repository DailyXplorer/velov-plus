"use client";

import "@/lib/zod-jitless";
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { z } from "zod";
import { ArrowClockwiseIcon, BicycleIcon, ChartIcon, HouseIcon, MapPinIcon, SignOutIcon, StarFourIcon, UserCircleIcon, WarningCircleIcon, XIcon } from "./icons";
import { bookingSchema, dashboardSchema, type Booking, type Dashboard, type Page, type Trip, formatDate, formatName } from "@/lib/models";
import { createDockWatch, tripCheckSchema, tripToGreet } from "@/lib/trip-end";
import { createRefreshGate, createThrottle } from "@/lib/refresh-gate";
import { createSessionGate } from "@/lib/session-gate";
import { whenIdle } from "@/lib/idle";
import { type StartMode, guestCookie } from "@/lib/guest";
import { AccountPage, AccountSkeleton, Overview as OverviewPage, OverviewSkeleton, PointsPage, PointsSkeleton, StationsPage as StationsMapPage, StationsSkeleton, TripsPage, TripsSkeleton } from "./dashboard";
import { Button, Modal } from "./ui";
import { Login } from "./login";
import { GuestApp } from "./guest";
import { StatsPage, StatsSkeleton, dropStats, forgetStats } from "./stats";
import { BookingBanner, BookingsContext, UnlockModal } from "./bike-actions";
import { ApiError, getJson } from "./get-json";
import { TripEndedSheet } from "./trip-sheet";
import { useStations } from "./use-stations";

const navigation = [
  { id: "overview", label: "Vue d’ensemble", mobile: "Accueil", icon: HouseIcon },
  { id: "trips", label: "Trajets", mobile: "Trajets", icon: BicycleIcon },
  { id: "stats", label: "Statistiques", mobile: "Stats", icon: ChartIcon },
  { id: "points", label: "Points", mobile: "Points", icon: StarFourIcon },
  { id: "stations", label: "Stations", mobile: "Stations", icon: MapPinIcon },
  { id: "account", label: "Compte", mobile: "Compte", icon: UserCircleIcon }
] satisfies { id: Page; label: string; mobile: string; icon: typeof HouseIcon }[];
const Overview = memo(OverviewPage);
const StationsPage = memo(StationsMapPage);
const mapPages: ReadonlySet<Page> = new Set(["overview", "stations"]);
const skeletons: Record<Page, () => ReactNode> = { overview: OverviewSkeleton, trips: TripsSkeleton, stats: StatsSkeleton, points: PointsSkeleton, stations: StationsSkeleton, account: AccountSkeleton };
const logoutSchema = z.object({ remoteLogout: z.boolean().optional() });
const remoteLogoutUnconfirmed = "Déconnexion effectuée. Vélo’v ne l’a pas encore confirmée.";
type State = { kind: "signedOut"; message: string | null } | { kind: "guest" } | { kind: "loading" } | { kind: "ready"; data: Dashboard } | { kind: "error"; message: string };

function pageFromHash(): Page {
  return navigation.find((item) => item.id === window.location.hash.slice(1))?.id ?? "overview";
}
function navigate(next: Page) {
  window.location.hash = next;
  window.scrollTo({ top: 0, behavior: "auto" });
}
function rememberGuest(on: boolean) {
  document.cookie = guestCookie(on, window.location.protocol === "https:");
}
function subscribeHash(changed: () => void) {
  window.addEventListener("hashchange", changed);
  return () => window.removeEventListener("hashchange", changed);
}

export function Companion({ start }: { start: StartMode }) {
  const [state, setState] = useState<State>(start === "session" ? { kind: "loading" } : start === "guest" ? { kind: "guest" } : { kind: "signedOut", message: null });
  const page = useSyncExternalStore(subscribeHash, pageFromHash, () => null);
  const { resource: stations, pending: stationsPending, inFlight: stationsInFlight, reload: reloadStations } = useStations();
  const [refreshing, setRefreshing] = useState(false);
  const dashboardInFlight = useRef(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [unlocking, setUnlocking] = useState<Booking | null>(null);
  const [ended, setEnded] = useState<Trip | null>(null);
  const watch = useRef<ReturnType<typeof createDockWatch> | null>(null);
  const dockedTrips = useRef(new Set<string>());
  const greeted = useRef(false);
  const refreshGate = useRef(createRefreshGate());
  const session = useRef(createSessionGate());
  const [kept, setKept] = useState(new Set<Page>());
  if (page && mapPages.has(page) && !kept.has(page)) setKept(new Set(kept).add(page));
  const ready = state.kind === "ready";
  useEffect(() => {
    if (ready) return whenIdle(() => setKept(new Set(mapPages)));
  }, [ready]);

  const [loadBookings] = useState(() => createThrottle(async () => {
    const stamp = session.current.stamp();
    const list = await getJson("/api/bookings", z.array(bookingSchema), "", stamp.signal);
    if (stamp.live()) setBookings(list);
  }));
  const account = useMemo(() => ({ bookings, changed: () => { forgetStats(); void loadBookings(); }, unlocked: (tripId: string | null) => watch.current?.follow(tripId) }), [bookings, loadBookings]);

  const patchData = useCallback((change: (data: Dashboard) => Dashboard) => {
    setState((current) => current.kind === "ready" ? { kind: "ready", data: change(current.data) } : current);
  }, []);
  const setAutoSpend = useCallback((autoSpend: boolean) => patchData((data) => ({ ...data, rewards: { ...data.rewards, autoSpend } })), [patchData]);
  const setFavorite = useCallback((number: number, favorite: boolean) => patchData((data) => {
    const others = data.profile.favorites.filter((item) => item !== number);
    return { ...data, profile: { ...data.profile, favorites: favorite ? [...others, number] : others } };
  }), [patchData]);

  const loadDashboard = useCallback(async (): Promise<Dashboard | null> => {
    if (dashboardInFlight.current) return null;
    const stamp = session.current.stamp();
    if (!stamp.live()) return null;
    dashboardInFlight.current = true;
    setRefreshing(true);
    try {
      const data = await getJson("/api/dashboard", dashboardSchema, "Votre compte est momentanément indisponible.", stamp.signal);
      if (!stamp.live()) return null;
      setState({ kind: "ready", data });
      return data;
    } catch (error) {
      if (!stamp.live()) return null;
      if (error instanceof ApiError && error.status === 401) setState({ kind: "signedOut", message: "Votre session a expiré. Reconnectez-vous." });
      else setState({ kind: "error", message: error instanceof ApiError ? error.message : "Votre compte est momentanément indisponible." });
      return null;
    } finally {
      dashboardInFlight.current = false;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const current = createDockWatch({
      check: () => {
        const stamp = session.current.stamp();
        return getJson("/api/trips/current", tripCheckSchema, "", stamp.signal).catch((error: unknown) => {
          if (stamp.live() && error instanceof ApiError && error.status === 401) setState({ kind: "signedOut", message: "Session expirée. Reconnectez-vous." });
          throw error;
        });
      },
      docked: (tripId, latest) => {
        dockedTrips.current.add(tripId);
        forgetStats();
        void loadDashboard().then((data) => {
          const trip = data?.trips?.find((item) => item.id === tripId) ?? (latest?.id === tripId ? latest : null);
          if (trip) setEnded(trip);
        });
      },
      visible: () => document.visibilityState === "visible"
    });
    watch.current = current;
    const changed = () => current.visibilityChanged();
    document.addEventListener("visibilitychange", changed);
    return () => { document.removeEventListener("visibilitychange", changed); current.stop(); watch.current = null; };
  }, [loadDashboard]);

  useEffect(() => {
    if (state.kind === "signedOut") { watch.current?.stop(); return; }
    if (state.kind !== "ready") return;
    const trip = state.data.ongoing?.find((item) => !dockedTrips.current.has(item.id));
    if (trip) watch.current?.follow(trip.id);
    if (greeted.current) return;
    greeted.current = true;
    if (!state.data.ongoing?.length && state.data.trips) {
      try { const recent = tripToGreet(state.data.trips, localStorage); if (recent) setEnded(recent); } catch {}
    }
  }, [state]);

  useEffect(() => {
    const changed = () => window.scrollTo({ top: 0, behavior: "auto" });
    window.addEventListener("hashchange", changed);
    if (start === "session") { void loadDashboard(); reloadStations(); void loadBookings(); }
    return () => window.removeEventListener("hashchange", changed);
  }, [start, loadDashboard, reloadStations, loadBookings]);

  function continueAsGuest() {
    rememberGuest(true);
    setState({ kind: "guest" });
  }

  function signIn() {
    rememberGuest(false);
    setState({ kind: "signedOut", message: null });
  }

  function connected() {
    session.current.end();
    forgetStats();
    setState({ kind: "loading" });
    dashboardInFlight.current = false;
    void loadDashboard();
    reloadStations();
    void loadBookings();
    rememberGuest(false);
  }

  function refreshAll() {
    if (!refreshGate.current(dashboardInFlight.current || stationsInFlight.current)) return;
    forgetStats();
    void loadDashboard(); reloadStations(); void loadBookings();
  }

  function openLogout() { setLogoutError(null); setLogoutOpen(true); }

  async function logout() {
    session.current.close();
    watch.current?.stop();
    setLoggingOut(true);
    setLogoutError(null);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", signal: AbortSignal.timeout(25_000) });
      if (!response.ok) throw new Error("Déconnexion impossible.");
      const answer = logoutSchema.safeParse(await response.json().catch(() => null));
      session.current.close();
      watch.current?.stop();
      setLogoutOpen(false);
      setBookings([]);
      dropStats();
      setState({ kind: "signedOut", message: answer.success && answer.data.remoteLogout === false ? remoteLogoutUnconfirmed : null });
      window.location.hash = "";
    } catch {
      session.current.end();
      setLogoutError("Déconnexion impossible. Réessayez.");
      void loadDashboard();
    } finally {
      setLoggingOut(false);
    }
  }

  if (state.kind === "guest") return <GuestApp onSignIn={signIn}/>;
  if (state.kind === "signedOut") return (
    <>
      {state.message ? <p className="session-notice" role="status">{state.message}</p> : null}
      <Login onConnected={connected} onGuest={continueAsGuest}/>
    </>
  );

  const data = state.kind === "ready" ? state.data : null;
  const name = data ? formatName(`${data.profile.firstName} ${data.profile.lastName}`) : "";
  const initial = data ? formatName(data.profile.firstName).charAt(0) || null : null;
  const label = page ? navigation.find((item) => item.id === page)?.label : "\u00a0";
  const PageSkeleton = page ? skeletons[page] : () => null;

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
            <button className="sidebar-user" aria-label={name ? `Compte de ${name}` : "Compte"} title={name || undefined} onClick={() => navigate("account")}>
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
                aria-label="Actualiser mon compte" onClick={refreshAll} disabled={refreshing}>
                <ArrowClockwiseIcon className={refreshing ? "spin" : ""} size={20} weight="light"/>
              </button>
              <button className="user-avatar" onClick={() => navigate("account")} aria-label={name ? `Mon compte, ${name}` : "Mon compte"} title={name || undefined}>{initial ?? <UserCircleIcon size={22} weight="light" aria-hidden="true"/>}</button>
            </div>
          </header>
          <main id="main-content" className="main-content">
            {bookings.map((booking) => <BookingBanner key={booking.id} booking={booking} onUnlock={() => setUnlocking(booking)}/>)}
            {state.kind === "loading" ? <PageSkeleton/> : state.kind === "error" ? (
              <div className="dashboard-error">
                <p role="alert">{state.message}</p>
                <Button variant="secondary" pending={refreshing} onClick={() => void loadDashboard()}>Réessayer</Button>
              </div>
            ) : (
              <>
                {state.data.warnings.length ? (
                  <details className="data-notice">
                    <summary><WarningCircleIcon size={17} weight="light"/>Certaines informations sont indisponibles</summary>
                    <ul>{state.data.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                  </details>
                ) : null}
                {kept.has("overview") ? <div className="page-slot" hidden={page !== "overview"}><Overview data={state.data} stations={stations} navigate={navigate} reload={reloadStations} reloading={stationsPending}/></div> : null}
                {kept.has("stations") ? <div className="page-slot" hidden={page !== "stations"}><StationsPage resource={stations} reload={reloadStations} reloading={stationsPending} favorites={state.data.profile.favorites} account={state.data.profile.email} onFavorite={setFavorite}/></div> : null}
                {page === "trips" ? <TripsPage data={state.data}/>
                    : page === "stats" ? <StatsPage account={state.data.profile.email}/>
                    : page === "points" ? <PointsPage data={state.data} onAutoSpend={setAutoSpend} onChanged={() => { forgetStats(); void loadDashboard(); }}/>
                      : page === "account" ? <AccountPage data={state.data} onLogout={openLogout} onSaved={() => void loadDashboard()}/> : null}
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
              <h2 id="logout-title">Se déconnecter ?</h2>
              <button className="icon-button" aria-label="Fermer" onClick={() => setLogoutOpen(false)}><XIcon size={20} weight="light"/></button>
            </div>
            {logoutError ? <p className="form-error" role="alert">{logoutError}</p> : null}
            <div className="modal-actions">
              <Button variant="ghost" disabled={loggingOut} onClick={() => setLogoutOpen(false)}>Annuler</Button>
              <Button pending={loggingOut} onClick={() => void logout()}>Se déconnecter</Button>
            </div>
          </Modal>
        ) : null}
        {unlocking ? <UnlockModal booking={unlocking} onClose={() => setUnlocking(null)}/> : null}
        {ended ? <TripEndedSheet trip={ended} onClose={() => setEnded(null)}/> : null}
      </div>
    </BookingsContext.Provider>
  );
}

