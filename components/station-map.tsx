"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Point } from "@/lib/geo";
import type { Station } from "@/lib/models";
import { whenIdle } from "@/lib/idle";

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

type Pin = { station: Station; total: number; marker: L.Marker | null };

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

function pinTitle(station: Station, total: number) {
  return `${station.name}, ${total} vélo${total > 1 ? "s" : ""}`;
}

export default function StationMap({ stations, selected, onSelect, onClear, userPosition, fit }: StationMapProps) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const pins = useRef(new Map<string, Pin>());
  const place = useRef(() => {});
  const select = useRef(onSelect);
  select.current = onSelect;
  const clear = useRef(onClear);
  clear.current = onClear;
  const current = useRef(stations);
  current.current = stations;
  const shown = useRef<string | null>(null);

  useEffect(() => {
    if (!element.current) return;
    const instance = L.map(element.current, { center: [45.7576, 4.832], zoom: 15, zoomControl: false, scrollWheelZoom: true, wheelPxPerZoomLevel: 90 });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19 }).addTo(instance);
    L.control.zoom({ position: "topright" }).addTo(instance);
    instance.on("click", () => clear.current?.());
    map.current = instance;
    const show = (margin: number) => {
      const size = instance.getSize();
      if (!size.x || !size.y) return;
      const bounds = instance.getBounds();
      const near = bounds.pad(margin);
      const kept = bounds.pad(1);
      for (const [id, pin] of pins.current) {
        const at: L.LatLngTuple = [pin.station.lat, pin.station.lon];
        if (!pin.marker && near.contains(at)) {
          pin.marker = L.marker(at, { icon: pinIcon(pin.total, shown.current === id), title: pinTitle(pin.station, pin.total), keyboard: true })
            .on("click", () => select.current(id)).addTo(instance);
        } else if (pin.marker && !kept.contains(at)) {
          pin.marker.remove();
          pin.marker = null;
        }
      }
    };
    let cancelIdle = () => {};
    place.current = () => {
      cancelIdle();
      show(0);
      cancelIdle = whenIdle(() => show(.5));
    };
    instance.on("moveend", () => place.current());
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
    const observer = new ResizeObserver(([entry]) => {
      if (frame || !entry.contentRect.width || !entry.contentRect.height) return;
      frame = requestAnimationFrame(() => { frame = 0; instance.invalidateSize(); });
    });
    observer.observe(element.current);
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame); cancelIdle(); window.clearTimeout(hide); wheelHost.removeEventListener("wheel", onWheel, { capture: true }); hint.remove();
      for (const pin of pins.current.values()) pin.marker = null;
      place.current = () => {};
      instance.remove(); map.current = null;
    };
  }, []);

  useEffect(() => {
    const open = new Map<string, Station>();
    for (const station of stations) if (station.open) open.set(station.id, station);
    for (const [id, pin] of pins.current) {
      if (open.has(id)) continue;
      pin.marker?.remove();
      pins.current.delete(id);
    }
    for (const [id, station] of open) {
      const total = station.mechanical + station.electrical;
      const pin = pins.current.get(id);
      if (!pin) { pins.current.set(id, { station, total, marker: null }); continue; }
      const previous = pin.station;
      pin.station = station;
      pin.total = total;
      if (!pin.marker) continue;
      if (previous.lat !== station.lat || previous.lon !== station.lon) pin.marker.setLatLng([station.lat, station.lon]);
      if (previous.mechanical + previous.electrical !== total || previous.name !== station.name) {
        pin.marker.options.title = pinTitle(station, total);
        pin.marker.setIcon(pinIcon(total, shown.current === id));
      }
    }
    place.current();
  }, [stations]);

  useEffect(() => {
    if (shown.current === selected) return;
    const previous = shown.current ? pins.current.get(shown.current) : undefined;
    previous?.marker?.setIcon(pinIcon(previous.total, false));
    const next = selected ? pins.current.get(selected) : undefined;
    next?.marker?.setIcon(pinIcon(next.total, true));
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
    const station = current.current.find((station) => station.id === selected);
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
