import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { MARK, PageMark } from "@/lib/mark";

/**
 * The repository's social preview, the image GitHub puts above a link to it.
 *
 * Generated here rather than committed as a PNG, for the reason every other
 * image in this app is: the colour and the shape come from `lib/mark.tsx`, so
 * a change to the mark reaches this card without anyone remembering to
 * re-export it. A banner is exactly the kind of file that goes stale — it is
 * looked at by strangers and almost never by us.
 *
 * GitHub does not fetch this. The image has to be uploaded by hand under
 * Settings → General → Social preview, which is why it is served at a URL
 * ending in `.png`: that is the thing you can right-click and save.
 */
export const dynamic = "force-static";

/** GitHub's recommended size for a social preview. */
const SIZE = { width: 1280, height: 640 };

/**
 * The wordmark's cap height, and the gap to the mark, in pixels.
 *
 * The mark is 1.85 times the cap height. That ratio was chosen by looking:
 * at 2.1 the page reads as a slab next to a serif, and at 1.65 it goes timid.
 */
const CAP = 94;
const MARK_HEIGHT = CAP * 1.85;
const GAP = 60;

/**
 * Cap height is not something a renderer can be asked for, so it is converted
 * to a point size here. The ratio is measured from the ink of a rendered `F`
 * — 0.717 em — rather than taken from the font's own `sCapHeight`, which for
 * this face says 0.67 and disagrees with what it draws.
 */
const FONT_SIZE = Math.round(CAP / 0.717);

export async function GET() {
  /*
   * Read from the project root, which is where this runs: `force-static`
   * means the image is rendered during `next build` and served as a file, so
   * there is no request-time read of this font to go missing from a
   * deployment — the failure mode that cost this project a broken release
   * once already, when a file the bundler could not see was left behind.
   */
  const font = await readFile(
    join(process.cwd(), "lib/fonts/Newsreader-SemiBold.ttf"),
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: GAP,
          background: MARK.accent,
          fontFamily: "Newsreader",
        }}
      >
        <PageMark height={MARK_HEIGHT} />
        {/*
          Nudged down, because centring centres the wrong thing.
          `align-items: center` puts the middle of the *line box* on the middle
          of the canvas, and a line box is lopsided: it runs from the ascender
          (0.735 em above the baseline for this face) to the descender (0.265
          below), so its middle sits 0.235 em above the baseline. The caps are
          what the eye reads, and their middle sits 0.3585 em above it — a
          tenth of an em higher. Centred honestly, the wordmark therefore
          floats above the mark beside it.

          The correction is that difference, doubled: a flex item is centred
          including its margins, so a margin moves the content by half of what
          it says.
        */}
        <div
          style={{
            display: "flex",
            fontSize: FONT_SIZE,
            color: MARK.page,
            marginTop: Math.round(FONT_SIZE * 0.247),
          }}
        >
          File Preview
        </div>
      </div>
    ),
    {
      ...SIZE,
      fonts: [{ name: "Newsreader", data: font, weight: 600, style: "normal" }],
    },
  );
}
