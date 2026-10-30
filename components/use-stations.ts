import { useCallback, useRef, useState } from "react";
import { stationsSchema, type Resource, type Station } from "@/lib/models";
import { toaster } from "@/lib/toast";
import { getJson, loadError } from "./get-json";

type StationData = { stations: Station[]; updatedAt: string };
const unavailable = "Les disponibilités des stations sont momentanément indisponibles.";

export function useStations() {
  const [resource, setResource] = useState<Resource<StationData>>({ kind: "loading" });
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const shown = useRef(false);
  const reload = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    getJson("/api/stations", stationsSchema, unavailable)
      .then((data) => { shown.current = true; setResource({ kind: "ready", data }); }, (error: unknown) => {
        const failure = loadError(error, unavailable);
        if (shown.current) toaster.show(failure.message);
        else setResource({ kind: "error", ...failure });
      })
      .finally(() => { inFlight.current = false; setPending(false); });
  }, []);
  return { resource, pending, inFlight, reload };
}
