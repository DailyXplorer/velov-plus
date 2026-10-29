import type { Metadata } from "next";
import { DM_Sans, Faculty_Glyphic } from "next/font/google";
import "./globals.css";

const serif = Faculty_Glyphic({ weight: "400", subsets: ["latin"], variable: "--font-serif", display: "swap" });
const sans = DM_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "Vélo’v+",
  description: "Compte Vélo’v, trajets et points.",
  robots: { index: false, follow: false },
  icons: { icon: "/icon.svg" }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr" className={`${serif.variable} ${sans.variable}`}><body>{children}</body></html>;
}
