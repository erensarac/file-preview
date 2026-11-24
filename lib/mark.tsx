/**
 * The mark, in one place.
 *
 * Three colours and one shape, written here because they were written five
 * times: `app/icon.svg`, `app/apple-icon.tsx`, the PWA icon route, the Open
 * Graph card and now the GitHub banner each had their own `#b4531f`. Nothing
 * went wrong with that yet, which is the only reason it was tolerable — the
 * failure mode is a redesign that lands in four files out of five and is
 * noticed by whoever opens the fifth.
 *
 * `app/icon.svg` is a static file and cannot import from here, so it is
 * covered the other way round: `tests/banner.spec.ts` reads it and asserts it
 * still carries these three values.
 */
export const MARK = {
  /** The background everything else sits on. */
  accent: "#b4531f",
  /** The page. */
  page: "#ffffff",
  /** Its folded corner — the accent, lightened, not a second hue. */
  fold: "#f0c4a8",
} as const;

/**
 * The page on its own, at a given height.
 *
 * This is the favicon's page, lifted out of the favicon's coordinate system:
 * the `viewBox` crops to exactly the glyph, so the rounded square behind it
 * does not come along. That square is what the icon needs to be findable in a
 * strip of tabs; on a canvas that is already the accent it would be invisible,
 * and drawing it would only pad the mark with its own colour.
 *
 * The page is 12 units wide and 18 tall, so the width follows from the height
 * rather than being a second number to keep in step.
 */
export function PageMark({ height }: { height: number }) {
  return (
    <svg width={(height * 12) / 18} height={height} viewBox="11 7 12 18">
      <path d="M11 7h7.2L23 11.8V25H11z" fill={MARK.page} />
      {/*
        The fold starts half a unit left of where the corner is cut, so the two
        shapes overlap instead of meeting on a seam that antialiasing would
        leave a hairline in.
      */}
      <path d="M18 7v5h5z" fill={MARK.fold} />
    </svg>
  );
}
