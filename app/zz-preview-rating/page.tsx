import { notFound } from "next/navigation";
import { Preview } from "./preview";

// Dev-only screenshots of the "Trajet terminé" sheet: fake trip, fetch stubbed, nothing reaches Vélo’v.
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Preview/>;
}
