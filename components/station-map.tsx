"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Station } from "@/lib/models";

export default function StationMap({ stations, selected, onSelect }: { stations: Station[]; selected: string | null; onSelect: (id: string) => void }) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef<Map<string, L.Marker>>(new Map());
  const select = useRef(onSelect);
  select.current = onSelect;

  useEffect(() => {
    if (!element.current) return;
    const instance = L.map(element.current, { center: [45.7576, 4.832], zoom: 15, zoomControl: false, scrollWheelZoom: false });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19 }).addTo(instance);
    L.control.zoom({ position: "topright" }).addTo(instance);
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
    const station = stations.find((station) => station.id === selected);
    if (station && map.current) map.current.panTo([station.lat, station.lon], { animate: !window.matchMedia("(prefers-reduced-motion: reduce)").matches, duration: 0.5 });
  }, [selected, stations]);

  return <div className="station-map" ref={element} role="region" aria-label="Carte des stations Vélo’v de Lyon"/>;
}
