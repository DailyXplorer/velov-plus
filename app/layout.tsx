import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import localFont from "next/font/local";
import { Toaster } from "@/components/toast";
import "./globals.css";

const serif = localFont({ src: "./fonts/VelovGlyphic-Regular.woff2", weight: "400", variable: "--font-serif", display: "swap" });
const sans = DM_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "Vélo’v+",
  description: "Compte Vélo’v, trajets et points.",
  robots: { index: false, follow: false },
  icons: { icon: "/icon.svg" }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr" className={`${serif.variable} ${sans.variable}`}><body>{children}<Toaster/></body></html>;
}
