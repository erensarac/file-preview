/**
 * Ordering a sheet's rows.
 *
 * A spreadsheet column is not a type. One column holds numbers, text, dates
 * typed as text, and blanks, all at once — so "sort this column" has to mean
 * something specific before it can be implemented, and the specifics are here
 * rather than left to whatever a comparator happens to do with mixed input.
 *
 * The rules, in full:
 *
 * 1. **Blanks always sink.** They go last ascending *and* descending. A column
 *    sorted descending whose top twenty rows are empty has told the reader
 *    nothing, and reversing the sort to see the other end is not a thing
 *    anyone should have to think of.
 * 2. **Numbers compare as numbers.** `9` before `10`, not after it. A cell
 *    counts as a number only if the whole of it parses as one, so `10 kg`
 *    stays text and does not silently become 10.
 * 3. **Numbers sort before text.** Ascending, a column of mixed content reads
 *    numbers first, then words. Descending reverses the whole ordering, so
 *    text comes first — the sort is a mirror rather than two different rules.
 * 4. **Text compares by locale**, so `Ç` lands next to `C` rather than after
 *    `Z`, and case is not what decides.
 *
 * Sorting is a *view*. Nothing here mutates the sheet: the result is an order
 * to read the rows in, so clearing the sort restores the file's own order
 * exactly, with no copy of the data kept anywhere.
 */

export type SortDirection = "asc" | "desc";

/** Ranked so the comparison below reads as one expression. */
const BLANK = 2;
const TEXT = 1;
const NUMBER = 0;

function kindOf(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return BLANK;
  return Number.isFinite(Number(value)) ? NUMBER : TEXT;
}

/**
 * Exported for its own tests: this is the whole of the answer to "what order
 * did it use", and it is easier to read as four cases than as a sorted grid.
 */
export function compareCells(
  left: string | undefined,
  right: string | undefined,
  direction: SortDirection,
): number {
  const leftKind = kindOf(left);
  const rightKind = kindOf(right);

  // Rule 1, and it is checked before direction is looked at, which is what
  // makes blanks sink both ways rather than floating on the reverse.
  if (leftKind === BLANK || rightKind === BLANK) {
    return leftKind === rightKind ? 0 : leftKind === BLANK ? 1 : -1;
  }

  const sign = direction === "asc" ? 1 : -1;

  if (leftKind !== rightKind) return (leftKind - rightKind) * sign;

  if (leftKind === NUMBER) return (Number(left) - Number(right)) * sign;

  return left!.localeCompare(right!, undefined, { sensitivity: "base" }) * sign;
}

/**
 * The order to read rows in, as indices into the original array.
 *
 * Stable: rows that compare equal keep the order the file gave them, so
 * sorting by one column does not shuffle rows that share a value. `Array.sort`
 * is specified as stable, and the index tiebreak makes that explicit rather
 * than inherited.
 */
export function sortedOrder(
  rows: string[][],
  order: number[],
  column: number,
  direction: SortDirection,
): number[] {
  return [...order].sort((left, right) => {
    const compared = compareCells(
      rows[left]?.[column],
      rows[right]?.[column],
      direction,
    );
    return compared !== 0 ? compared : left - right;
  });
}

/** Ascending, then descending, then back to the file's own order. */
export function nextDirection(
  current: SortDirection | null,
): SortDirection | null {
  if (current === null) return "asc";
  return current === "asc" ? "desc" : null;
}
