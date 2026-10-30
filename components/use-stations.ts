import { useCallback, useRef, useState } from "react";
import { stationsSchema, type Resource, type Station } from "@/lib/models";
import { getJson, loadError } from "./get-json";

type StationData = { stations: Station[]; updatedAt: string };
const unavailable = "Les disponibilités des stations sont momentanément indisponibles.";

export function useStations() {
  const [resource, setResource] = useState<Resource<StationData>>({ kind: "loading" });
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const reload = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    getJson("/api/stations", stationsSchema, unavailable)
      .then((data) => setResource({ kind: "ready", data }), (error: unknown) => setResource({ kind: "error", ...loadError(error, unavailable) }))
      .finally(() => { inFlight.current = false; setPending(false); });
  }, []);
  return { resource, pending, inFlight, reload };
}
