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
  | { kind: "text"; text: string; language: string }
  /**
   * PDF is the one shape that carries its source rather than a rendered
   * result. Rendering a page is a canvas operation that only the browser can
   * do, and doing every page up front would mean holding a bitmap of the whole
   * document in memory to show the first screen of it — so the viewer keeps
   * the bytes and renders pages as they are scrolled to.
   */
  | { kind: "pdf"; bytes: Uint8Array }
  /**
   * An image, carried as its source for the same reason PDF is: the browser
   * is the decoder. The viewer wraps these bytes in a blob URL and releases it
   * again when the pane is replaced — keeping the bytes rather than the URL
   * puts creating and revoking it in one place, which is what stops a leak
   * per opened file.
   */
  | { kind: "image"; bytes: Uint8Array; mimeType: string };

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
