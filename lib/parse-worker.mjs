/**
 * The Office parsers, in a thread of their own.
 *
 * Plain `.mjs` rather than TypeScript on purpose: this file is loaded by path
 * at runtime, outside the bundle, so it cannot import anything that needs
 * compiling. Every limit it applies is passed in from `lib/adapters/server.ts`
 * instead of being declared here, so there is still one source of truth.
 *
 * It exists so a parse can be *killed*. `exceljs` and `mammoth` are synchronous
 * enough that a runaway document blocks the event loop, and nothing in the
 * request path can interrupt that — a `Promise.race` returns a response while
 * the work carries on holding memory and a concurrency slot, which is worse
 * than having no timeout at all. `worker.terminate()` genuinely stops it:
 * measured at 4 ms against a loop that never yields.
 *
 * It deliberately does *not* sanitize. Word's HTML goes back to the main
 * thread raw and through the same DOMPurify pass as Markdown, so there is one
 * place where document policy is applied rather than two.
 */

import { parentPort, workerData } from "node:worker_threads";

/**
 * ExcelJS hands back a union of primitives and small objects — formulas, rich
 * text, hyperlinks, errors. The preview only shows the resolved value.
 */
function cellToString(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((run) => String(run.text ?? "")).join("");
    }
    // Formulas: what Excel last computed, not the expression.
    if ("result" in value) return cellToString(value.result);
    if ("text" in value) return String(value.text ?? "");
    if ("error" in value) return String(value.error);
    return "";
  }
  return String(value);
}

async function parseXlsx(bytes, limits, notices) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);

  const worksheets = workbook.worksheets.slice(0, limits.maxSheets);
  if (workbook.worksheets.length > worksheets.length) {
    notices.push(
      `This workbook has ${workbook.worksheets.length} sheets; showing the first ${worksheets.length}.`,
    );
  }

  let cellBudget = limits.maxCells;
  let budgetExhausted = false;

  const sheets = worksheets.map((worksheet) => {
    const columnCount = Math.min(worksheet.columnCount, limits.maxColumns);
    if (worksheet.columnCount > columnCount) {
      notices.push(
        `"${worksheet.name}" has ${worksheet.columnCount} columns; showing the first ${columnCount}.`,
      );
    }

    const rows = [];
    let totalRows = 0;

    worksheet.eachRow({ includeEmpty: true }, (row) => {
      totalRows += 1;
      if (rows.length >= limits.maxRows) return;
      if (cellBudget < columnCount) {
        budgetExhausted = true;
        return;
      }

      const cells = [];
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
      `Preview truncated at ${limits.maxCells.toLocaleString()} cells.`,
    );
  }

  if (sheets.length === 0) throw new Error("This workbook has no sheets.");

  return { kind: "sheet", sheets };
}

async function parseDocx(bytes, limits, notices) {
  const mammoth = (await import("mammoth")).default;

  // mammoth's Node build only unzips from a path or a real Buffer, so this is
  // a genuine conversion rather than a cast.
  const { value, messages } = await mammoth.convertToHtml({
    buffer: Buffer.from(bytes),
  });

  // Mammoth is chatty about unmapped styles; a handful is context, the rest is
  // noise.
  const warnings = [...new Set(messages.map((message) => message.message))];
  for (const warning of warnings.slice(0, 3)) notices.push(warning);
  if (warnings.length > 3) {
    notices.push(`…and ${warnings.length - 3} more conversion warnings.`);
  }

  if (value.trim() === "") throw new Error("This document appears to be empty.");

  let html = value;
  if (html.length > limits.maxHtmlBytes) {
    // Cutting mid-tag is fine: DOMPurify parses and re-serializes on the main
    // thread, so the truncated markup comes back balanced.
    html = html.slice(0, limits.maxHtmlBytes);
    notices.push("Document is very large; the preview has been truncated.");
  }

  // Raw. The sanitizing pass lives on the other side.
  return { kind: "raw-html", html };
}

const PARSERS = { xlsx: parseXlsx, docx: parseDocx };

(async () => {
  const { formatId, bytes, limits } = workerData;
  const notices = [];

  try {
    const parser = PARSERS[formatId];
    if (!parser) throw new Error(`${formatId} has no server parser`);
    const result = await parser(bytes, limits, notices);
    parentPort.postMessage({ ok: true, result, notices });
  } catch (error) {
    /*
     * The message is sent back rather than thrown, so the runner sees a normal
     * result and not a worker crash. A parser error can quote file contents,
     * so the caller logs it and shows something generic — the same rule as
     * before this ran in a thread.
     */
    parentPort.postMessage({
      ok: false,
      name: error?.constructor?.name ?? "Error",
      message: String(error?.message ?? error),
    });
  }
})();
