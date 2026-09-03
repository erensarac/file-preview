import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";

import ServiceWorker from "@/components/ServiceWorker";
import { SITE_URL } from "@/lib/site";

import "./globals.css";

export const metadata: Metadata = {
  // Resolves the relative canonical and Open Graph URLs the pages declare.
  metadataBase: new URL(SITE_URL),
  title: "file — preview any file in your browser",
  description:
    "Open PDF, Excel, Word, CSV, Markdown and JSON files instantly. Most formats are read in your browser and never uploaded.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "file — preview any file in your browser",
    description:
      "Open PDF, Excel, Word, CSV, Markdown and JSON files instantly. Most formats are read in your browser and never uploaded.",
    url: "/",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans antialiased">
        {children}
        <ServiceWorker />
        {/*
          Traffic, so the six landing pages can be judged rather than assumed.
          Vercel's own analytics rather than a third party: it is cookieless
          and served from this origin, so no visitor data crosses to another
          domain and there is nothing to put a consent banner in front of —
          which on a site whose pitch is "we don't take your file" would be
          self-defeating.

          Production deployments only. A preview deployment would pollute the
          numbers, and locally it would send events from a developer's own
          browsing. The cost of that gate is that the test suite never sees
          this render, so what it asserts about network traffic is true of
          every environment except the one that matters.
        */}
        {process.env.VERCEL_ENV === "production" && <Analytics />}
      </body>
    </html>
  );
}
