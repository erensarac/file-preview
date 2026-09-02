import Link from "next/link";

import FileWorkbench from "@/components/FileWorkbench";
import { LANDING_PAGES } from "@/lib/landing";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 py-6 sm:px-6 sm:py-16">
      <header className="mb-6 sm:mb-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">file</h1>
        <p className="mt-2 text-sm text-muted sm:text-base">
          Open a spreadsheet, document or data file without installing anything.
          Formats marked <span className="text-accent">●</span> are read entirely
          in your browser — those files never leave your device.
        </p>
      </header>

      <FileWorkbench />

      <footer className="mt-8 space-y-4 sm:mt-10 border-t border-line pt-6 text-xs text-muted">
        <p>
          Nothing is stored. Files sent to the server for conversion are held in
          memory for the length of the request and then discarded.
        </p>
        {/*
          These are the per-format pages. Linking them from here is what makes
          them reachable by someone browsing rather than only by search.
        */}
        <nav aria-label="Formats">
          <ul className="flex flex-wrap gap-x-4 gap-y-2">
            {LANDING_PAGES.map((page) => (
              <li key={page.slug}>
                <Link
                  href={`/${page.slug}`}
                  className="underline underline-offset-2 hover:text-ink"
                >
                  {page.headline}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </footer>
    </main>
  );
}
