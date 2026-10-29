"use client";

import { useEffect, useState } from "react";
import type { Trip } from "@/lib/models";
import { TripEndedSheet } from "@/components/trip-sheet";

export function Preview() {
  const [trip, setTrip] = useState<Trip | null>(null);
  useEffect(() => {
    window.fetch = async () => { await new Promise((resolve) => setTimeout(resolve, 300)); return Response.json({ rated: true }); };
    const end = Date.now() - 6 * 60_000;
    setTrip({
      id: "preview-trip", status: "FINISHED", startedAt: new Date(end - 14 * 60_000).toISOString(), endedAt: new Date(end).toISOString(),
      startStation: "Bellecour / St Exupéry", endStation: "Part-Dieu / Villette", startStationNumber: 2002, endStationNumber: 3001,
      startStand: 4, endStand: 12, distance: 2_200, bikeNumber: 20449, bikeType: "mechanical", duration: 14, price: 0, fullPrice: 0, discount: 0,
      pointsEarned: 0, pointsSpent: 0, litigious: false, isRated: false, token: null, origin: null
    });
  }, []);
  return trip ? <TripEndedSheet trip={trip} onClose={() => {}}/> : null;
}
