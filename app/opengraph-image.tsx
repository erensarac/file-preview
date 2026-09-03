import { ImageResponse } from "next/og";

import { OG_SIZE, OgCard } from "@/lib/og-card";

/**
 * The card a link to the home page unfurls into.
 *
 * Generated at build time rather than committed as a PNG, so the wordmark and
 * the palette come from the same source as the site's own.
 */
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "file — open a spreadsheet, document or data file in your browser";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <OgCard
        headline="Open a file in your browser"
        note="PDF, Excel, Word, CSV, Markdown and JSON. No install, no sign-up."
      />
    ),
    size,
  );
}
