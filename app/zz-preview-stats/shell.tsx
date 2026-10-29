"use client";

import { BicycleIcon, ChartIcon, HouseIcon, MapPinIcon, StarFourIcon, UserCircleIcon } from "@/components/icons";
import { StatsView } from "@/components/stats";
import type { Stats } from "@/lib/stats";

const navigation = [["Vue d’ensemble", "Accueil", HouseIcon], ["Trajets", "Trajets", BicycleIcon], ["Statistiques", "Stats", ChartIcon], ["Points", "Points", StarFourIcon], ["Stations", "Stations", MapPinIcon], ["Compte", "Compte", UserCircleIcon]] as const;

export function PreviewShell({ stats }: { stats: Stats }) {
  return (
    <div className="app-layout">
      <aside className="sidebar"><nav className="main-navigation">{navigation.map(([label, , Icon]) => <button key={label} className={`nav-link ${label === "Statistiques" ? "active" : ""}`}><Icon size={21} weight="light" aria-hidden="true"/>{label}</button>)}</nav></aside>
      <div className="app-main">
        <header className="app-header"><h1>Statistiques</h1></header>
        <main className="main-content"><StatsView stats={stats}/></main>
      </div>
      <nav className="mobile-navigation">{navigation.map(([label, mobile, Icon]) => <button key={label} className={label === "Statistiques" ? "active" : ""}><Icon size={22} weight="light" aria-hidden="true"/><span>{mobile}</span></button>)}</nav>
    </div>
  );
}
