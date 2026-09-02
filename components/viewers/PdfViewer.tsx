"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * PDF pages, rendered as they come into view.
 *
 * pdf.js is loaded on demand and given its own worker, so parsing and
 * rasterising happen off the main thread. Pages are rendered to canvas only
 * while they are near the viewport and released again afterwards: a hundred-page
 * document held entirely as bitmaps is hundreds of megabytes, and the user is
 * looking at one page at a time.
 *
 * Everything here runs in the browser. A PDF is a client-runtime format, so the
 * file is never uploaded — which is also why the deployment's request body
 * ceiling doesn't apply to it.
 */

/** Pages kept rendered on either side of the visible ones. */
const OVERSCAN = 1;
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

type LoadingTask = ReturnType<
  typeof import("pdfjs-dist/legacy/build/pdf.mjs").getDocument
>;
type PdfDocument = Awaited<LoadingTask["promise"]>;

interface PageSize {
  width: number;
  height: number;
}

export default function PdfViewer({ bytes }: { bytes: Uint8Array }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [zoomStep, setZoomStep] = useState(2); // 1x
  const [visible, setVisible] = useState({ from: 0, to: 2 });
  const [error, setError] = useState<string | null>(null);

  const zoom = ZOOM_STEPS[zoomStep]!;

  useEffect(() => {
    let cancelled = false;
    // Teardown lives on the loading task, not the document — destroying it
    // aborts any in-flight fetch and terminates the worker.
    let task: LoadingTask | null = null;

    (async () => {
      try {
        /**
         * The legacy build, deliberately.
         *
         * The default build calls `Map.prototype.getOrInsertComputed`, which
         * is new enough that rendering throws on browsers still in common use
         * — including the one this project's tests run against. The legacy
         * build is transpiled and polyfilled, and the difference is invisible
         * apart from a slightly larger download.
         */
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        // Served from `public/` rather than resolved through the bundler, so
        // it cannot silently 404 at runtime.
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";

        // pdf.js takes ownership of the buffer it is given, so it gets a copy —
        // otherwise re-opening the same document would find it detached.
        //
        // The font and CMap directories are copied into `public/` at build time
        // (scripts/copy-pdf-assets.mjs). Without the first, any document using
        // one of the fourteen base fonts renders with missing text; without the
        // second, CJK documents do.
        task = pdfjs.getDocument({
          data: bytes.slice(),
          standardFontDataUrl: "/pdfjs/standard_fonts/",
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
        });
        const loaded = await task.promise;
        if (cancelled) return;

        const first = await loaded.getPage(1);
        const viewport = first.getViewport({ scale: 1 });
        setSizes(
          Array.from({ length: loaded.numPages }, () => ({
            width: viewport.width,
            height: viewport.height,
          })),
        );
        setDoc(loaded);
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error && cause.message
              ? cause.message
              : "This PDF could not be opened.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [bytes]);

  const recompute = useCallback(() => {
    const element = scroller.current;
    if (!element || sizes.length === 0) return;

    const pageHeight = sizes[0]!.height * zoom + 16;
    const from = Math.max(
      0,
      Math.floor(element.scrollTop / pageHeight) - OVERSCAN,
    );
    const count = Math.ceil(element.clientHeight / pageHeight);
    setVisible({ from, to: from + count + OVERSCAN * 2 });
  }, [sizes, zoom]);

  useEffect(recompute, [recompute]);

  if (error) {
    return (
      <p role="alert" className="p-8 text-center text-sm">
        {error}
      </p>
    );
  }

  if (!doc) {
    return (
      <p className="p-8 text-center text-sm text-muted">Opening document…</p>
    );
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-line px-4 py-2 text-xs text-muted">
        <span data-testid="pdf-page-count">
          {doc.numPages} {doc.numPages === 1 ? "page" : "pages"}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label="Zoom out"
            disabled={zoomStep === 0}
            onClick={() => setZoomStep((step) => Math.max(0, step - 1))}
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
            disabled={zoomStep === ZOOM_STEPS.length - 1}
            onClick={() =>
              setZoomStep((step) => Math.min(ZOOM_STEPS.length - 1, step + 1))
            }
            className="rounded border border-line px-2 py-1 disabled:opacity-40"
          >
            +
          </button>
        </div>
      </div>

      <div
        ref={scroller}
        onScroll={recompute}
        role="region"
        aria-label={`Document pages, ${doc.numPages} in total`}
        // Nothing inside a page can hold focus, so without this the document
        // cannot be scrolled from the keyboard at all.
        tabIndex={0}
        className="max-h-[70vh] min-h-0 overflow-auto bg-canvas p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <div className="mx-auto flex w-max flex-col gap-4">
          {sizes.map((size, index) => (
            <PdfPage
              key={index}
              doc={doc}
              pageNumber={index + 1}
              zoom={zoom}
              size={size}
              // Outside this window the canvas is dropped and the placeholder
              // holds the scroll position.
              active={index >= visible.from && index <= visible.to}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * One page: a canvas, and a transparent layer of positioned text over it.
 *
 * The canvas is what you see; the text layer is what you can select, copy and
 * find with the browser's own search. Without it a page is an image, and a
 * screen reader gets nothing but the page number.
 */
function PdfPage({
  doc,
  pageNumber,
  zoom,
  size,
  active,
}: {
  doc: PdfDocument;
  pageNumber: number;
  zoom: number;
  size: PageSize;
  active: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const textLayer = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    if (!active) {
      setRendered(false);
      return;
    }

    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    let text: { cancel: () => void } | null = null;

    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;

      const element = canvas.current;
      if (!element) return;

      // Match the device's pixel density so text stays sharp when zoomed.
      const ratio = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: zoom * ratio });
      element.width = viewport.width;
      element.height = viewport.height;
      element.style.width = `${size.width * zoom}px`;
      element.style.height = `${size.height * zoom}px`;

      const context = element.getContext("2d");
      if (!context) return;

      task = page.render({ canvas: element, canvasContext: context, viewport });
      try {
        await (task as unknown as { promise: Promise<void> }).promise;
        if (!cancelled) setRendered(true);
      } catch {
        // A render cancelled by scrolling away or zooming is expected.
        return;
      }

      const layer = textLayer.current;
      if (cancelled || !layer) return;

      // The text layer is laid out in CSS pixels, so it uses the zoom alone —
      // not zoom x pixel ratio, which is the canvas's own backing-store scale.
      // Mixing the two puts the selection boxes at a fraction of the glyphs
      // they belong to.
      const cssViewport = page.getViewport({ scale: zoom });
      layer.replaceChildren();
      layer.style.setProperty("--total-scale-factor", String(zoom));

      const { TextLayer } = await import("pdfjs-dist/legacy/build/pdf.mjs");
      if (cancelled) return;

      const built = new TextLayer({
        textContentSource: page.streamTextContent(),
        container: layer,
        viewport: cssViewport,
      });
      text = built;
      try {
        await built.render();
      } catch {
        // Cancelled by a zoom or by scrolling away; the canvas still stands.
      }
    })();

    return () => {
      cancelled = true;
      task?.cancel();
      text?.cancel();
    };
  }, [doc, pageNumber, zoom, size, active]);

  return (
    <div
      data-testid={`pdf-page-${pageNumber}`}
      data-rendered={rendered ? "true" : "false"}
      className="relative bg-surface shadow-sm ring-1 ring-line"
      style={{ width: size.width * zoom, height: size.height * zoom }}
    >
      {active ? (
        <>
          {/*
            The canvas is decorative once the text layer exists: the words are
            in the DOM below it, so announcing the bitmap as an image as well
            would make a screen reader read the page twice.
          */}
          <canvas ref={canvas} aria-hidden className="block" />
          <div
            ref={textLayer}
            data-testid={`pdf-text-${pageNumber}`}
            className="pdf-text-layer"
          />
        </>
      ) : (
        <span className="absolute inset-0 grid place-items-center text-xs text-muted">
          {pageNumber}
        </span>
      )}
    </div>
  );
}
