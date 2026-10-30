import { cookies } from "next/headers";
import { Companion } from "@/components/companion";
import { COOKIE } from "@/lib/session";
import { GUEST_COOKIE, startMode } from "@/lib/guest";

export const dynamic = "force-dynamic";
export default async function Page() {
  const store = await cookies();
  return <Companion start={startMode({ refresh: store.get(COOKIE.refresh)?.value, guest: store.get(GUEST_COOKIE)?.value })}/>;
}
