import "server-only";

/**
 * Server-side adapters.
 *
 * These handle the binary Office formats, whose parsers are far too heavy to
 * ship to the browser. The file arrives as a buffer from the server action, is
 * parsed in memory, and is dropped when the request ends — nothing is written
 * to disk and nothing is persisted.
 *
 * The parsing itself happens in a worker thread (`lib/parse-runner.ts`), so a
 * document that never finishes can be stopped rather than merely abandoned.
 * What stays here is everything that needs the type system or the sanitizer:
 * the budgets below, and the document pass Word shares with Markdown.
 */

import { getFormat, type FormatId } from "../formats";
import { runParseInWorker, type WorkerLimits } from "../parse-runner";
import {
  MAX_PREVIEW_ROWS,
  type Preview,
  type PreviewDocument,
} from "../preview";

/** Column cap per sheet, so one pathological file can't produce a 10k-wide table. */
const MAX_PREVIEW_COLUMNS = 200;

/**
 * Budgets on what a parse is allowed to *produce*.
 *
 * `maxBytes` in the registry only bounds the compressed upload, and these are
 * zip archives: a small file can legitimately expand to an enormous grid, and a
 * hostile one is built to. Per-sheet caps alone don't help, because a workbook
 * can carry hundreds of sheets — so the cell budget is spent across the whole
 * workbook, not reset per sheet.
 *
 * These bound the response we build and send. They do not bound the library's
 * own peak memory while unzipping; the worker's wall-clock budget is what
 * stops that running away indefinitely.
 */
const MAX_PREVIEW_CELLS = 100_000;
const MAX_PREVIEW_SHEETS = 50;
/** Word documents can expand the same way; DOMPurify repairs the cut. */
const MAX_PREVIEW_HTML_BYTES = 2 * 1024 * 1024;

/**
 * Passed to the worker rather than declared there.
 *
 * The worker is plain JavaScript loaded by path, so it cannot import these —
 * and duplicating them would mean two numbers to keep in step, with nothing
 * to notice when they drift.
 */
const LIMITS: WorkerLimits = {
  maxRows: MAX_PREVIEW_ROWS,
  maxColumns: MAX_PREVIEW_COLUMNS,
  maxCells: MAX_PREVIEW_CELLS,
  maxSheets: MAX_PREVIEW_SHEETS,
  maxHtmlBytes: MAX_PREVIEW_HTML_BYTES,
};

const SERVER_FORMATS = new Set<FormatId>(["xlsx", "xls", "docx"]);

export function hasServerParser(id: FormatId): boolean {
  return SERVER_FORMATS.has(id);
}

export async function parseOnServer(
  file: { name: string; size: number; bytes: Uint8Array },
  formatId: FormatId,
): Promise<PreviewDocument> {
  if (!hasServerParser(formatId)) {
    throw new Error(`${formatId} has no server parser`);
  }

  const spec = getFormat(formatId);
  const { result, notices } = await runParseInWorker(
    formatId,
    file.bytes,
    LIMITS,
  );

  let preview: Preview;
  if (result.kind === "sheet") {
    preview = { kind: "sheet", sheets: result.sheets };
  } else {
    /*
     * Word's HTML is sanitized here rather than in the worker, so document
     * policy — heading ids, stripped relative targets, focusable code blocks —
     * is applied in exactly one place for both Markdown and Word.
     */
    const [{ default: DOMPurify }, { sanitizeDocumentHtml }] = await Promise.all([
      import("isomorphic-dompurify"),
      import("../document-html"),
    ]);
    preview = { kind: "html", html: sanitizeDocumentHtml(DOMPurify, result.html) };
  }

  return {
    meta: {
      name: file.name,
      size: file.size,
      formatId,
      formatLabel: spec.label,
      parsedIn: "server",
      notices,
    },
    preview,
  };
}
