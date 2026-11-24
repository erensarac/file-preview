import { ImageResponse } from "next/og";

import { MARK } from "@/lib/mark";

/**
 * The home-screen icon.
 *
 * Apple's touch icon has to be a raster, so it cannot simply reuse `icon.svg`.
 * It is drawn here rather than committed as a PNG so the two cannot drift: the
 * shape and the colour are written once, in the same terms.
 *
 * No rounded corners — iOS masks the icon itself, and a pre-rounded one gets
 * rounded twice.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
        <svg width="112" height="112" viewBox="0 0 32 32">
          <path d="M8 4h11.2L26 10.8V28H8z" fill={MARK.page} />
          <path d="M19 4v7h7z" fill={MARK.fold} />
        </svg>
      </div>
    ),
    size,
  );
}
