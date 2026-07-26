import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "file — preview any file in your browser",
  description:
    "Open Excel, Word, CSV, Markdown and JSON files instantly. Text formats are read in your browser and never uploaded.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
