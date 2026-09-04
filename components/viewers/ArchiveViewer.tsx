"use client";

import { useMemo, useState } from "react";

import { formatBytes } from "@/lib/formats";
import type { ArchiveEntry } from "@/lib/preview";

/**
 * What is inside an archive, according to the archive.
 *
 * Nothing here is decompressed, and nothing is opened: this is the index the
 * zip keeps of itself, displayed. Every number is a claim the file makes about
 * itself rather than something measured — which is worth remembering when one
 * of them looks implausible, and is why the ratio is shown rather than hidden.
 *
 * Entry names are the untrusted part. `../../etc/passwd` is a legal name in a
 * zip, and it is harmless here for one reason: nothing in this component
 * treats a name as a path. It is rendered as text, in a table cell, and that
 * is the whole of it.
 */
export default function ArchiveViewer({
  entries,
  totalUncompressed,
}: {
  entries: ArchiveEntry[];
  totalUncompressed: number;
}) {
  const [query, setQuery] = useState("");

  const files = useMemo(
    () => entries.filter((entry) => !entry.directory),
    [entries],
  );

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return files;
    return files.filter((entry) => entry.name.toLowerCase().includes(needle));
  }, [files, query]);

  const folders = entries.length - files.length;

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2 text-xs text-muted">
        <span data-testid="archive-summary">
          {files.length.toLocaleString()}{" "}
          {files.length === 1 ? "file" : "files"}
          {folders > 0 && `, ${folders.toLocaleString()} folders`} ·{" "}
          {formatBytes(totalUncompressed)} unpacked
        </span>
        <label htmlFor="archive-filter" className="sr-only">
          Filter entries by name
        </label>
        <input
          id="archive-filter"
          type="search"
          value={query}
          placeholder="Filter by name"
          data-testid="archive-filter"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.key === "Escape" && setQuery("")}
          className="ml-auto w-44 rounded border border-line bg-canvas px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        />
      </div>

      <div
        role="region"
        aria-label="Archive contents"
        // Nothing inside holds focus, so without this the list cannot be
        // scrolled from the keyboard.
        tabIndex={0}
        className="viewer-scroller focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        {shown.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted">
            {files.length === 0
              ? "This archive has no files in it."
              : "No entry matches that."}
          </p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-xs text-muted">
                <th
                  scope="col"
                  className="sticky top-0 z-10 border-b border-line bg-canvas px-4 py-1.5 text-left font-normal"
                >
                  Name
                </th>
                <th
                  scope="col"
                  className="sticky top-0 z-10 border-b border-line bg-canvas px-4 py-1.5 text-right font-normal"
                >
                  Size
                </th>
                <th
                  scope="col"
                  className="sticky top-0 z-10 border-b border-line bg-canvas px-4 py-1.5 text-right font-normal"
                >
                  Packed
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((entry, index) => (
                <tr key={`${entry.name}-${index}`}>
                  <td className="border-b border-line px-4 py-1.5">
                    <span className="break-all">{entry.name}</span>
                    {entry.encrypted && (
                      <span
                        // Said in words rather than shown as an icon: this is
                        // the difference between "you have the file" and "you
                        // have the file and need a password for it".
                        className="ml-2 rounded border border-line px-1.5 py-0.5 text-xs text-muted"
                      >
                        encrypted
                      </span>
                    )}
                  </td>
                  <td className="border-b border-line px-4 py-1.5 text-right tabular-nums">
                    {formatBytes(entry.uncompressedBytes)}
                  </td>
                  <td className="border-b border-line px-4 py-1.5 text-right tabular-nums text-muted">
                    {formatBytes(entry.compressedBytes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
