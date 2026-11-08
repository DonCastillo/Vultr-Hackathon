import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";

import { Nav } from "@/components/nav";

import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CrewShift · Maple & Mug",
  description:
    "Crew scheduling and sick-call recovery for Maple & Mug Coffee Co.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // The font variables go on <html>: that is where the base styles apply font-sans.
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-screen font-sans antialiased">
        <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
          <div className="mx-auto flex max-w-[1600px] flex-col gap-2 px-4 py-2 sm:flex-row sm:items-center sm:justify-between">
            <Link href="/board" className="flex items-center gap-2">
              <span
                aria-hidden
                className="grid size-8 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground"
              >
                M&amp;M
              </span>
              <span className="leading-tight">
                <span className="block text-sm font-semibold">
                  Maple &amp; Mug Coffee Co.
                </span>
                <span className="block text-xs text-muted-foreground">
                  CrewShift · Calgary
                </span>
              </span>
            </Link>
            <Nav />
          </div>
        </header>
        <main className="mx-auto max-w-[1600px] px-4 py-4">{children}</main>
      </body>
    </html>
  );
}
