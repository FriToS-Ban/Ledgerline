import type { Metadata } from "next";
import { Audiowide, Inter, JetBrains_Mono } from "next/font/google";
import { Shell } from "@/components/shell";
import "./globals.css";

// Audiowide: display headings. Inter: readable working interface. JetBrains Mono: numbers and code.
const display = Audiowide({ variable: "--font-audiowide", subsets: ["latin"], weight: "400", display: "swap" });
const body = Inter({ variable: "--font-body", subsets: ["latin"], display: "swap" });
const mono = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Ledgerline — Invoice decisions",
  description: "From PDF to a defendable AP decision, with every step visible.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
