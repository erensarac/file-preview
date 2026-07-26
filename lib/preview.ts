/**
 * The contract between parsers and viewers.
 *
 * Every adapter — client or server — reduces a file to one of a small number of
 * `Preview` shapes, and each shape has exactly one viewer component. That's what
 * keeps adding a format cheap: a new format picks an existing shape and gets a
 * working UI for free, and only genuinely new *kinds* of content need a viewer.
 *
 * These values cross the server-action boundary, so they must stay
 * serializable — plain objects, no class instances, no functions.
 */

import type { FormatId } from "./formats";

export interface Sheet {
  name: string;
  /** Row-major cells, already stringified for display. Rows may be ragged. */
  rows: string[][];
  /** Total rows in the source, which may exceed `rows.length` when truncated. */
  totalRows: number;
}

export type Preview =
  | { kind: "sheet"; sheets: Sheet[] }
  /** Pre-sanitized HTML. Markdown and Word both land here. */
  | { kind: "html"; html: string }
  | { kind: "text"; text: string; language: string };

export interface PreviewMeta {
  name: string;
  size: number;
  formatId: FormatId;
  formatLabel: string;
  /** Where this file was parsed — surfaced in the UI so the user can see it. */
  parsedIn: "browser" | "server";
  /** Non-fatal notes from the parser, e.g. dropped Word styles or truncation. */
  notices: string[];
}

export interface PreviewDocument {
  meta: PreviewMeta;
  preview: Preview;
}

export type PreviewResult =
  | { ok: true; document: PreviewDocument }
  | { ok: false; error: string };

/** Row cap applied to spreadsheets so a huge sheet can't lock up the tab. */
export const MAX_PREVIEW_ROWS = 2000;
