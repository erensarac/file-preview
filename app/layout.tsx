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
      </body>
    </html>
  );
}
