"use client";

import { useMemo, useState } from "react";

import { allFiles, breadcrumbs, listArchive } from "@/lib/archive-tree";
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
  /**
   * Where in the archive we are, as a path the listing itself produced.
   *
   * Never assembled from user input and never resolved — it is only ever the
   * `path` of a folder row that was clicked, or a prefix of one taken from the
   * trail. That is what keeps navigation inside names the archive provided.
   */
  const [path, setPath] = useState("");

  const listing = useMemo(() => listArchive(entries, path), [entries, path]);

  /*
   * A filter reaches the whole archive, not the folder in front of you.
   * Someone typing a name is asking where it is, and answering "not in this
   * directory" would be true and useless.
   */
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return listing.nodes;
    return allFiles(entries).filter((node) =>
      node.name.toLowerCase().includes(needle),
    );
  }, [entries, listing, query]);

  const trail = breadcrumbs(path);
  const searching = query.trim() !== "";
  const fileCount = useMemo(() => allFiles(entries).length, [entries]);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2 text-xs text-muted">
        <span data-testid="archive-summary">
          {fileCount.toLocaleString()} {fileCount === 1 ? "file" : "files"} ·{" "}
          {formatBytes(totalUncompressed)} unpacked
        </span>
        {listing.hiddenMetadata > 0 && (
          <span data-testid="archive-hidden" className="text-muted">
            {/*
              Said rather than silently dropped. A listing that disagrees with
              the archive's own entry count is a small mystery, and the answer
              — Finder writes a shadow copy of every file — is worth a sentence
              to anyone who has wondered why their zip looked twice its size.
            */}
            {listing.hiddenMetadata.toLocaleString()} macOS metadata{" "}
            {listing.hiddenMetadata === 1 ? "entry" : "entries"} hidden
          </span>
        )}
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

      {/*
        The way back, derived from the path rather than remembered. Arriving at
        a folder by any route gives the same trail, and there is no history to
        fall out of step with what is on screen.
      */}
      {!searching && (
        <nav
          aria-label="Archive path"
          className="flex flex-wrap items-center gap-1 border-b border-line px-4 py-1.5 text-xs text-muted"
        >
          <button
            type="button"
            data-testid="crumb-root"
            onClick={() => setPath("")}
            className="rounded px-1 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            Archive
          </button>
          {trail.map((crumb) => (
            <span key={crumb.path} className="flex items-center gap-1">
              <span aria-hidden="true">/</span>
              <button
                type="button"
                onClick={() => setPath(crumb.path)}
                className="rounded px-1 break-all hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </nav>
      )}

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
            {fileCount === 0
              ? "This archive has no files in it."
              : searching
                ? "No entry matches that."
                : "This folder is empty."}
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
              {shown.map((node, index) => (
                <tr key={`${node.path}-${index}`}>
                  <td className="border-b border-line px-4 py-1.5">
                    {node.directory ? (
                      <button
                        type="button"
                        data-testid={`folder-${node.name}`}
                        onClick={() => setPath(node.path)}
                        className="break-all rounded text-left hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        {/* Named as a folder for a screen reader, since the
                            trailing slash is the only visual cue. */}
                        <span aria-hidden="true">📁 </span>
                        {node.name}
                        <span className="sr-only"> folder, {node.files} files</span>
                      </button>
                    ) : (
                      <span className="break-all">{node.name}</span>
                    )}
                    {node.encrypted && (
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
                    {formatBytes(node.uncompressedBytes)}
                  </td>
                  <td className="border-b border-line px-4 py-1.5 text-right tabular-nums text-muted">
                    {formatBytes(node.compressedBytes)}
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
