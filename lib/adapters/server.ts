import "server-only";

/**
 * Server-side adapters.
 *
 * These handle the binary Office formats, whose parsers are far too heavy to
 * ship to the browser. The file arrives as a buffer from the server action, is
 * parsed in memory, and is dropped when the request ends — nothing is written
 * to disk and nothing is persisted.
 */

import { getFormat, type FormatId } from "../formats";
import {
  MAX_PREVIEW_ROWS,
  type Preview,
  type PreviewDocument,
} from "../preview";

/** Column cap per sheet, so one pathological file can't produce a 10k-wide table. */
const MAX_PREVIEW_COLUMNS = 200;

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

  const sheets = workbook.worksheets.map((worksheet) => {
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

      const cells: string[] = [];
      for (let column = 1; column <= columnCount; column += 1) {
        cells.push(cellToString(row.getCell(column).value));
      }
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

  if (sheets.length === 0) {
    throw new Error("This workbook has no sheets.");
  }

  return { kind: "sheet", sheets };
};

const parseDocx: ServerParser = async (bytes, notices) => {
  const [{ default: mammoth }, { default: DOMPurify }] = await Promise.all([
    import("mammoth"),
    import("isomorphic-dompurify"),
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

  return { kind: "html", html: DOMPurify.sanitize(value) };
};

const PARSERS: Partial<Record<FormatId, ServerParser>> = {
  xlsx: parseXlsx,
  docx: parseDocx,
};

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
