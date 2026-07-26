"use client";

import { useState } from "react";

import type { Sheet } from "@/lib/preview";

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
  const sheet = sheets[Math.min(active, sheets.length - 1)]!;
  const columnCount = sheet.rows.reduce((max, row) => Math.max(max, row.length), 0);

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
        <div className="min-h-0 overflow-auto">
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
              {sheet.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="hover:bg-canvas/60">
                  <td className="sticky left-0 z-10 border-b border-r border-line bg-canvas px-2 py-1.5 text-right text-xs tabular-nums text-muted">
                    {rowIndex + 1}
                  </td>
                  {Array.from({ length: columnCount }, (_, column) => (
                    <td
                      key={column}
                      className="max-w-100 truncate border-b border-r border-line px-3 py-1.5"
                      title={row[column] || undefined}
                    >
                      {row[column] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
