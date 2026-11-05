import type { Metadata } from "next";
import { Geist_Mono, IBM_Plex_Sans, IBM_Plex_Sans_Condensed, Spectral } from "next/font/google";
import { Shell } from "@/components/shell";
import "./globals.css";

// Spectral: a bookish serif for headlines and figures. Plex Sans: the working interface.
// Plex Condensed: only for the rubber stamps.
const heading = Spectral({ variable: "--font-heading", subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });
const body = IBM_Plex_Sans({ variable: "--font-body", subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });
const stamp = IBM_Plex_Sans_Condensed({ variable: "--font-stamp", subsets: ["latin"], weight: ["700"], display: "swap" });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Ledgerline — Invoice decisions",
  description: "From PDF to a defendable AP decision, with every step visible.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${heading.variable} ${body.variable} ${stamp.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
