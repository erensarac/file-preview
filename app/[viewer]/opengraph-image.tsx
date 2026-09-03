import { ImageResponse } from "next/og";

import { getFormat } from "@/lib/formats";
import { LANDING_PAGES, landingPageBySlug } from "@/lib/landing";
import { OG_SIZE, OgCard, runtimeNote } from "@/lib/og-card";

/**
 * One card per landing page, naming that page's format.
 *
 * The whole point of six separate pages is that they answer six different
 * searches; sharing one generic image would undo that at exactly the moment
 * someone shares a link. The second line comes from the format's runtime, so
 * an Excel card says it is converted on the server and a PDF card says it is
 * not — the distinction the pages exist to make.
 */
export const contentType = "image/png";

export function generateStaticParams() {
  return LANDING_PAGES.map((page) => ({ viewer: page.slug }));
}

/**
 * `alt` has to come from here rather than a module-level export, because a
 * single exported string would describe all six cards the same way. The alt
 * text is what a screen reader announces when the card is posted somewhere, so
 * it should say which card it is.
 */
export async function generateImageMetadata({
  params,
}: {
  params: Promise<{ viewer: string }>;
}) {
  const page = landingPageBySlug((await params).viewer);
  return [
    {
      id: "card",
      size: OG_SIZE,
      contentType: "image/png",
      alt: page ? `file — ${page.headline}` : "file",
    },
  ];
}

export default async function OpengraphImage({
  params,
}: {
  params: Promise<{ viewer: string }>;
}) {
  const page = landingPageBySlug((await params).viewer);
  if (!page) return new Response("Not found", { status: 404 });

  return new ImageResponse(
    (
      <OgCard
        headline={page.headline}
        note={runtimeNote(getFormat(page.formatId).runtime)}
      />
    ),
    OG_SIZE,
  );
}
