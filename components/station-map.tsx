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
  onClear?: () => void;
  userPosition?: UserPosition | null;
  fit?: Point[] | null;
};

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const icons = new Map<string, L.DivIcon>();
function pinIcon(total: number, selected: boolean) {
  const key = `${total}:${selected}`;
  let icon = icons.get(key);
  if (!icon) {
    icon = L.divIcon({ className: "station-pin-wrap", html: `<span class="station-pin${total === 0 ? " station-pin-empty" : ""}${selected ? " station-pin-selected" : ""}">${total}</span>`, iconSize: [34, 34], iconAnchor: [17, 17] });
    icons.set(key, icon);
  }
  return icon;
}

export default function StationMap({ stations, selected, onSelect, onClear, userPosition, fit }: StationMapProps) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef<Map<string, { marker: L.Marker; total: number }>>(new Map());
  const select = useRef(onSelect);
  select.current = onSelect;
  const clear = useRef(onClear);
  clear.current = onClear;
  const current = useRef({ stations, selected });
  current.current = { stations, selected };
  const shown = useRef<string | null>(null);

  useEffect(() => {
    if (!element.current) return;
    const instance = L.map(element.current, { center: [45.7576, 4.832], zoom: 15, zoomControl: false, scrollWheelZoom: true, wheelPxPerZoomLevel: 90 });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19 }).addTo(instance);
    L.control.zoom({ position: "topright" }).addTo(instance);
    instance.on("click", () => clear.current?.());
    map.current = instance;
    const host = element.current;
    const hint = document.createElement("div");
    hint.className = "map-wheel-hint";
    hint.textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ + molette pour zoomer" : "Ctrl + molette pour zoomer";
    (host.parentElement ?? host).appendChild(hint);
    let hide = 0;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || !host.contains(event.target as Node)) return;
      event.stopPropagation();
      hint.classList.add("is-visible");
      window.clearTimeout(hide);
      hide = window.setTimeout(() => hint.classList.remove("is-visible"), 1200);
    };
    const wheelHost = host.parentElement ?? host;
    wheelHost.addEventListener("wheel", onWheel, { capture: true });
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; instance.invalidateSize(); });
    });
    observer.observe(element.current);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); window.clearTimeout(hide); wheelHost.removeEventListener("wheel", onWheel, { capture: true }); hint.remove(); instance.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    for (const { marker } of markers.current.values()) marker.remove();
    markers.current.clear();
    const chosen = current.current.selected;
    for (const station of stations) {
      if (!station.open) continue;
      const total = station.mechanical + station.electrical;
      const marker = L.marker([station.lat, station.lon], { icon: pinIcon(total, chosen === station.id), title: `${station.name}, ${total} vélo${total > 1 ? "s" : ""}`, keyboard: true }).addTo(instance);
      marker.on("click", () => select.current(station.id));
      markers.current.set(station.id, { marker, total });
    }
    shown.current = chosen;
  }, [stations]);

  useEffect(() => {
    if (shown.current === selected) return;
    const previous = shown.current ? markers.current.get(shown.current) : undefined;
    previous?.marker.setIcon(pinIcon(previous.total, false));
    const next = selected ? markers.current.get(selected) : undefined;
    next?.marker.setIcon(pinIcon(next.total, true));
    shown.current = selected;
  }, [selected]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !userPosition) return;
    const center: L.LatLngTuple = [userPosition.lat, userPosition.lon];
    const accuracy = L.circle(center, { radius: userPosition.accuracy, interactive: false, stroke: true, weight: 1, color: "#df2537", opacity: .25, fillColor: "#df2537", fillOpacity: .06 }).addTo(instance);
    const dot = L.marker(center, { icon: L.divIcon({ className: "user-position", html: "<span></span>", iconSize: [22, 22], iconAnchor: [11, 11] }), interactive: false, keyboard: false, zIndexOffset: 1000, title: "Votre position" }).addTo(instance);
    return () => { accuracy.remove(); dot.remove(); };
  }, [userPosition]);

  useEffect(function panOnNewSelectionOnly() {
    const station = current.current.stations.find((station) => station.id === selected);
    if (station && map.current) map.current.panTo([station.lat, station.lon], { animate: !reducedMotion(), duration: 0.5 });
  }, [selected]);

  useEffect(function refitAfterPanSoRefitWins() {
    const instance = map.current;
    if (!instance || !fit?.length) return;
    const height = instance.getSize().y;
    instance.fitBounds(L.latLngBounds(fit.map((point): L.LatLngTuple => [point.lat, point.lon])),
      { paddingTopLeft: [40, 56], paddingBottomRight: [40, Math.round(height * .42)], maxZoom: 17, animate: !reducedMotion() });
  }, [fit]);

  return <div className="station-map" ref={element} role="region" aria-label="Carte des stations Vélo’v de Lyon"/>;
}
