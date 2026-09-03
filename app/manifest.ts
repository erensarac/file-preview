import type { MetadataRoute } from "next";

import { FORMATS } from "@/lib/formats";

/**
 * The web app manifest.
 *
 * Installing matters more here than it does for most sites. Almost every
 * format is parsed in the tab and never uploaded, so once the shell is cached
 * the app genuinely works with no connection — there is no round-trip to lose.
 * And an installed app can register with the operating system, which turns
 * this from a site someone bookmarks into the thing that opens a file they
 * have nothing else to open.
 */

/**
 * The `accept` map for `file_handlers`, built from the format registry.
 *
 * Derived rather than written out, the same way `ACCEPT_ATTRIBUTE` is: adding
 * a format to `lib/formats.ts` should register it with the operating system
 * too, without a second list to keep in step. Several formats can share a MIME
 * type, so extensions accumulate per type rather than overwriting.
 */
function fileHandlerAccept(): Record<string, string[]> {
  const accept: Record<string, string[]> = {};

  for (const format of FORMATS) {
    const extensions = format.extensions.map((extension) => `.${extension}`);
    for (const mime of format.mimeTypes) {
      accept[mime] = [...new Set([...(accept[mime] ?? []), ...extensions])];
    }
  }

  return accept;
}

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "file — preview any file in your browser",
    short_name: "file",
    description:
      "Open a spreadsheet, document or data file without installing anything. Most formats are read on your own device and never uploaded.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // Matches the light palette in `app/globals.css`. The browser paints this
    // behind the app before the first frame, so a mismatch shows as a flash.
    background_color: "#fbfbfa",
    theme_color: "#b4531f",
    /*
     * The same two images, declared for both purposes rather than as one
     * space-separated `purpose` — which the manifest spec allows but Next's
     * types do not express. The mark sits well inside the safe area, so the
     * icon survives a launcher cropping it to a circle without needing a
     * separate padded version.
     */
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/pwa-icon/512",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    /*
     * Registering with the operating system: an installed app shows up in
     * "Open with" for these types, so a double-clicked spreadsheet lands here.
     *
     * Chromium only, and only once installed — Safari and Firefox ignore the
     * field entirely. Nothing may depend on it; the site works exactly as it
     * did without it. It does not steal any file association either, it only
     * adds an entry to the list the user chooses from.
     */
    file_handlers: [
      {
        action: "/",
        accept: fileHandlerAccept(),
      },
    ],
  } satisfies MetadataRoute.Manifest;
}
