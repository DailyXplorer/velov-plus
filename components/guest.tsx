"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowClockwiseIcon, MapPinIcon, SignInIcon } from "./icons";
import { readFavorites, saveFavorites, toggleFavorite } from "@/lib/guest";
import { StationsPage } from "./dashboard";
import { SignInContext } from "./bike-actions";
import { Button } from "./ui";
import { useStations } from "./use-stations";

export function GuestApp({ onSignIn }: { onSignIn: () => void }) {
  const { resource, pending, reload } = useStations();
  const [favorites, setFavorites] = useState<number[]>([]);
  useEffect(() => {
    reload();
    setFavorites(readFavorites(window.localStorage));
  }, [reload]);
  const favorite = useCallback((number: number, on: boolean) => setFavorites((list) => {
    const next = toggleFavorite(list, number, on);
    saveFavorites(window.localStorage, next);
    return next;
  }), []);

  return (
    <SignInContext.Provider value={onSignIn}>
      <div className="app-layout guest-layout">
        <a className="skip-link" href="#main-content">Aller au contenu</a>
        <aside className="sidebar">
          <nav className="main-navigation" aria-label="Navigation principale">
            <button className="nav-link active" aria-current="page"><MapPinIcon size={21} weight="light" aria-hidden="true"/>Stations</button>
          </nav>
        </aside>
        <div className="app-main">
          <header className="app-header">
            <h1>Stations</h1>
            <div className="header-actions">
              <button className="icon-button" title="Actualiser" aria-label="Actualiser les stations" onClick={reload} disabled={pending}>
                <ArrowClockwiseIcon className={pending ? "spin" : ""} size={20} weight="light"/>
              </button>
              <Button variant="ghost" className="header-signin" onClick={onSignIn}><SignInIcon size={19} weight="light" aria-hidden="true"/>Se connecter</Button>
            </div>
          </header>
          <main id="main-content" className="main-content">
            <StationsPage resource={resource} reload={reload} reloading={pending} favorites={favorites} account={null} onFavorite={favorite}/>
          </main>
        </div>
      </div>
    </SignInContext.Provider>
  );
}
