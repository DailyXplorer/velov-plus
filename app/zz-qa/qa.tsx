"use client";

import { useEffect, useState } from "react";
import { Companion } from "@/components/companion";
import type { Page } from "@/lib/models";
import { bike, bikes, booking, dashboard, stats, stations, trips } from "./fake";

type Setup = { page: Page; login?: boolean; hang?: boolean; hangBikes?: boolean; booked?: boolean; ongoing?: boolean; greet?: boolean; uncertain?: boolean };

const screens: Record<string, Setup> = {
  login: { page: "overview", login: true },
  overview: { page: "overview" },
  "overview-booking": { page: "overview", booked: true },
  "overview-ongoing": { page: "overview", ongoing: true },
  "banner-unlock": { page: "overview", booked: true },
  stations: { page: "stations" },
  "stations-long": { page: "stations" },
  "stations-search": { page: "stations" },
  "favorite-confirm": { page: "stations" },
  bikes: { page: "stations" },
  "bikes-skeleton": { page: "stations", hangBikes: true },
  bike: { page: "stations" },
  "book-confirm": { page: "stations" },
  "unlock-confirm": { page: "stations" },
  uncertain: { page: "stations", uncertain: true },
  trips: { page: "trips" },
  trip: { page: "trips" },
  "trip-details": { page: "trips" },
  "trip-ended": { page: "overview", greet: true },
  "trip-ended-stars": { page: "overview", greet: true },
  points: { page: "points" },
  account: { page: "account" },
  "account-edit": { page: "account" },
  logout: { page: "account" },
  stats: { page: "stats" },
  "stats-tip-first": { page: "stats" },
  "stats-tip-last": { page: "stats" },
  "stats-tip-heat": { page: "stats" },
  "stats-tip-donut": { page: "stats" },
  "stats-bike": { page: "stats" },
  "overview-skeleton": { page: "overview", hang: true },
  "trips-skeleton": { page: "trips", hang: true },
  "stats-skeleton": { page: "stats", hang: true },
  "points-skeleton": { page: "points", hang: true },
  "stations-skeleton": { page: "stations", hang: true },
  "account-skeleton": { page: "account", hang: true }
};

const never = () => new Promise<Response>(() => {});

function install(setup: Setup) {
  const json = (body: unknown, status = 200) => Promise.resolve(Response.json(body, { status }));
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.origin);
    const path = url.pathname;
    const method = init?.method ?? "GET";
    if (path === "/api/dashboard") return setup.hang ? never() : json(dashboard(setup.ongoing));
    if (path === "/api/stations") return setup.hang ? never() : json({ stations, updatedAt: new Date().toISOString() });
    if (path === "/api/bookings" && method === "GET") return json(setup.booked ? [booking()] : []);
    if (path === "/api/stats") return setup.hang ? never() : json(stats());
    if (path === "/api/trips/current") return json({ ongoing: setup.ongoing ? dashboard(true).ongoing : [], latest: trips()[0] });
    if (/^\/api\/stations\/\d+\/bikes$/.test(path)) return setup.hangBikes ? never() : json(bikes());
    const bikeMatch = /^\/api\/bikes\/(\d+)$/.exec(path);
    if (bikeMatch) return json(bike(Number(bikeMatch[1])));
    if (path === "/api/unlock" || path === "/api/bookings") return setup.uncertain ? json({ error: "Vélo’v ne répond pas." }, 504) : never();
    return never();
  };
}

export function Qa({ screen }: { screen: string }) {
  const setup = screens[screen] ?? screens.overview;
  const [ready, setReady] = useState(false);
  useEffect(() => {
    localStorage.clear();
    if (!setup.greet) localStorage.setItem(`velov:trip-ended:v1:${trips()[0].id}`, "1");
    install(setup);
    window.location.hash = setup.page;
    setReady(true);
  }, [setup]);
  return ready ? <Companion initialSession={!setup.login}/> : null;
}
