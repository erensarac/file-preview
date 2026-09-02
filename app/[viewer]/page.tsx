import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import FileWorkbench from "@/components/FileWorkbench";
import { getFormat } from "@/lib/formats";
import { LANDING_PAGES, landingPageBySlug } from "@/lib/landing";

/**
 * One page per format, from `lib/landing.ts`.
 *
 * They are prerendered and `dynamicParams` is off, so a slug that isn't in the
 * list is a 404 rather than an empty page — a dynamic segment at the root
 * would otherwise answer for every unknown path on the site.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return LANDING_PAGES.map((page) => ({ viewer: page.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ viewer: string }>;
}): Promise<Metadata> {
  const page = landingPageBySlug((await params).viewer);
  if (!page) return {};

  return {
    title: page.title,
    description: page.description,
    // Without this each page competes with the others for the same terms.
    alternates: { canonical: `/${page.slug}` },
    openGraph: {
      title: page.title,
      description: page.description,
      url: `/${page.slug}`,
      type: "website",
    },
  };
}

export default async function ViewerPage({
  params,
}: {
  params: Promise<{ viewer: string }>;
}) {
  const page = landingPageBySlug((await params).viewer);
  if (!page) notFound();

  const format = getFormat(page.formatId);
  const others = LANDING_PAGES.filter((other) => other.slug !== page.slug);

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 py-10 sm:px-6 sm:py-16">
      <header className="mb-8">
        <p className="mb-3 text-sm text-muted">
          <Link href="/" className="underline underline-offset-2">
            file
          </Link>
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          {page.headline}
        </h1>
        <div className="mt-3 max-w-2xl space-y-3 text-muted">
          {page.body.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      </header>

      <FileWorkbench />

      <footer className="mt-10 space-y-4 border-t border-line pt-6 text-xs text-muted">
        <p>
          {format.label} files are limited to{" "}
          {Math.round(format.maxBytes / (1024 * 1024))} MB.{" "}
          {format.runtime === "client"
            ? "This format is read entirely in your browser."
            : "Files sent for conversion are held in memory for the length of the request and then discarded."}
        </p>
        <nav aria-label="Other formats">
          <ul className="flex flex-wrap gap-x-4 gap-y-2">
            {others.map((other) => (
              <li key={other.slug}>
                <Link
                  href={`/${other.slug}`}
                  className="underline underline-offset-2 hover:text-ink"
                >
                  {other.headline}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </footer>
    </main>
  );
}
