// Read-only Cyclocity calls: retries, the shared app token and the station list. Free of "server-only" so tests can import it.
import { z } from "zod";
import { type Station, stationTitle } from "./models.ts";
import { BASE } from "./cyclocity.ts";
import { VelovError } from "./auth-protocol.ts";
import { memo } from "./memo.ts";

const ATTEMPT_TIMEOUT = 8_000;

/**
 * Cyclocity's gateway answers a bare nginx 502 to roughly one request in five (measured, no 429 or rate-limit headers):
 * retry those and network failures, never a timeout, never another status. Reads only, plus the client token POST:
 * a state-changing call (rate, booking, release) must go out exactly once and never comes through here.
 */
export async function fetchTransient(url: string, init: RequestInit = {}, attempts = 3): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET" && !(method === "POST" && url.endsWith("/client_tokens"))) throw new Error(`fetchTransient refuses ${method} ${url}`);
  for (let attempt = 1; ; attempt++) {
    const last = attempt >= attempts;
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(ATTEMPT_TIMEOUT) }).catch((error: unknown) => {
      if (last || !(error instanceof TypeError)) throw error;
      return null;
    });
    if (response && (last || ![502, 503, 504].includes(response.status))) return response;
    await response?.body?.cancel().catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, attempt * 400));
  }
}

export type AppToken = { get: () => Promise<string>; drop: (token: string) => void };

/** The app token, shared by concurrent requests and kept 100 min. */
export function appToken(request: () => Promise<string>): AppToken {
  let current: { token: string; expiresAt: number } | null = null;
  let pending: Promise<string> | null = null;
  return {
    async get() {
      if (current && current.expiresAt > Date.now()) return current.token;
      pending ??= request().then((token) => { current = { token, expiresAt: Date.now() + 100 * 60_000 }; return token; }).finally(() => { pending = null; });
      return pending;
    },
    // Only the token that was refused: a concurrent request may already have replaced it.
    drop(token) { if (current?.token === token) current = null; }
  };
}

/** A GET with the app token. A 401 may come from a stale app token, so it is renewed and the call tried once more. */
export async function getWithAppToken(tokens: AppToken, url: string, headers: (token: string) => Record<string, string>): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const token = await tokens.get();
    const response = await fetchTransient(url, { headers: headers(token), cache: "no-store" });
    if (response.status !== 401 || attempt > 1) return response;
    await response.body?.cancel().catch(() => {});
    tokens.drop(token);
  }
}

const localizedName = z.union([z.string(), z.array(z.object({ text: z.string(), language: z.string() }))]);
const infoSchema = z.object({ data: z.object({ stations: z.array(z.object({ station_id: z.string(), name: localizedName, lat: z.number(), lon: z.number(), address: z.string().optional() })) }) });
const statusSchema = z.object({ last_updated: z.union([z.string(), z.number()]), data: z.object({ stations: z.array(z.object({ station_id: z.string(), num_vehicles_available: z.number().optional(), num_bikes_available: z.number().optional(), num_docks_available: z.number(), is_renting: z.union([z.boolean(), z.number()]), vehicle_types_available: z.array(z.object({ vehicle_type_id: z.string(), count: z.number() })).optional() })) }) });
export type StationData = { stations: Station[]; updatedAt: string };

async function gbfs(file: string) {
  const response = await fetchTransient(`${BASE}/gbfs/v3/${file}`, { cache: "no-store" });
  if (!response.ok) throw new VelovError("unavailable", "Les disponibilités des stations sont momentanément indisponibles.");
  const value: unknown = await response.json();
  return value;
}

async function loadStations(): Promise<StationData> {
  const [information, statuses] = await Promise.all([gbfs("station_information.json"), gbfs("station_status.json")]);
  const info = infoSchema.parse(information);
  const status = statusSchema.parse(statuses);
  const availability = new Map(status.data.stations.map((station) => [station.station_id, station]));
  const stations = info.data.stations.flatMap((station): Station[] => {
    const current = availability.get(station.station_id);
    const number = Number(station.station_id);
    if (!current || !Number.isFinite(number)) return [];
    const name = typeof station.name === "string" ? station.name : station.name.find((name) => name.language.startsWith("fr"))?.text ?? station.name[0]?.text;
    const types = current.vehicle_types_available ?? [];
    const electrical = types.filter((type) => /electri/i.test(type.vehicle_type_id)).reduce((sum, type) => sum + type.count, 0);
    const total = current.num_vehicles_available ?? current.num_bikes_available ?? 0;
    return [{ id: station.station_id, number, name: name?.trim() ? stationTitle(name) : `Station ${number}`, address: station.address ?? "", lat: station.lat, lon: station.lon, electrical, mechanical: Math.max(0, total - electrical), stands: current.num_docks_available, open: Boolean(current.is_renting) }];
  });
  const updatedAt = typeof status.last_updated === "number" ? new Date(status.last_updated * 1000).toISOString() : status.last_updated;
  return { stations, updatedAt };
}

// The only cache layer for GBFS: an outage serves the last list, however old, rather than none.
const stations = memo<StationData>(45_000, { stale: true });
export function getStations() {
  return stations("lyon", loadStations);
}
