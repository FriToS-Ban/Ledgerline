import type { Metadata } from "next";
import { Audiowide, Inter, JetBrains_Mono } from "next/font/google";
import { Shell } from "@/components/shell";
import "./globals.css";

// Audiowide: display headings. Inter: readable working interface. JetBrains Mono: numbers and code.
const display = Audiowide({ variable: "--font-audiowide", subsets: ["latin"], weight: "400", display: "swap" });
const body = Inter({ variable: "--font-body", subsets: ["latin"], display: "swap" });
const mono = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Ledgerline — the payment guard",
  description: "Catch duplicate, overpaid and suspicious invoices before money leaves.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full" suppressHydrationWarning>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
