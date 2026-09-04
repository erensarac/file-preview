"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  autoFitWidth,
  fontOf,
  measureColumnWidths,
  MIN_COLUMN_WIDTH,
} from "@/lib/column-widths";
import type { Sheet } from "@/lib/preview";
import { findMatches, scrollTopFor, step } from "@/lib/sheet-find";
import {
  nextDirection,
  sortedOrder,
  type SortDirection,
} from "@/lib/sheet-sort";

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
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [rowWindow, setRowWindow] = useState({ start: 0, end: 60 });
  /**
   * Widths per sheet, not per viewer.
   *
   * Measuring on every sheet change threw away anything the user had set:
   * widen a column, look at another sheet, come back, and it was back to the
   * measured width. Keyed by sheet index so each keeps its own.
   *
   * This lives in component state deliberately, not in storage. The pane is
   * remounted per opened file, so widths last exactly as long as the file is
   * open — remembering them across visits would mean keeping a record of which
   * files someone opened, which is not a trade this project should make for a
   * column width.
   */
  const [widthsBySheet, setWidthsBySheet] = useState<Record<number, number[]>>(
    {},
  );
  const drag = useRef<Drag | null>(null);

  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  /*
   * Deferred so typing stays responsive. Scanning every cell of a large sheet
   * is fast but not free, and doing it between keystrokes is what would make
   * the input feel heavy on exactly the files this exists for.
   */
  const deferredQuery = useDeferredValue(query);
  const [onlyMatching, setOnlyMatching] = useState(false);
  const [sort, setSort] = useState<{
    column: number;
    direction: SortDirection;
  } | null>(null);

  const widths = widthsBySheet[active] ?? [];

  const sheet = sheets[Math.min(active, sheets.length - 1)]!;
  const columnCount = sheet.rows.reduce(
    (max, row) => Math.max(max, row.length),
    0,
  );

  /**
   * What is on screen, as indices into the sheet's own rows.
   *
   * Filter first, then sort: sorting a set and then removing from it is the
   * same result for more work, and keeping the two steps in this order means
   * the sort is always over exactly what the reader can see.
   *
   * The rows themselves are never reordered or copied. This is a way of
   * reading them, which is what makes clearing a sort exact rather than a
   * best effort at putting them back.
   */
  const order = useMemo(() => {
    const needle = onlyMatching ? deferredQuery.trim().toLowerCase() : "";

    let base: number[];
    if (needle === "") {
      base = Array.from({ length: sheet.rows.length }, (_, index) => index);
    } else {
      base = [];
      for (let row = 0; row < sheet.rows.length; row += 1) {
        if (
          sheet.rows[row]!.some(
            (cell) => cell && cell.toLowerCase().includes(needle),
          )
        ) {
          base.push(row);
        }
      }
    }

    return sort ? sortedOrder(sheet.rows, base, sort.column, sort.direction) : base;
  }, [sheet, sort, onlyMatching, deferredQuery]);

  const hidden = sheet.rows.length - order.length;

  const matches = useMemo(
    () => findMatches(sheet.rows, deferredQuery, order),
    [sheet, deferredQuery, order],
  );
  /** Clamped rather than reset: a shrinking result set should not jump home. */
  const current = matches.length === 0 ? -1 : Math.min(matchIndex, matches.length - 1);

  /**
   * Scrolling to a match is the only reason this component moves the scroller
   * itself. The row it wants is usually not mounted, so it cannot be reached
   * with `scrollIntoView` — the position is computed from the row index and
   * the window follows from the scroll event, the same way it does for a drag
   * of the scrollbar.
   */
  const goTo = useCallback(
    (index: number) => {
      const element = scroller.current;
      const match = matches[index];
      if (!element || !match) return;
      setMatchIndex(index);
      element.scrollTop = scrollTopFor(
        // The place on screen, not the row of the file: after a sort they are
        // different numbers and only one of them scrolls anywhere useful.
        match.position,
        ROW_HEIGHT,
        element.clientHeight,
        order.length,
      );
    },
    [matches, order.length],
  );

  // A new search starts at the first match rather than wherever the last one
  // left off, and takes the view with it.
  useEffect(() => {
    setMatchIndex(0);
    if (matches.length > 0) goTo(0);
    // `goTo` depends on `matches`; running this on every `goTo` identity would
    // drag the view back to the first match after every Next.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferredQuery, active]);

  /**
   * Column widths are measured once per sheet and then pinned.
   *
   * They cannot be left to the browser: only the rows in view are mounted, so
   * an auto-layout table would resize its columns every time a scroll swapped
   * the mounted rows.
   */
  useLayoutEffect(() => {
    const element = table.current;
    if (!element || columnCount === 0) return;

    setWidthsBySheet((current) => {
      // Only the first visit measures. A later one keeps whatever is there,
      // which is what makes a manual width survive a trip to another sheet.
      if (current[active]) return current;
      return {
        ...current,
        [active]: measureColumnWidths(
          sheet.rows,
          columnCount,
          fontOf(element),
          columnLabel,
        ),
      };
    });
  }, [active, sheet, columnCount]);

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

  // A sort belongs to the column it was applied to, and column C of another
  // sheet is a different column. Carrying it across would silently reorder a
  // sheet the reader has not sorted.
  useEffect(() => {
    setSort(null);
  }, [active]);

  const setWidth = useCallback(
    (column: number, width: number) => {
      setWidthsBySheet((current) => {
        const existing = current[active];
        if (!existing) return current;

        const next = [...existing];
        next[column] = Math.max(MIN_COLUMN_WIDTH, Math.round(width));
        return { ...current, [active]: next };
      });
    },
    [active],
  );

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

  const onHandleKeyDown =
    (column: number) => (event: React.KeyboardEvent) => {
      const current = widths[column] ?? MIN_COLUMN_WIDTH;
      // Shift for a coarse step, matching how the same keys behave on a
      // native range input.
      const step = event.shiftKey ? 40 : 8;

      if (event.key === "ArrowRight") {
        event.preventDefault();
        setWidth(column, current + step);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setWidth(column, current - step);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onHandleDoubleClick(column)();
      }
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

  const start = Math.min(rowWindow.start, Math.max(0, order.length - 1));
  const end = Math.min(rowWindow.end, order.length);
  const visiblePositions = order.slice(start, end);
  const matchable = deferredQuery.trim().toLowerCase();
  const totalWidth =
    GUTTER_WIDTH + widths.reduce((sum, width) => sum + width, 0);

  return (
    <div className="flex min-h-0 flex-col">
      {sheets.length > 1 && (
        <div
          role="tablist"
          aria-label="Sheets"
          className="flex gap-1 overflow-x-auto border-b border-line px-3 pt-2"
          // Roving tabindex: one Tab stop for the whole strip, arrows to move
          // within it. Tabbing through every sheet of a large workbook would
          // otherwise be the only way past this control.
          onKeyDown={(event) => {
            const step =
              event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
            let next = active;
            if (step !== 0) {
              next = (active + step + sheets.length) % sheets.length;
            } else if (event.key === "Home") {
              next = 0;
            } else if (event.key === "End") {
              next = sheets.length - 1;
            } else {
              return;
            }
            event.preventDefault();
            setActive(next);
            tabs.current[next]?.focus();
          }}
        >
          {sheets.map((candidate, index) => (
            <button
              key={`${candidate.name}-${index}`}
              ref={(element) => {
                tabs.current[index] = element;
              }}
              role="tab"
              id={`sheet-tab-${index}`}
              aria-controls="sheet-panel"
              aria-selected={index === active}
              tabIndex={index === active ? 0 : -1}
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

      {columnCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-xs">
          <label htmlFor="sheet-find" className="sr-only">
            Find in sheet
          </label>
          <input
            id="sheet-find"
            type="search"
            value={query}
            placeholder="Find in sheet"
            data-testid="sheet-find"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setQuery("");
                return;
              }
              if (event.key !== "Enter" || matches.length === 0) return;
              // Enter for the next match, Shift+Enter for the previous one —
              // what every find bar does, so the hands already know it.
              event.preventDefault();
              goTo(step(current, matches.length, event.shiftKey ? -1 : 1));
            }}
            className="w-44 rounded border border-line bg-canvas px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          />
          {/*
            Announced, because the result of a search is not visible to
            someone who cannot see the highlighted cell. `role="status"` is
            polite: it waits rather than interrupting what is being read.
          */}
          <span role="status" data-testid="find-count" className="text-muted">
            {query.trim() === ""
              ? ""
              : matches.length === 0
                ? "No matches"
                : `${current + 1} of ${matches.length.toLocaleString()}`}
          </span>
          <label className="flex items-center gap-1.5 text-muted">
            <input
              type="checkbox"
              checked={onlyMatching}
              data-testid="only-matching"
              onChange={(event) => setOnlyMatching(event.target.checked)}
            />
            Only matching rows
          </label>
          {hidden > 0 && (
            <span data-testid="hidden-count" className="text-muted">
              {hidden.toLocaleString()} hidden
            </span>
          )}
          {/*
            Said out loud when it is true, because the alternative is a sorted
            column that quietly answers a different question. On a truncated
            sheet the largest value on screen is the largest of what was sent,
            not of the file — and a reader who sorted descending to find the
            maximum has every reason to think otherwise.
          */}
          {sort && sheet.totalRows > sheet.rows.length && (
            <span data-testid="sort-scope" className="text-muted">
              Sorted within the first {sheet.rows.length.toLocaleString()} rows
              shown
            </span>
          )}

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              aria-label="Previous match"
              disabled={matches.length === 0}
              onClick={() => goTo(step(current, matches.length, -1))}
              className="rounded border border-line px-2 py-1 disabled:opacity-40"
            >
              ↑
            </button>
            <button
              type="button"
              aria-label="Next match"
              disabled={matches.length === 0}
              onClick={() => goTo(step(current, matches.length, 1))}
              className="rounded border border-line px-2 py-1 disabled:opacity-40"
            >
              ↓
            </button>
          </div>
        </div>
      )}

      {columnCount === 0 ? (
        <p className="p-8 text-center text-sm text-muted">This sheet is empty.</p>
      ) : (
        <div
          ref={scroller}
          onScroll={recompute}
          id="sheet-panel"
          // A scrollable region that nothing inside can hold focus is
          // unreachable by keyboard; making it a tab stop is what lets it be
          // scrolled with the arrow keys.
          tabIndex={0}
          {...(sheets.length > 1
            ? { role: "tabpanel", "aria-labelledby": `sheet-tab-${active}` }
            : { role: "region", "aria-label": sheet.name })}
          className="viewer-scroller focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          {/*
            `aria-rowcount` because the DOM is not the sheet.

            Only the rows in view are mounted, so without this a screen reader
            is told the table has about sixty rows whichever file is open —
            an honest-looking lie that no automated rule catches, because
            nothing in the markup contradicts anything else. The count is the
            sheet's own, plus the header row, and each row carries its real
            index so "row 12,043 of 50,000" is answerable while twelve
            thousand of those rows do not exist.
          */}
          <table
            ref={table}
            aria-rowcount={order.length + 1}
            aria-colcount={columnCount + 1}
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
              <tr aria-rowindex={1}>
                <th className="sticky left-0 top-0 z-20 border-b border-r border-line bg-canvas px-2 py-1.5 text-xs font-normal text-muted" />
                {widths.map((_, column) => (
                  <th
                    key={column}
                    // Announced rather than left to the arrow glyph, which is
                    // decoration and hidden from assistive technology.
                    aria-sort={
                      sort?.column === column
                        ? sort.direction === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                    // `sticky` already establishes the containing block the
                    // handle positions against, so no `relative` here.
                    className="sticky top-0 z-10 border-b border-r border-line bg-canvas px-3 py-1.5 text-xs font-normal text-muted"
                  >
                    {/*
                      A button rather than a click handler on the header: this
                      is a control, and it has to be reachable and operable the
                      same way every other control here is. It sits alongside
                      the resize handle, which keeps its own tab stop.
                    */}
                    <button
                      type="button"
                      data-testid={`sort-${column}`}
                      aria-label={`Sort by column ${columnLabel(column)}`}
                      onClick={() =>
                        setSort((current) => {
                          const direction = nextDirection(
                            current?.column === column ? current.direction : null,
                          );
                          return direction === null ? null : { column, direction };
                        })
                      }
                      className="flex w-full items-center gap-1 truncate rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      <span className="truncate">{columnLabel(column)}</span>
                      {sort?.column === column && (
                        <span aria-hidden="true" className="text-accent">
                          {sort.direction === "asc" ? "▲" : "▼"}
                        </span>
                      )}
                    </button>
                    {/*
                      Drag to resize, double-click to fit the widest value —
                      the two gestures Excel puts on this same edge.
                    */}
                    {/*
                      A separator that can only be dragged is a control with no
                      keyboard path, so this one is focusable and takes the
                      arrow keys — the same gestures, reachable both ways.
                      Enter matches the double-click auto-fit.
                    */}
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Resize column ${columnLabel(column)}`}
                      aria-valuenow={widths[column] ?? MIN_COLUMN_WIDTH}
                      aria-valuemin={MIN_COLUMN_WIDTH}
                      tabIndex={0}
                      data-testid={`resize-${column}`}
                      onPointerDown={onHandleDown(column)}
                      onDoubleClick={onHandleDoubleClick(column)}
                      onKeyDown={onHandleKeyDown(column)}
                      // Sits fully inside its own cell: the next header is
                      // sticky and later in DOM order, so anything overhanging
                      // the border would be covered by it and never hit.
                      className="column-resize-handle absolute right-0 top-0 z-10 h-full w-2 cursor-col-resize touch-none select-none hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none"
                    />
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {/* Spacers stand in for the unmounted rows so the scrollbar
                  reflects the full sheet. */}
              {/* Hidden from assistive technology: a spacer is scrollbar
                  arithmetic, not a row of the sheet, and announcing it as an
                  empty row is the same lie in a different place. */}
              {start > 0 && (
                <tr aria-hidden="true" style={{ height: start * ROW_HEIGHT }} />
              )}

              {visiblePositions.map((rowIndex, offset) => {
                const row = sheet.rows[rowIndex]!;
                const position = start + offset;
                const here = matches[current];
                return (
                  <tr
                    key={rowIndex}
                    // The row's place in the sheet, not in the DOM.
                    aria-rowindex={position + 2}
                    style={{ height: ROW_HEIGHT }}
                  >
                    {/*
                      The row's number in the file, even when sorting has moved
                      it up the page. A view that renumbers its rows 1..n looks
                      tidier and makes a sorted sheet impossible to compare
                      against the file it came from.
                    */}
                    <td className="sticky left-0 z-10 border-b border-r border-line bg-canvas px-2 text-right text-xs tabular-nums text-muted">
                      {rowIndex + 1}
                    </td>
                    {widths.map((_, column) => {
                      const value = row[column];
                      const hit =
                        matchable !== "" &&
                        Boolean(value) &&
                        value!.toLowerCase().includes(matchable);
                      const isCurrent =
                        hit &&
                        here?.position === position &&
                        here.column === column;

                      return (
                        <td
                          key={column}
                          data-testid={isCurrent ? "match-current" : undefined}
                          // The whole cell rather than the matched substring:
                          // cells are truncated to their column width, so a
                          // highlight inside the text can be the part that is
                          // clipped, and the row would look like a miss.
                          className={[
                            "truncate border-b border-r border-line px-3",
                            isCurrent
                              ? "bg-accent text-on-accent"
                              : hit
                                ? "bg-accent/25"
                                : "",
                          ].join(" ")}
                          title={value || undefined}
                        >
                          {value ?? ""}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}

              {end < order.length && (
                <tr
                  aria-hidden="true"
                  style={{ height: (order.length - end) * ROW_HEIGHT }}
                />
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
