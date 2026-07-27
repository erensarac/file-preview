/**
 * Column sizing for the sheet viewer.
 *
 * Widths have to be decided up front rather than left to the browser. The
 * viewer only mounts the rows currently in view, and an auto-layout table sizes
 * its columns from the rows it can actually see — so scrolling swaps the
 * mounted rows, the widths get recomputed from different content, and the
 * columns visibly jump. Measuring the whole column once and pinning the result
 * is what stops that.
 *
 * Measurement goes through a canvas rather than the DOM: it needs no layout
 * pass, so a column can be measured without mounting it.
 */

/** Room for the cell's horizontal padding and its border. */
const CELL_CHROME = 26;
const MIN_WIDTH = 56;
/** Auto-sizing stops here; a long column is truncated rather than unreadable. */
const MAX_AUTO_WIDTH = 420;
/**
 * Rows sampled per column when sizing a whole sheet. Measuring every cell of a
 * 2,000 x 200 sheet is 400,000 measurements for a result that a sample gets
 * within a few pixels of.
 */
const SAMPLE_ROWS = 200;

let scratch: CanvasRenderingContext2D | null = null;

function context(font: string): CanvasRenderingContext2D {
  if (!scratch) {
    scratch = document.createElement("canvas").getContext("2d");
  }
  if (!scratch) throw new Error("Canvas 2D context unavailable");
  scratch.font = font;
  return scratch;
}

function clamp(width: number): number {
  return Math.max(MIN_WIDTH, Math.min(MAX_AUTO_WIDTH, Math.ceil(width)));
}

/**
 * Width that fits the widest value in a column, the way Excel's double-click
 * auto-fit does. Every row is measured — this runs for one column at a time.
 */
export function autoFitWidth(
  rows: string[][],
  column: number,
  font: string,
  headerLabel: string,
): number {
  const ctx = context(font);
  let widest = ctx.measureText(headerLabel).width;

  for (const row of rows) {
    const value = row[column];
    if (!value) continue;
    const width = ctx.measureText(value).width;
    if (width > widest) widest = width;
  }

  return clamp(widest + CELL_CHROME);
}

/**
 * Starting widths for every column, from a sample of rows.
 */
export function measureColumnWidths(
  rows: string[][],
  columnCount: number,
  font: string,
  labelOf: (index: number) => string,
): number[] {
  const ctx = context(font);
  const step = Math.max(1, Math.ceil(rows.length / SAMPLE_ROWS));
  const widths = new Array<number>(columnCount).fill(0);

  for (let column = 0; column < columnCount; column += 1) {
    widths[column] = ctx.measureText(labelOf(column)).width;
  }

  for (let index = 0; index < rows.length; index += step) {
    const row = rows[index]!;
    for (let column = 0; column < row.length && column < columnCount; column += 1) {
      const value = row[column];
      if (!value) continue;
      const width = ctx.measureText(value).width;
      if (width > widths[column]!) widths[column] = width;
    }
  }

  return widths.map((width) => clamp(width + CELL_CHROME));
}

/** Smallest width a drag is allowed to produce. */
export const MIN_COLUMN_WIDTH = MIN_WIDTH;

/**
 * The font the measurements must match. Read from the live table so the
 * canvas and the rendered cells agree.
 */
export function fontOf(element: Element): string {
  const style = getComputedStyle(element);
  // Safari leaves the `font` shorthand empty, so rebuild it when it's missing.
  return style.font || `${style.fontSize} ${style.fontFamily}`;
}
