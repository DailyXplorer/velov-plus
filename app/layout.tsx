import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vélo’v",
  description: "Compte Vélo’v, trajets et points.",
  robots: { index: false, follow: false },
  icons: { icon: "/icon.svg" }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr"><head><link rel="stylesheet" href="/fonts/dm-sans.css"/></head><body>{children}</body></html>;
}
