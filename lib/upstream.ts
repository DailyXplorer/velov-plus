import { z } from "zod";
import { type Station, stationTitle } from "./models.ts";
import { BASE } from "./cyclocity.ts";
import { VelovError } from "./auth-protocol.ts";
import { memo } from "./memo.ts";

const ATTEMPT_TIMEOUT = 8_000;

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

export function appToken(request: () => Promise<string>): AppToken {
  let current: { token: string; expiresAt: number } | null = null;
  let pending: Promise<string> | null = null;
  return {
    async get() {
      if (current && current.expiresAt > Date.now()) return current.token;
      pending ??= request().then((token) => { current = { token, expiresAt: Date.now() + 100 * 60_000 }; return token; }).finally(() => { pending = null; });
      return pending;
    },
    drop(token) { if (current?.token === token) current = null; }
  };
}

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

const stations = memo<StationData>(45_000, { stale: true });
export function getStations() {
  return stations("lyon", loadStations);
}
