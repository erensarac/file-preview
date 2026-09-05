import "server-only";

import { track } from "@vercel/analytics/server";

import {
  failureEvent,
  formatFailure,
  type FailureReport,
} from "./telemetry";

/**
 * Where a failed open is recorded, now in two places.
 *
 * The structured line was written from the day failures became observable, and
 * during a release in which *no Office file could be opened at all* it helped
 * nobody: the diagnosis came from driving a browser at production, not from
 * anything we had built. A log that only a dashboard visit reveals is not
 * observability, it is an archive.
 *
 * So the same report also goes out as an analytics event. That is not a new
 * dependency or a new vendor — `@vercel/analytics` is already here for traffic,
 * already cookieless, already same-origin — and a custom event lands in a page
 * someone looks at, where "every .xlsm since Tuesday" is a filter rather than
 * an afternoon.
 *
 * ── What it does not change ──────────────────────────────────────────────
 *
 * The fields. Exactly the five that `lib/telemetry.ts` allows, which is why
 * the payload is built from a `FailureReport` rather than assembled here: no
 * filename, no error message, no exact size, and no way to add one without
 * going through the type that documents why they are absent.
 */

export function reportFailure(report: FailureReport): void {
  // The line first, and unconditionally. It is the record that survives a
  // vendor being unreachable, a plan that does not include custom events, or
  // any other reason the second half might quietly do nothing.
  console.error(formatFailure(report));

  // Gated the same way the traffic component is: a preview deployment and a
  // local run would otherwise write into the numbers a production question is
  // asked of.
  if (process.env.VERCEL_ENV !== "production") return;

  const event = failureEvent(report);
  /*
   * Never awaited, and never allowed to throw. Reporting a failure must not be
   * able to become a second failure — the caller is already on its error path,
   * and an exception here would replace a useful message to the user with an
   * unhandled one.
   */
  void track(event.name, event.properties).catch(() => {});
}
