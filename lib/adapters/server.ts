import "server-only";

/**
 * Server-side adapters.
 *
 * These handle the binary Office formats, whose parsers are far too heavy to
 * ship to the browser. The file arrives as a buffer from the server action, is
 * parsed in memory, and is dropped when the request ends — nothing is written
 * to disk and nothing is persisted.
 */

import { FORMATS, getFormat, type FormatId } from "../formats";
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
 * This bounds the response we build and send. It does not bound the library's
 * own peak memory while unzipping, which stays exposed to a decompression bomb;
 * that needs a limit at the request layer.
 */
const MAX_PREVIEW_CELLS = 100_000;
const MAX_PREVIEW_SHEETS = 50;
/** Word documents can expand the same way; DOMPurify repairs the cut. */
const MAX_PREVIEW_HTML_BYTES = 2 * 1024 * 1024;

/**
 * exceljs ships `declare interface Buffer extends ArrayBuffer {}` at global
 * scope, which merges with @types/node's `Buffer` into a type no real Node
 * buffer satisfies. Rather than let that spread, bytes travel through this
 * module as `Uint8Array` and get re-cast at the two library call sites below.
 */
type ServerParser = (
  bytes: Uint8Array,
  notices: string[],
) => Promise<Preview>;

/**
 * ExcelJS hands back a union of primitives and small objects (formulas, rich
 * text, hyperlinks, errors). The preview only ever displays the resolved value,
 * so everything collapses to a string here.
 */
function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const cell = value as Record<string, unknown>;
    if ("richText" in cell && Array.isArray(cell.richText)) {
      return cell.richText
        .map((run) => String((run as { text?: unknown }).text ?? ""))
        .join("");
    }
    // Formulas: show what Excel last computed, not the expression.
    if ("result" in cell) return cellToString(cell.result);
    if ("text" in cell) return String(cell.text ?? "");
    if ("error" in cell) return String(cell.error);
    return "";
  }
  return String(value);
}

const parseXlsx: ServerParser = async (bytes, notices) => {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  // Cast per the Buffer note above; exceljs reads Uint8Array fine at runtime.
  await workbook.xlsx.load(bytes as never);

  const worksheets = workbook.worksheets.slice(0, MAX_PREVIEW_SHEETS);
  if (workbook.worksheets.length > worksheets.length) {
    notices.push(
      `This workbook has ${workbook.worksheets.length} sheets; showing the first ${worksheets.length}.`,
    );
  }

  let cellBudget = MAX_PREVIEW_CELLS;
  let budgetExhausted = false;

  const sheets = worksheets.map((worksheet) => {
    const columnCount = Math.min(worksheet.columnCount, MAX_PREVIEW_COLUMNS);
    if (worksheet.columnCount > columnCount) {
      notices.push(
        `"${worksheet.name}" has ${worksheet.columnCount} columns; showing the first ${columnCount}.`,
      );
    }

    const rows: string[][] = [];
    let totalRows = 0;

    worksheet.eachRow({ includeEmpty: true }, (row) => {
      totalRows += 1;
      if (rows.length >= MAX_PREVIEW_ROWS) return;
      if (cellBudget < columnCount) {
        budgetExhausted = true;
        return;
      }

      const cells: string[] = [];
      for (let column = 1; column <= columnCount; column += 1) {
        cells.push(cellToString(row.getCell(column).value));
      }
      cellBudget -= columnCount;
      // Ragged rows render fine and keep wide-but-sparse sheets readable.
      while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
      rows.push(cells);
    });

    if (totalRows > rows.length) {
      notices.push(
        `"${worksheet.name}": showing the first ${rows.length.toLocaleString()} of ${totalRows.toLocaleString()} rows.`,
      );
    }

    return { name: worksheet.name, rows, totalRows };
  });

  if (budgetExhausted) {
    notices.push(
      `Preview truncated at ${MAX_PREVIEW_CELLS.toLocaleString()} cells.`,
    );
  }

  if (sheets.length === 0) {
    throw new Error("This workbook has no sheets.");
  }

  return { kind: "sheet", sheets };
};

const parseDocx: ServerParser = async (bytes, notices) => {
  // Word goes through the same document pass as Markdown: it carries the same
  // relative hrefs, and its headings deserve the same ids.
  const [{ default: mammoth }, { default: DOMPurify }, { sanitizeDocumentHtml }] =
    await Promise.all([
      import("mammoth"),
      import("isomorphic-dompurify"),
      import("../document-html"),
    ]);

  // mammoth's Node build only unzips from a path or a real Buffer, so unlike
  // exceljs this genuinely needs the conversion, not just a cast.
  const { value, messages } = await mammoth.convertToHtml({
    buffer: Buffer.from(bytes) as never,
  });

  // Mammoth is chatty about unmapped styles; a handful is useful context, the
  // rest is noise.
  const warnings = [...new Set(messages.map((m) => m.message))];
  for (const warning of warnings.slice(0, 3)) notices.push(warning);
  if (warnings.length > 3) {
    notices.push(`…and ${warnings.length - 3} more conversion warnings.`);
  }

  if (value.trim() === "") {
    throw new Error("This document appears to be empty.");
  }

  let html = value;
  if (html.length > MAX_PREVIEW_HTML_BYTES) {
    // Cutting mid-tag is fine: DOMPurify parses and re-serializes, so the
    // truncated markup comes back balanced.
    html = html.slice(0, MAX_PREVIEW_HTML_BYTES);
    notices.push("Document is very large; the preview has been truncated.");
  }

  return { kind: "html", html: sanitizeDocumentHtml(DOMPurify, html) };
};

const PARSERS: Partial<Record<FormatId, ServerParser>> = {
  xlsx: parseXlsx,
  docx: parseDocx,
};

// Mirrors the assertion in the client adapter: a format whose runtime and
// parser disagree otherwise surfaces as a nonsensical error at the far end.
if (process.env.NODE_ENV !== "production") {
  const missing = FORMATS.filter(
    (f) => f.runtime === "server" && !(f.id in PARSERS),
  ).map((f) => f.id);
  if (missing.length > 0) {
    throw new Error(
      `Formats declared runtime: "server" with no server parser: ${missing.join(", ")}`,
    );
  }
}

export function hasServerParser(id: FormatId): boolean {
  return id in PARSERS;
}

export async function parseOnServer(
  file: { name: string; size: number; bytes: Uint8Array },
  formatId: FormatId,
): Promise<PreviewDocument> {
  const parser = PARSERS[formatId];
  if (!parser) {
    throw new Error(`${formatId} has no server parser`);
  }

  const spec = getFormat(formatId);
  const notices: string[] = [];
  const preview = await parser(file.bytes, notices);

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
