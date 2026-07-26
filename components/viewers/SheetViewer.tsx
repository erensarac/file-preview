"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Sheet } from "@/lib/preview";

/**
 * Row height in px. The rows set it explicitly rather than letting content
 * decide, because the windowing maths below needs it to be a known constant.
 */
const ROW_HEIGHT = 33;
/** Rows rendered beyond the viewport, so a fast scroll doesn't show gaps. */
const OVERSCAN = 8;

/** Spreadsheet-style column labels: A, B, … Z, AA, AB, … */
function columnLabel(index: number): string {
  let label = "";
  let n = index;
  while (n >= 0) {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  }
  return label;
}

export default function SheetViewer({ sheets }: { sheets: Sheet[] }) {
  const [active, setActive] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const [rowWindow, setRowWindow] = useState({ start: 0, end: 60 });

  const sheet = sheets[Math.min(active, sheets.length - 1)]!;
  const columnCount = sheet.rows.reduce(
    (max, row) => Math.max(max, row.length),
    0,
  );

  /**
   * Only the visible slice of rows is mounted. Without this a sheet at the
   * preview caps (2,000 rows × 200 columns) puts 400,000 cells in the DOM,
   * which takes ~30s to paint and leaves the tab unresponsive.
   */
  const recompute = useCallback(() => {
    const element = scroller.current;
    if (!element) return;
    const start = Math.max(
      0,
      Math.floor(element.scrollTop / ROW_HEIGHT) - OVERSCAN,
    );
    const visible = Math.ceil(element.clientHeight / ROW_HEIGHT);
    setRowWindow({ start, end: start + visible + OVERSCAN * 2 });
  }, []);

  useEffect(() => {
    recompute();
  }, [recompute, active]);

  // Resizing changes how many rows fit; without this the window keeps the
  // height it was first measured at and a taller viewport shows blank space.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(recompute);
    observer.observe(element);
    return () => observer.disconnect();
  }, [recompute]);

  // Switching sheets should start at the top rather than inherit the previous
  // sheet's scroll position.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [active]);

  const start = Math.min(rowWindow.start, Math.max(0, sheet.rows.length - 1));
  const end = Math.min(rowWindow.end, sheet.rows.length);
  const visibleRows = sheet.rows.slice(start, end);

  return (
    <div className="flex min-h-0 flex-col">
      {sheets.length > 1 && (
        <div
          role="tablist"
          aria-label="Sheets"
          className="flex gap-1 overflow-x-auto border-b border-line px-3 pt-2"
        >
          {sheets.map((candidate, index) => (
            <button
              key={`${candidate.name}-${index}`}
              role="tab"
              aria-selected={index === active}
              onClick={() => setActive(index)}
              className={[
                "shrink-0 rounded-t-lg px-3 py-2 text-sm transition-colors",
                index === active
                  ? "bg-canvas font-medium text-ink"
                  : "text-muted hover:text-ink",
              ].join(" ")}
            >
              {candidate.name}
            </button>
          ))}
        </div>
      )}

      {columnCount === 0 ? (
        <p className="p-8 text-center text-sm text-muted">This sheet is empty.</p>
      ) : (
        <div
          ref={scroller}
          onScroll={recompute}
          className="max-h-[70vh] min-h-0 overflow-auto"
        >
          <table className="w-max border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 border-b border-r border-line bg-canvas px-2 py-1.5 text-xs font-normal text-muted" />
                {Array.from({ length: columnCount }, (_, column) => (
                  <th
                    key={column}
                    className="sticky top-0 z-10 border-b border-r border-line bg-canvas px-3 py-1.5 text-xs font-normal text-muted"
                  >
                    {columnLabel(column)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Spacers stand in for the unmounted rows so the scrollbar
                  reflects the full sheet. */}
              {start > 0 && <tr style={{ height: start * ROW_HEIGHT }} />}

              {visibleRows.map((row, offset) => {
                const rowIndex = start + offset;
                return (
                  <tr key={rowIndex} style={{ height: ROW_HEIGHT }}>
                    <td className="sticky left-0 z-10 border-b border-r border-line bg-canvas px-2 text-right text-xs tabular-nums text-muted">
                      {rowIndex + 1}
                    </td>
                    {Array.from({ length: columnCount }, (_, column) => (
                      <td
                        key={column}
                        className="max-w-100 truncate border-b border-r border-line px-3"
                        title={row[column] || undefined}
                      >
                        {row[column] ?? ""}
                      </td>
                    ))}
                  </tr>
                );
              })}

              {end < sheet.rows.length && (
                <tr style={{ height: (sheet.rows.length - end) * ROW_HEIGHT }} />
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
