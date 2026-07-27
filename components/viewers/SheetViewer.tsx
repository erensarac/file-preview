"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  autoFitWidth,
  fontOf,
  measureColumnWidths,
  MIN_COLUMN_WIDTH,
} from "@/lib/column-widths";
import type { Sheet } from "@/lib/preview";

/**
 * Row height in px. The rows set it explicitly rather than letting content
 * decide, because the windowing maths below needs it to be a known constant.
 */
const ROW_HEIGHT = 33;
/** Rows rendered beyond the viewport, so a fast scroll doesn't show gaps. */
const OVERSCAN = 8;
/** Width of the row-number gutter. */
const GUTTER_WIDTH = 52;

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

interface Drag {
  column: number;
  startX: number;
  startWidth: number;
}

export default function SheetViewer({ sheets }: { sheets: Sheet[] }) {
  const [active, setActive] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const table = useRef<HTMLTableElement>(null);
  const [rowWindow, setRowWindow] = useState({ start: 0, end: 60 });
  const [widths, setWidths] = useState<number[]>([]);
  const drag = useRef<Drag | null>(null);

  const sheet = sheets[Math.min(active, sheets.length - 1)]!;
  const columnCount = sheet.rows.reduce(
    (max, row) => Math.max(max, row.length),
    0,
  );

  /**
   * Column widths are measured once per sheet and then pinned.
   *
   * They cannot be left to the browser: only the rows in view are mounted, so
   * an auto-layout table would resize its columns every time a scroll swapped
   * the mounted rows.
   */
  useLayoutEffect(() => {
    if (!table.current || columnCount === 0) return;
    setWidths(
      measureColumnWidths(
        sheet.rows,
        columnCount,
        fontOf(table.current),
        columnLabel,
      ),
    );
  }, [sheet, columnCount]);

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

  const setWidth = useCallback((column: number, width: number) => {
    setWidths((current) => {
      const next = [...current];
      next[column] = Math.max(MIN_COLUMN_WIDTH, Math.round(width));
      return next;
    });
  }, []);

  /**
   * Drag tracking lives on the window rather than the handle.
   *
   * The pointer leaves the 8px handle almost immediately once a drag starts,
   * and pointer capture interacts badly with the sticky, stacked header cells
   * — listening at the window means the drag follows the cursor wherever it
   * goes, including outside the table.
   */
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const active = drag.current;
      if (!active) return;
      event.preventDefault();
      setWidth(
        active.column,
        active.startWidth + (event.clientX - active.startX),
      );
    };
    const onUp = () => {
      drag.current = null;
      document.body.style.cursor = "";
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [setWidth]);

  const onHandleDown = (column: number) => (event: React.PointerEvent) => {
    event.preventDefault();
    drag.current = {
      column,
      startX: event.clientX,
      startWidth: widths[column] ?? MIN_COLUMN_WIDTH,
    };
    // Keep the resize cursor while the pointer is off the handle.
    document.body.style.cursor = "col-resize";
  };

  /** Excel's double-click behaviour: size the column to its widest value. */
  const onHandleDoubleClick = (column: number) => () => {
    if (!table.current) return;
    setWidth(
      column,
      autoFitWidth(
        sheet.rows,
        column,
        fontOf(table.current),
        columnLabel(column),
      ),
    );
  };

  const start = Math.min(rowWindow.start, Math.max(0, sheet.rows.length - 1));
  const end = Math.min(rowWindow.end, sheet.rows.length);
  const visibleRows = sheet.rows.slice(start, end);
  const totalWidth =
    GUTTER_WIDTH + widths.reduce((sum, width) => sum + width, 0);

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
          <table
            ref={table}
            className="table-fixed border-collapse text-sm"
            style={widths.length > 0 ? { width: totalWidth } : undefined}
          >
            <colgroup>
              <col style={{ width: GUTTER_WIDTH }} />
              {widths.map((width, column) => (
                <col key={column} style={{ width }} />
              ))}
            </colgroup>

            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 border-b border-r border-line bg-canvas px-2 py-1.5 text-xs font-normal text-muted" />
                {widths.map((_, column) => (
                  <th
                    key={column}
                    // `sticky` already establishes the containing block the
                    // handle positions against, so no `relative` here.
                    className="sticky top-0 z-10 border-b border-r border-line bg-canvas px-3 py-1.5 text-xs font-normal text-muted"
                  >
                    <span className="block truncate">
                      {columnLabel(column)}
                    </span>
                    {/*
                      Drag to resize, double-click to fit the widest value —
                      the two gestures Excel puts on this same edge.
                    */}
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Resize column ${columnLabel(column)}`}
                      data-testid={`resize-${column}`}
                      onPointerDown={onHandleDown(column)}
                      onDoubleClick={onHandleDoubleClick(column)}
                      // Sits fully inside its own cell: the next header is
                      // sticky and later in DOM order, so anything overhanging
                      // the border would be covered by it and never hit.
                      className="absolute right-0 top-0 z-10 h-full w-2 cursor-col-resize touch-none select-none hover:bg-accent/60"
                    />
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
                    {widths.map((_, column) => (
                      <td
                        key={column}
                        className="truncate border-b border-r border-line px-3"
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
