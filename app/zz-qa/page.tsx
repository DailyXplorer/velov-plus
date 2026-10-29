import { notFound } from "next/navigation";
import { Qa } from "./qa";

export default async function Page({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  return <Qa screen={(await searchParams).s ?? "overview"}/>;
}
