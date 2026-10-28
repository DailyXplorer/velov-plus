"use client";

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { HouseIcon } from "@phosphor-icons/react/dist/csr/House";
import { BicycleIcon } from "@phosphor-icons/react/dist/csr/Bicycle";
import { StarFourIcon } from "@phosphor-icons/react/dist/csr/StarFour";
import { MapPinIcon } from "@phosphor-icons/react/dist/csr/MapPin";
import { UserCircleIcon } from "@phosphor-icons/react/dist/csr/UserCircle";
import { SignOutIcon } from "@phosphor-icons/react/dist/csr/SignOut";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { dashboardSchema, stationsSchema, type Dashboard, type Page, type Resource, formatDate } from "@/lib/models";
import { AccountPage, Overview, PointsPage, StationsPage, TripsPage } from "./dashboard";
import { Brand, Button, Modal } from "./ui";
import { Login } from "./login";

const navigation = [
  { id: "overview", label: "Vue d’ensemble", mobile: "Accueil", icon: HouseIcon },
  { id: "trips", label: "Trajets", mobile: "Trajets", icon: BicycleIcon },
  { id: "points", label: "Points", mobile: "Points", icon: StarFourIcon },
  { id: "stations", label: "Stations", mobile: "Stations", icon: MapPinIcon },
  { id: "account", label: "Compte", mobile: "Compte", icon: UserCircleIcon }
] satisfies { id: Page; label: string; mobile: string; icon: typeof HouseIcon }[];
const errorSchema = z.object({ error: z.string(), code: z.string().optional() });
type State = { kind: "guest"; message: string | null } | { kind: "loading" } | { kind: "ready"; data: Dashboard } | { kind: "error"; message: string };
type StationData = z.infer<typeof stationsSchema>;

function pageFromHash(): Page {
  return navigation.find((item) => item.id === window.location.hash.slice(1))?.id ?? "overview";
}

export function Companion({ initialSession }: { initialSession: boolean }) {
  const [state, setState] = useState<State>(initialSession ? { kind: "loading" } : { kind: "guest", message: null });
  const [page, setPage] = useState<Page>("overview");
  const [stations, setStations] = useState<Resource<StationData>>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  const loadStations = useCallback(async () => {
    try {
      const response = await fetch("/api/stations", { cache: "no-store" });
      const raw: unknown = await response.json();
      if (!response.ok) {
        const error = errorSchema.safeParse(raw);
        throw new Error(error.success ? error.data.error : "Stations indisponibles.");
      }
      const parsed = stationsSchema.safeParse(raw);
      if (!parsed.success) throw new Error("Stations indisponibles.");
      setStations({ kind: "ready", data: parsed.data });
    } catch (error) {
      setStations({ kind: "error", message: error instanceof Error ? error.message : "Stations indisponibles." });
    }
  }, []);

  const loadDashboard = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      const raw: unknown = await response.json();
      if (response.status === 401) {
        setState({ kind: "guest", message: "Session expirée. Reconnectez-vous." });
        return;
      }
      if (!response.ok) {
        const error = errorSchema.safeParse(raw);
        throw new Error(error.success ? error.data.error : "Compte indisponible.");
      }
      const parsed = dashboardSchema.safeParse(raw);
      if (!parsed.success) throw new Error("Compte indisponible.");
      setState({ kind: "ready", data: parsed.data });
    } catch (error) {
      setState({ kind: "error", message: error instanceof Error ? error.message : "Compte indisponible." });
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setPage(pageFromHash());
    const changed = () => setPage(pageFromHash());
    window.addEventListener("hashchange", changed);
    if (initialSession) { void loadDashboard(); void loadStations(); }
    return () => window.removeEventListener("hashchange", changed);
  }, [initialSession, loadDashboard, loadStations]);

  function navigate(next: Page) {
    setPage(next);
    window.location.hash = next;
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function connected() {
    setState({ kind: "loading" });
    void loadDashboard();
    void loadStations();
  }

  function openLogout() { setLogoutError(null); setLogoutOpen(true); }

  async function logout() {
    setLoggingOut(true);
    setLogoutError(null);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Déconnexion impossible.");
      setLogoutOpen(false);
      setState({ kind: "guest", message: null });
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
  const name = data?.profile.firstName || "Compte";
  const initial = name.slice(0, 1).toUpperCase();
  const label = navigation.find((item) => item.id === page)?.label ?? "Vue d’ensemble";

  return (
    <div className="app-layout">
      <a className="skip-link" href="#main-content">Aller au contenu</a>
      <aside className="sidebar">
        <Brand/>
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
          <button className="sidebar-user" onClick={() => navigate("account")}>
            <UserCircleIcon size={22} weight="light" aria-hidden="true"/><span>{name}</span>
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
              aria-label="Actualiser mon compte" onClick={() => { void loadDashboard(); void loadStations(); }} disabled={refreshing}>
              <ArrowClockwiseIcon className={refreshing ? "spin" : ""} size={20} weight="light"/>
            </button>
            <button className="user-avatar" onClick={() => navigate("account")} aria-label="Mon compte">{initial}</button>
          </div>
        </header>
        <main id="main-content" className="main-content">
          {state.kind === "loading" ? <DashboardSkeleton/> : state.kind === "error" ? (
            <div className="dashboard-error">
              <p role="alert">{state.message}</p>
              <Button variant="secondary" onClick={() => void loadDashboard()}>Réessayer</Button>
            </div>
          ) : (
            <>
              {state.data.warnings.length ? (
                <details className="data-notice">
                  <summary><WarningCircleIcon size={17} weight="light"/>Informations indisponibles</summary>
                  <ul>{state.data.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                </details>
              ) : null}
              {page === "overview" ? <Overview data={state.data} stations={stations} navigate={navigate}/>
                : page === "trips" ? <TripsPage data={state.data}/>
                  : page === "points" ? <PointsPage data={state.data}/>
                    : page === "stations" ? <StationsPage resource={stations} reload={() => void loadStations()}/>
                      : <AccountPage data={state.data} onLogout={openLogout}/>}
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
    </div>
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
