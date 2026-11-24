import { ImageResponse } from "next/og";

import { MARK } from "@/lib/mark";

/**
 * The installed app's icon, at the sizes an installer asks for.
 *
 * Generated rather than committed, for the same reason the Open Graph cards
 * are: the shape and the colour are written once and cannot drift from the
 * site's own.
 *
 * The glyph occupies a little over half the canvas on purpose. Android crops
 * an installed icon to whatever shape the launcher uses — a circle, a squircle
 * — and only the middle ~80% is guaranteed to survive. Keeping the mark well
 * inside that lets one set of icons serve both `any` and `maskable` instead of
 * shipping two, and it is why the manifest can declare both purposes.
 */
const SIZES = [192, 512];

export const dynamicParams = false;

export function generateStaticParams() {
  return SIZES.map((size) => ({ size: String(size) }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ size: string }> },
) {
  const size = Number((await params).size);
  const glyph = Math.round(size * 0.56);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: MARK.accent,
        }}
      >
        <svg width={glyph} height={glyph} viewBox="0 0 32 32">
          <path d="M8 4h11.2L26 10.8V28H8z" fill={MARK.page} />
          <path d="M19 4v7h7z" fill={MARK.fold} />
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
