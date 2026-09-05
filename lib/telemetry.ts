/**
 * What we record when a file fails to open.
 *
 * Nothing here was observable before: server failures went to `console.error`
 * where they are unaggregated and unalerted, and client failures reached
 * nobody at all. So a parser choking on a shape of workbook nobody has seen
 * produced a generic message for every user with that shape, and we never
 * found out.
 *
 * ── The constraint ───────────────────────────────────────────────────────
 *
 * The product's claim is that a file read in the browser never leaves the
 * device, and most of them are. A failure report must not quietly undo that.
 * So the shape below is an allowlist, and three things are deliberately
 * absent:
 *
 * - **The filename.** Often the most sensitive part of a document —
 *   "redundancies-final.xlsx" says plenty without opening it.
 * - **The error message.** Parser errors quote file contents; that is exactly
 *   why the user-facing message is generic, and it would be perverse to log
 *   what we refuse to display.
 * - **The exact size.** A byte count is weakly identifying across reports, and
 *   a bucket answers every question worth asking of it.
 *
 * What is left is the format, where it broke, and the class of error. That is
 * enough to notice "every .xlsm has been failing since Tuesday", which is the
 * question this exists to answer.
 */

import type { FormatId, Runtime } from "./formats";

/** Where in the pipeline it went wrong. */
export type FailurePhase =
  /** Refused before a parser ran: an archive guard, an encrypted container. */
  | "guard"
  /** The parser itself threw. */
  | "parse"
  /** Parsed, but the viewer could not display it — pdf.js, image decoding. */
  | "render";

export interface FailureReport {
  formatId: FormatId;
  runtime: Runtime;
  phase: FailurePhase;
  /** The error's class name, never its message. */
  errorName: string;
  sizeBucket: string;
}

/**
 * A class name, or nothing.
 *
 * Constrained rather than trusted: this value is logged, and on the client
 * path it arrives over the network where anything could be put in it. A name
 * that does not look like a class name is discarded rather than escaped,
 * because there is no legitimate case for one and a log line is a place where
 * injected text does real damage.
 */
export function safeErrorName(value: unknown): string {
  const name =
    value instanceof Error
      ? value.constructor?.name || value.name
      : typeof value === "string"
        ? value
        : "";

  return /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name) ? name : "UnknownError";
}

const BUCKETS = [64 * 1024, 1024 * 1024, 4 * 1024 * 1024, 16 * 1024 * 1024];
const BUCKET_LABELS = ["<64KB", "<1MB", "<4MB", "<16MB"];

/** Every value `sizeBucket` can produce, so a caller's claim can be checked. */
export const SIZE_BUCKETS: readonly string[] = [
  ...BUCKET_LABELS,
  "16MB+",
  "unknown",
];

/**
 * A size band rather than a byte count.
 *
 * Called on the client, before anything is sent — not on the server after.
 * Bucketing on arrival would mean the exact byte count had already left the
 * device, which is the thing being avoided. A test caught that: the first
 * version of this sent `size: 26` over the wire and banded it on the far side.
 */
export function sizeBucket(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown";
  for (let i = 0; i < BUCKETS.length; i += 1) {
    if (bytes < BUCKETS[i]!) return BUCKET_LABELS[i]!;
  }
  return "16MB+";
}

/** The prefix a log drain or a search can key on. */
export const FAILURE_PREFIX = "file.failure";

/**
 * The same report as an analytics event.
 *
 * It lives here rather than beside the code that sends it, and that is the
 * point: the payload is built from a `FailureReport`, so the three things this
 * file argues should never be sent cannot be added to the second route without
 * passing the type that explains why they are absent.
 *
 * Kept apart from the sending for one more reason — the honest check for a
 * payload is its contents, and a test that can read this needs no vendor, no
 * network and no server.
 */
export function failureEvent(report: FailureReport): {
  name: string;
  properties: Record<string, string>;
} {
  return {
    // The same prefix as the log line, so a search for one finds the other.
    name: FAILURE_PREFIX,
    properties: {
      format: report.formatId,
      runtime: report.runtime,
      phase: report.phase,
      error: report.errorName,
      size: report.sizeBucket,
    },
  };
}

/**
 * One line, stable field order, no interpolated free text.
 *
 * Structured enough to grep and to aggregate, without pulling in a logging
 * library for four fields.
 */
export function formatFailure(report: FailureReport): string {
  return [
    FAILURE_PREFIX,
    `format=${report.formatId}`,
    `runtime=${report.runtime}`,
    `phase=${report.phase}`,
    `error=${report.errorName}`,
    `size=${report.sizeBucket}`,
  ].join(" ");
}
