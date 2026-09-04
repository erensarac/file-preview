/**
 * Finding a value in a sheet.
 *
 * The browser's own Ctrl+F cannot do this. The viewer mounts only the rows in
 * view, so the page it searches is a window onto the file rather than the file
 * — on a large sheet almost every match is in a row that does not exist yet.
 * That was already true at the old 2,000-row cap and is unmissable without it.
 *
 * Kept out of the component so the matching itself can be tested directly,
 * without a browser and without scrolling anything.
 */

export interface Match {
  /** Index into the sheet's own rows — what the row number shows. */
  row: number;
  column: number;
  /**
   * Where the match sits in the *view*, which is what scrolling needs.
   *
   * Once rows can be sorted or filtered, the row's place in the file and its
   * place on screen are different numbers, and using the first to scroll would
   * send the reader to whatever happens to occupy that line now.
   */
  position: number;
}

/**
 * Every cell containing `query`, in reading order.
 *
 * Case-insensitive substring, deliberately: this is "find in file", not a
 * query language. Someone looking for `istanbul` in a column of `Istanbul`
 * wants the rows, and would not thank us for a regex dialect they have to
 * learn — nor for the ways a regex can be made to take a very long time.
 */
export function findMatches(
  rows: string[][],
  query: string,
  /**
   * The rows to search, in the order they appear on screen. Defaults to the
   * file's own order; passing the view's order is what keeps "next match" and
   * "the next one down the page" the same thing after a sort.
   */
  order?: number[],
): Match[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];

  const matches: Match[] = [];
  const length = order ? order.length : rows.length;

  for (let position = 0; position < length; position += 1) {
    const row = order ? order[position]! : position;
    const cells = rows[row];
    if (!cells) continue;
    for (let column = 0; column < cells.length; column += 1) {
      const value = cells[column];
      if (value && value.toLowerCase().includes(needle)) {
        matches.push({ row, column, position });
      }
    }
  }
  return matches;
}

/**
 * Where to scroll so a row is visible, centred where there is room.
 *
 * Centred rather than scrolled to the top edge: a match at the very top of the
 * viewport reads as the start of the file rather than as the thing that was
 * looked for, and there is nothing above it to say what it sits between.
 */
export function scrollTopFor(
  /** A position in the view, not a row of the file. */
  row: number,
  rowHeight: number,
  viewportHeight: number,
  totalRows: number,
): number {
  const centred = row * rowHeight - viewportHeight / 2 + rowHeight / 2;
  const furthest = Math.max(0, totalRows * rowHeight - viewportHeight);
  return Math.min(Math.max(0, centred), furthest);
}

/** Wraps at both ends, so Next from the last match returns to the first. */
export function step(current: number, total: number, by: 1 | -1): number {
  if (total === 0) return 0;
  return (current + by + total) % total;
}
