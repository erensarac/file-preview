/**
 * The shared layout of every Open Graph card.
 *
 * One component rather than one per route: a link preview is the first thing
 * most people see of this site, and six cards drifting apart is how a set of
 * pages stops looking like one product. Only the two lines of copy differ.
 *
 * Rendered by satori through `next/og`, which supports a subset of CSS — every
 * element with more than one child needs an explicit `display: flex`.
 *
 * There is no `fontWeight` anywhere below, on purpose rather than by omission:
 * satori's built-in font ships a single weight, so declaring one renders
 * identically and only implies an effect it does not have. The hierarchy is
 * carried by size and colour instead. Giving the card a real bold would mean
 * committing a font file and fetching it at render time, which is a lot of
 * weight for a link preview.
 */
export const OG_SIZE = { width: 1200, height: 630 };

const CANVAS = "#fbfbfa";
const INK = "#1c1b19";
const MUTED = "#6f6b65";
const ACCENT = "#b4531f";

export function OgCard({ headline, note }: { headline: string; note: string }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: CANVAS,
        padding: "72px 80px",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <svg width="52" height="52" viewBox="0 0 32 32">
          <rect width="32" height="32" rx="7" fill={ACCENT} />
          <path d="M11 7h7.2L23 11.8V25H11z" fill="#ffffff" />
          <path d="M18 7v5h5z" fill="#f0c4a8" />
        </svg>
        <div style={{ display: "flex", fontSize: 40, color: INK }}>file</div>
      </div>

      <div
        style={{
          display: "flex",
          fontSize: 68,
          color: INK,
          lineHeight: 1.15,
          letterSpacing: "-0.02em",
          maxWidth: 900,
        }}
      >
        {headline}
      </div>

      {/*
        Aligned to the top, not centred: a note long enough to wrap would
        otherwise leave the dot floating halfway down the block instead of
        sitting on the line it belongs to.
      */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
        <div
          style={{
            width: 14,
            height: 14,
            marginTop: 13,
            borderRadius: 7,
            background: ACCENT,
            display: "flex",
            flexShrink: 0,
          }}
        />
        <div style={{ display: "flex", fontSize: 30, color: MUTED }}>{note}</div>
      </div>
    </div>
  );
}

/** What happens to a file of this format, in one line, for the card. */
export function runtimeNote(runtime: "client" | "server"): string {
  return runtime === "client"
    ? "Read in your browser. The file never leaves your device."
    : "Converted on the server for the length of one request, then discarded.";
}
