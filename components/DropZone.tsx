"use client";

import { useCallback, useRef, useState } from "react";

import { ACCEPT_ATTRIBUTE, FORMATS } from "@/lib/formats";

interface Props {
  /**
   * Everything that arrived, not just the first of it.
   *
   * All three ways in — a drop, the picker, and a file the operating system
   * hands to an installed app — used to take `[0]` and say nothing about the
   * rest, which reads as the site being broken rather than as a limit.
   */
  onFiles: (files: File[]) => void;
  /** A drop that contained no readable file, usually a folder. */
  onNothingUsable: (reason: string) => void;
  busy: boolean;
  /** Collapses the zone to a slim bar once a file is open. */
  compact?: boolean;
}

export default function DropZone({
  onFiles,
  onNothingUsable,
  busy,
  compact = false,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  // Nested elements fire dragleave as the pointer crosses them, so the drag
  // state is tracked with a counter rather than a boolean.
  const dragDepth = useRef(0);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);

      const files = [...(event.dataTransfer.files ?? [])];
      if (files.length > 0) {
        onFiles(files);
        return;
      }

      /*
       * A folder produces a drop with no files in it, so without this the
       * gesture does nothing at all and looks like the page ignoring you.
       *
       * `webkitGetAsEntry` is the only way to tell a folder from an empty
       * drop, and it is prefixed everywhere despite being the standard.
       */
      const items = [...(event.dataTransfer.items ?? [])];
      const folder = items.some(
        (item) => item.webkitGetAsEntry?.()?.isDirectory === true,
      );

      onNothingUsable(
        folder
          ? "Folders can't be opened here — drop the files inside it instead."
          : "That drop didn't contain a file we could read.",
      );
    },
    [onFiles, onNothingUsable],
  );

  return (
    <div
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => {
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) setDragging(false);
      }}
      onDrop={handleDrop}
      data-testid="drop-zone"
      className={[
        "rounded-2xl border-2 border-dashed transition-colors",
        compact ? "px-4 py-3 sm:px-5 sm:py-4" : "px-6 py-8 sm:py-20",
        dragging
          ? "border-accent bg-accent/5"
          : "border-line bg-surface hover:border-muted",
      ].join(" ")}
    >
      {/*
        The input stays in the accessibility tree rather than being hidden from
        it: it is the real control, and the button below just clicks it. Without
        a name it is an unlabelled focus stop, which is what axe reports as a
        critical `label` failure.
      */}
      <input
        ref={inputRef}
        id="file-input"
        type="file"
        aria-label="Choose a file to preview"
        accept={ACCEPT_ATTRIBUTE}
        // The picker and drag-and-drop have to agree: offering one file in the
        // dialogue while silently accepting many from a drop is two different
        // products in one control.
        multiple
        className="sr-only"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          if (files.length > 0) onFiles(files);
          // Reset so re-picking the same file fires change again.
          event.target.value = "";
        }}
      />

      <div
        className={
          compact
            ? // Below `sm` the prompt beside it is gone, so a right-aligned
              // button would sit at the edge of an empty dashed box. The
              // button becomes the bar instead.
              "flex flex-wrap items-center justify-center gap-3 sm:justify-between"
            : "flex flex-col items-center text-center"
        }
      >
        {/*
          A phone cannot drag a file, so the drag wording is not just useless
          there — it describes a gesture the device does not have, next to the
          button that is the only way in. Below `sm` the copy names the tap;
          the compact bar drops its line entirely and keeps the button.
        */}
        <div className={compact ? "" : "space-y-2"}>
          {dragging ? (
            <p className={compact ? "text-sm text-muted" : "text-lg font-medium"}>
              Drop to open
            </p>
          ) : compact ? (
            <p className="hidden text-sm text-muted sm:block">
              Drop more files to replace what is open
            </p>
          ) : (
            <p className="text-lg font-medium">
              <span className="sm:hidden">Open a file</span>
              <span className="hidden sm:inline">Drop a file here</span>
            </p>
          )}
          {!compact && (
            <p className="text-sm text-muted">
              <span className="sm:hidden">nothing is stored either way</span>
              <span className="hidden sm:inline">
                or pick one from your computer — nothing is stored either way
              </span>
            </p>
          )}
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className={[
            "rounded-lg bg-accent font-medium text-on-accent transition-opacity",
            "hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
            compact
              ? "w-full px-3 py-2 text-sm sm:w-auto sm:py-1.5"
              : "mt-6 px-5 py-2.5",
          ].join(" ")}
        >
          {busy ? "Opening…" : "Choose file"}
        </button>

        {!compact && (
          <ul className="mt-8 flex flex-wrap justify-center gap-2">
            {FORMATS.map((format) => (
              <li
                key={format.id}
                className="rounded-full border border-line px-3 py-1 text-xs text-muted"
                title={
                  format.runtime === "client"
                    ? "Read in your browser"
                    : "Converted on the server, never stored"
                }
              >
                {format.label}
                {format.runtime === "client" && (
                  <span className="ml-1.5 text-accent" aria-hidden>
                    ●
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
