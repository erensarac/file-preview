"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { reportClientFailure } from "@/app/actions/telemetry";
import { sizeBucket } from "@/lib/telemetry";
import { fitZoom, zoomInFrom, zoomOutFrom } from "@/lib/zoom";

/** Matches the scroller's padding; the fit maths has to subtract it. */
const SCROLLER_PADDING = 8;

/**
 * An image, decoded by the browser.
 *
 * The bytes never leave the tab: they are wrapped in a blob URL, handed to an
 * `<img>`, and the URL is released when the pane goes away. The pane is
 * remounted per opened file, so without that release every file someone opens
 * would leak its own copy for the life of the tab — invisible until it isn't.
 *
 * An SVG is rendered here rather than inlined, and that is a security boundary
 * rather than a styling choice. Loaded through `<img>` the browser renders SVG
 * in secure static mode: no script runs and no external resource is fetched.
 * Injecting the same file into the page would run both.
 */
export default function ImageViewer({
  bytes,
  mimeType,
}: {
  bytes: Uint8Array;
  mimeType: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [chosenZoom, setChosenZoom] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  const url = useMemo(() => {
    // `slice()` because a Uint8Array view can be over a larger buffer, and the
    // blob would then carry whatever else is in it.
    const blob = new Blob([bytes.slice()], { type: mimeType });
    return URL.createObjectURL(blob);
  }, [bytes, mimeType]);

  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;

    const measure = () =>
      setAvailable(Math.max(0, element.clientWidth - SCROLLER_PADDING * 2));
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fitted = fitZoom(available, natural?.width ?? 0);
  const zoom = chosenZoom ?? fitted;
  const fitting = chosenZoom === null;
  const zoomIn = zoomInFrom(zoom);
  const zoomOut = zoomOutFrom(zoom);

  if (failed) {
    return (
      <p role="alert" className="p-8 text-center text-sm">
        This image couldn&apos;t be decoded. It may be corrupt, or not really
        the kind of file its name says it is.
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2 text-xs text-muted">
        <span data-testid="image-dimensions" className="tabular-nums">
          {natural ? `${natural.width} × ${natural.height}` : "Loading…"}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label="Zoom out"
            disabled={zoomOut === null}
            onClick={() => zoomOut !== null && setChosenZoom(zoomOut)}
            className="rounded border border-line px-2 py-1 disabled:opacity-40"
          >
            −
          </button>
          <span className="w-12 text-center tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={zoomIn === null}
            onClick={() => zoomIn !== null && setChosenZoom(zoomIn)}
            className="rounded border border-line px-2 py-1 disabled:opacity-40"
          >
            +
          </button>
          <button
            type="button"
            aria-label="Fit image width"
            aria-pressed={fitting}
            onClick={() => setChosenZoom(null)}
            className={[
              "ml-1 rounded border px-2 py-1",
              fitting ? "border-accent text-ink" : "border-line hover:text-ink",
            ].join(" ")}
          >
            Fit
          </button>
        </div>
      </div>

      <div
        ref={scroller}
        role="region"
        aria-label="Image"
        // Nothing inside can hold focus, so without this the region cannot be
        // scrolled from the keyboard when the image is zoomed past it.
        tabIndex={0}
        className="viewer-scroller grid place-items-center bg-canvas p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        {/*
          `alt` is empty on purpose, and it is the honest answer rather than a
          gap. There is nothing true to say about an arbitrary image someone
          has just opened; a description invented here would be worse than
          silence, because a screen reader would read it as fact. The region
          announces that this is an image and the pane header names the file,
          which is everything actually known about it.
        */}
        <img
          src={url}
          alt=""
          data-testid="image-preview"
          onLoad={(event) =>
            setNatural({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }
          onError={() => {
            setFailed(true);
            // The browser gives no detail beyond "it did not decode", so the
            // name is ours rather than an exception's.
            void reportClientFailure({
              formatId: "image",
              phase: "render",
              errorName: "DecodeError",
              sizeBucket: sizeBucket(bytes.byteLength),
            });
          }}
          style={
            natural
              ? { width: natural.width * zoom, height: natural.height * zoom }
              : undefined
          }
          className="max-w-none bg-surface shadow-sm ring-1 ring-line"
        />
      </div>
    </div>
  );
}
