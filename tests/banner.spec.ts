import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { MARK } from "../lib/mark";

/**
 * The GitHub social preview, checked as a picture rather than as a status code.
 *
 * "It renders" is not the question — an `ImageResponse` returning the wrong
 * thing is still a 200. What matters is the composition: the mark on the left,
 * the wordmark beside it, the pair centred on a field of the accent. So this
 * reads the pixels back and measures it.
 *
 * Measuring the two pieces *separately* is the point. An earlier version took
 * the bounding box of everything and called it centred, which it always is:
 * the mark is twice the height of the wordmark, so the wordmark could float a
 * clear 25px off the line and never reach past the mark's own extent. The
 * first version of the banner did exactly that, and that test passed.
 *
 * The bounds are loose on purpose. They are here to catch a layout that
 * collapsed, a font that fell back, a mark that vanished or a wordmark adrift
 * — not to pin antialiasing.
 */
const SIZE = { width: 1280, height: 640 };
const MARK_HEIGHT = 94 * 1.85;

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface Shape {
  width: number;
  height: number;
  corners: string[];
  /** Everything that is not the field, as one box. */
  content: Box;
  /** The mark and the wordmark, split at the gap between them. */
  mark: Box;
  wordmark: Box;
  gap: number;
  hasFold: boolean;
}

async function measure(page: Page, png: Buffer): Promise<Shape> {
  const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
  return page.evaluate(
    async ({ dataUrl, accent, fold }) => {
      const image = new Image();
      image.src = dataUrl;
      await image.decode();

      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);

      const at = (x: number, y: number) => (y * canvas.width + x) * 4;
      const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      const hexAt = (i: number) =>
        "#" + [0, 1, 2].map((k) => data[i + k]!.toString(16).padStart(2, "0")).join("");

      // Near enough: the field is flat, but a PNG round-trip and the
      // renderer's own blending can move a channel by a point or two.
      const target = rgb(accent);
      const isField = (i: number) => target.every((c, k) => Math.abs(data[i + k]! - c) <= 3);

      /** The ink box within a range of columns, or null if there is none. */
      const boxIn = (from: number, to: number): Box | null => {
        let left = -1, right = -1, top = -1, bottom = -1;
        for (let x = from; x <= to; x += 1) {
          for (let y = 0; y < canvas.height; y += 1) {
            if (isField(at(x, y))) continue;
            if (left < 0) left = x;
            right = x;
            if (top < 0 || y < top) top = y;
            if (y > bottom) bottom = y;
          }
        }
        return left < 0 ? null : { left, right, top, bottom };
      };

      const inked: boolean[] = [];
      for (let x = 0; x < canvas.width; x += 1) {
        let any = false;
        for (let y = 0; y < canvas.height && !any; y += 1) any = !isField(at(x, y));
        inked.push(any);
      }
      const first = inked.indexOf(true);
      const last = inked.lastIndexOf(true);

      // The widest stretch of empty columns inside the content is the gap
      // that separates the mark from the wordmark.
      let gapStart = -1, gapEnd = -1, run = -1;
      for (let x = first; x <= last; x += 1) {
        if (!inked[x]) {
          if (run < 0) run = x;
          continue;
        }
        if (run >= 0 && x - run > gapEnd - gapStart) {
          gapStart = run;
          gapEnd = x - 1;
        }
        run = -1;
      }

      let hasFold = false;
      for (let i = 0; i < data.length && !hasFold; i += 4) hasFold = hexAt(i) === fold;

      const empty = { left: -1, right: -1, top: -1, bottom: -1 };
      return {
        width: canvas.width,
        height: canvas.height,
        corners: [
          hexAt(at(0, 0)),
          hexAt(at(canvas.width - 1, 0)),
          hexAt(at(0, canvas.height - 1)),
          hexAt(at(canvas.width - 1, canvas.height - 1)),
        ],
        content: boxIn(first, last) ?? empty,
        mark: boxIn(first, gapStart - 1) ?? empty,
        wordmark: boxIn(gapEnd + 1, last) ?? empty,
        gap: gapEnd - gapStart + 1,
        hasFold,
      };
    },
    { dataUrl, accent: MARK.accent as string, fold: MARK.fold as string },
  );
}

test.describe("the GitHub banner", () => {
  test("is a PNG at the size GitHub asks for, laid out as agreed", async ({
    page,
    request,
  }) => {
    const response = await request.get("/github-banner.png");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/png");

    const png = await response.body();
    // Written out on every run: a social preview has to be handed to GitHub by
    // hand, and CI publishes this file so the current one is a download away.
    mkdirSync("test-results", { recursive: true });
    writeFileSync(join("test-results", "github-banner.png"), png);

    await page.goto("/");
    const shape = await measure(page, png);

    expect({ width: shape.width, height: shape.height }).toEqual(SIZE);
    // The field is the accent, edge to edge.
    expect(shape.corners).toEqual(Array(4).fill(MARK.accent));
    // The fold is the detail that silently disappears if the mark is drawn
    // from the wrong path, and nothing else on the canvas is that colour.
    expect(shape.hasFold).toBe(true);

    // Mark, gap, wordmark — in that order, with both pieces actually present.
    expect(shape.gap).toBeGreaterThan(30);
    expect(shape.mark.left).toBeGreaterThanOrEqual(0);
    expect(shape.wordmark.left).toBeGreaterThan(shape.mark.right);
    // The wordmark is the wider of the two; a fallback font that failed to
    // load would be narrower or wider by a lot, but a mark drawn as a square
    // would also trip this.
    expect(shape.wordmark.right - shape.wordmark.left).toBeGreaterThan(
      shape.mark.right - shape.mark.left,
    );

    // The lockup is centred horizontally: equal margins either side.
    expect(
      Math.abs(shape.content.left - (SIZE.width - 1 - shape.content.right)),
    ).toBeLessThanOrEqual(12);

    // The mark is the height it was drawn at, and sits on the middle.
    const markHeight = shape.mark.bottom - shape.mark.top + 1;
    expect(Math.abs(markHeight - MARK_HEIGHT)).toBeLessThanOrEqual(6);
    const markMiddle = (shape.mark.top + shape.mark.bottom) / 2;
    expect(Math.abs(markMiddle - SIZE.height / 2)).toBeLessThanOrEqual(6);

    /*
     * And the wordmark sits on the same line.
     *
     * Against the mark rather than against 320, because this is the thing the
     * eye actually checks: the two read as one lockup or they do not. The
     * tolerance absorbs the ascender of `l` reaching a few pixels past the
     * caps — "File Preview" has no descender to balance it, so its ink box is
     * slightly top-heavy by construction.
     */
    const wordMiddle = (shape.wordmark.top + shape.wordmark.bottom) / 2;
    expect(Math.abs(wordMiddle - markMiddle)).toBeLessThanOrEqual(10);
  });

  /**
   * `app/icon.svg` is a static file, so it cannot import the palette. This is
   * the other half of that: if the mark's colours change in `lib/mark.tsx`,
   * the favicon has to follow, and this is what says so.
   */
  test("the favicon still carries the mark's colours", () => {
    const svg = readFileSync(join("app", "icon.svg"), "utf8");
    for (const colour of [MARK.accent, MARK.page, MARK.fold]) {
      expect(svg).toContain(colour);
    }
  });

  test("the stylesheet's accent is the mark's accent", () => {
    const css = readFileSync(join("app", "globals.css"), "utf8");
    expect(css).toContain(`--palette-accent: ${MARK.accent};`);
  });
});
