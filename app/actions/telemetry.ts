"use server";

import { FORMATS, getFormat, type FormatId } from "@/lib/formats";
import {
  safeErrorName,
  SIZE_BUCKETS,
  type FailurePhase,
} from "@/lib/telemetry";
import { reportFailure } from "@/lib/report-failure";

/**
 * Where a client-side failure goes.
 *
 * A file parsed in the browser fails in the browser, where `console.error`
 * reaches nobody — so pdf.js refusing a document, or a decoder giving up on an
 * image, was invisible to us no matter how often it happened.
 *
 * This is the one thing a client-runtime format sends anywhere, and only when
 * it has already failed. It carries the format, the phase and the error's
 * class; the file itself, its name and the error message stay on the device.
 *
 * Every field is validated rather than trusted. This action is reachable by
 * anyone, and its output lands in a log — so an unvalidated field is a way to
 * write arbitrary text into our logs and make them say whatever the caller
 * likes. Anything unrecognised is dropped rather than sanitised, because there
 * is no legitimate call that needs it.
 */

const PHASES = new Set<FailurePhase>(["guard", "parse", "render"]);

function knownFormat(value: unknown): FormatId | null {
  return typeof value === "string" &&
    FORMATS.some((format) => format.id === value)
    ? (value as FormatId)
    : null;
}

export async function reportClientFailure(input: {
  formatId?: unknown;
  phase?: unknown;
  errorName?: unknown;
  sizeBucket?: unknown;
}): Promise<void> {
  const formatId = knownFormat(input.formatId);
  if (!formatId) return;

  const phase = input.phase as FailurePhase;
  if (!PHASES.has(phase)) return;

  /*
   * A band, computed on the client. The exact byte count never crosses the
   * network — an earlier version took a number here and banded it on arrival,
   * which meant the precise size had already left the device.
   *
   * Checked against the known set rather than trusted, for the same reason
   * every other field is: this string is about to be written into a log.
   */
  const band =
    typeof input.sizeBucket === "string" &&
    SIZE_BUCKETS.includes(input.sizeBucket)
      ? input.sizeBucket
      : "unknown";

  reportFailure({
    formatId,
    // Taken from the registry rather than from the caller: a client cannot
    // claim a failure happened in a runtime it did not happen in.
    runtime: getFormat(formatId).runtime,
    phase,
    errorName: safeErrorName(input.errorName),
    sizeBucket: band,
  });
}
