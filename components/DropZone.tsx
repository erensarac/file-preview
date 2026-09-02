"use client";

import { useCallback, useRef, useState } from "react";

import { ACCEPT_ATTRIBUTE, FORMATS } from "@/lib/formats";

interface Props {
  onFile: (file: File) => void;
  busy: boolean;
  /** Collapses the zone to a slim bar once a file is open. */
  compact?: boolean;
}

export default function DropZone({ onFile, busy, compact = false }: Props) {
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
      const file = event.dataTransfer.files?.[0];
      if (file) onFile(file);
    },
    [onFile],
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
      className={[
        "rounded-2xl border-2 border-dashed transition-colors",
        compact ? "px-5 py-4" : "px-6 py-14 sm:py-20",
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
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          // Reset so re-picking the same file fires change again.
          event.target.value = "";
        }}
      />

      <div
        className={
          compact
            ? "flex flex-wrap items-center justify-between gap-3"
            : "flex flex-col items-center text-center"
        }
      >
        <div className={compact ? "" : "space-y-2"}>
          <p className={compact ? "text-sm text-muted" : "text-lg font-medium"}>
            {dragging
              ? "Drop to open"
              : compact
                ? "Drop another file to replace this one"
                : "Drop a file here"}
          </p>
          {!compact && (
            <p className="text-sm text-muted">
              or pick one from your computer — nothing is stored either way
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
            compact ? "px-3 py-1.5 text-sm" : "mt-6 px-5 py-2.5",
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
