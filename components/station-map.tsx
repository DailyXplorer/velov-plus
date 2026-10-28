"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Point } from "@/lib/geo";
import type { Station } from "@/lib/models";

export type UserPosition = Point & { accuracy: number };

type StationMapProps = {
  stations: Station[];
  selected: string | null;
  onSelect: (id: string) => void;
  /** Tap on the map background (not a pin). */
  onClear?: () => void;
  userPosition?: UserPosition | null;
  /** Points to frame; a new array reference refits the view. */
  fit?: Point[] | null;
};

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function StationMap({ stations, selected, onSelect, onClear, userPosition, fit }: StationMapProps) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef<Map<string, L.Marker>>(new Map());
  const select = useRef(onSelect);
  select.current = onSelect;
  const clear = useRef(onClear);
  clear.current = onClear;

  useEffect(() => {
    if (!element.current) return;
    const instance = L.map(element.current, { center: [45.7576, 4.832], zoom: 15, zoomControl: false, scrollWheelZoom: false });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19 }).addTo(instance);
    L.control.zoom({ position: "topright" }).addTo(instance);
    instance.on("click", () => clear.current?.());
    map.current = instance;
    const observer = new ResizeObserver(() => instance.invalidateSize());
    observer.observe(element.current);
    return () => { observer.disconnect(); instance.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    for (const marker of markers.current.values()) marker.remove();
    markers.current.clear();
    for (const station of stations) {
      if (!station.open) continue;
      const total = station.mechanical + station.electrical;
      const icon = L.divIcon({ className: "station-pin-wrap", html: `<span class="station-pin${total === 0 ? " station-pin-empty" : ""}${selected === station.id ? " station-pin-selected" : ""}">${total}</span>`, iconSize: [34, 34], iconAnchor: [17, 17] });
      const marker = L.marker([station.lat, station.lon], { icon, title: `${station.name}, ${total} vélos`, keyboard: true }).addTo(instance);
      marker.on("click", () => select.current(station.id));
      markers.current.set(station.id, marker);
    }
  }, [stations, selected]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !userPosition) return;
    const center: L.LatLngTuple = [userPosition.lat, userPosition.lon];
    const accuracy = L.circle(center, { radius: userPosition.accuracy, interactive: false, stroke: true, weight: 1, color: "#df2537", opacity: .25, fillColor: "#df2537", fillOpacity: .06 }).addTo(instance);
    const dot = L.marker(center, { icon: L.divIcon({ className: "user-position", html: "<span></span>", iconSize: [22, 22], iconAnchor: [11, 11] }), interactive: false, keyboard: false, zIndexOffset: 1000, title: "Votre position" }).addTo(instance);
    return () => { accuracy.remove(); dot.remove(); };
  }, [userPosition]);

  useEffect(() => {
    const station = stations.find((station) => station.id === selected);
    if (station && map.current) map.current.panTo([station.lat, station.lon], { animate: !reducedMotion(), duration: 0.5 });
  }, [selected, stations]);

  // Declared after the pan effect so a refit triggered alongside a selection wins (setView stops the pan).
  useEffect(() => {
    const instance = map.current;
    if (!instance || !fit?.length) return;
    const height = instance.getSize().y;
    instance.fitBounds(L.latLngBounds(fit.map((point): L.LatLngTuple => [point.lat, point.lon])),
      { paddingTopLeft: [40, 56], paddingBottomRight: [40, Math.round(height * .42)], maxZoom: 17, animate: !reducedMotion() });
  }, [fit]);

  return <div className="station-map" ref={element} role="region" aria-label="Carte des stations Vélo’v de Lyon"/>;
}
