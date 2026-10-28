import { cookies } from "next/headers";
import { Companion } from "@/components/companion";
import { COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";
export default async function Page() {
  const store = await cookies();
  return <Companion initialSession={Boolean(store.get(COOKIE.refresh)?.value)}/>;
}
