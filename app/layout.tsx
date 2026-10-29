import type { Metadata } from "next";
import { Azeret_Mono, DM_Sans, Faculty_Glyphic } from "next/font/google";
import "./globals.css";

const serif = Faculty_Glyphic({ weight: "400", subsets: ["latin"], variable: "--font-serif", display: "swap" });
const sans = DM_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = Azeret_Mono({ weight: "500", subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Vélo’v+",
  description: "Compte Vélo’v, trajets et points.",
  robots: { index: false, follow: false },
  icons: { icon: "/icon.svg" }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr" className={`${serif.variable} ${sans.variable} ${mono.variable}`}><body>{children}</body></html>;
}
