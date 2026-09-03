"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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
/** Matches the scroller's `p-2`; the fit maths has to subtract it. */
const SCROLLER_PADDING = 8;
/** Matches the `gap-4` between pages; the offset maths has to include it. */
const PAGE_GAP = 16;

/**
 * Where each page starts, and how tall the stack is.
 *
 * Accumulated rather than multiplied. Dividing the scroll position by one page
 * height assumes every page is identical, which is what made a landscape page
 * inside a portrait document land on the wrong page and render squashed.
 */
function layoutOf(sizes: PageSize[], zoom: number) {
  const offsets: number[] = [];
  let y = 0;
  for (const size of sizes) {
    offsets.push(y);
    y += size.height * zoom + PAGE_GAP;
  }
  return { offsets, total: Math.max(0, y - PAGE_GAP) };
}

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
  // `null` means fit to the width available. A phone is narrower than an A4
  // page at 100%, so a fixed default left the page cut off with no hint that
  // the rest of it was reachable by scrolling sideways.
  const [chosenZoom, setChosenZoom] = useState<number | null>(null);
  const [available, setAvailable] = useState(0);
  const [visible, setVisible] = useState({ from: 0, to: 2 });
  const [currentPage, setCurrentPage] = useState(1);
  /** What the user is typing into the page box, or `null` when they are not. */
  const [pageDraft, setPageDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /*
   * Read by `measurePage`, which is called from a child's effect rather than
   * during render, so it needs the current values without taking them as
   * dependencies — a dependency on `sizes` would rebuild the callback on every
   * correction and re-run every page's effect with it.
   */
  const sizesRef = useRef<PageSize[]>([]);
  const zoomRef = useRef(1);
  /** A height correction above the viewport, applied after the DOM has it. */
  const pendingScroll = useRef(0);

  const pageWidth = sizes[0]?.width ?? 0;
  /**
   * Never magnifies — only shrinks a page that would not otherwise fit.
   *
   * Widening to fill a large monitor would blow a small page up to fill it,
   * which is not what "fit" means to anyone, and would change what a desktop
   * user sees today for no reason.
   */
  const fitZoom =
    pageWidth > 0 && available > 0 ? Math.min(1, available / pageWidth) : 1;
  const zoom = chosenZoom ?? fitZoom;
  const fitting = chosenZoom === null;

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

        /*
         * Page 1's size, used as the estimate for every page until that page
         * is itself fetched and reports its own.
         *
         * Measuring all of them up front would mean parsing a whole document
         * to paint the first screen. Most documents are uniform, so the
         * estimate is right nearly always and the correction is invisible;
         * where it is wrong — a landscape chart in a portrait report — the
         * page corrects itself as it comes into view.
         */
        const first = await loaded.getPage(1);
        const viewport = first.getViewport({ scale: 1 });
        const estimate = Array.from({ length: loaded.numPages }, () => ({
          width: viewport.width,
          height: viewport.height,
        }));
        sizesRef.current = estimate;
        setSizes(estimate);
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

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;

    // `clientWidth` already excludes a scrollbar, so a page fitted this way
    // does not then overflow because fitting it revealed one.
    const measure = () =>
      setAvailable(Math.max(0, element.clientWidth - SCROLLER_PADDING * 2));
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [doc]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  const layout = useMemo(() => layoutOf(sizes, zoom), [sizes, zoom]);

  /**
   * A page reporting the size it actually is, once it has been fetched.
   *
   * Called from the page's own effect, so it runs after render and can touch
   * refs freely. A page whose estimate was already right reports the same
   * numbers and nothing changes, which is what stops this from looping.
   */
  const measurePage = useCallback((pageNumber: number, real: PageSize) => {
    const current = sizesRef.current;
    const index = pageNumber - 1;
    const existing = current[index];
    if (!existing) return;
    if (existing.width === real.width && existing.height === real.height) {
      return;
    }

    /*
     * Correcting a page *above* the viewport moves everything below it,
     * including whatever the reader is looking at. The difference is banked
     * here and applied once the DOM has the new height.
     */
    const element = scroller.current;
    if (element) {
      const { offsets } = layoutOf(current, zoomRef.current);
      if ((offsets[index] ?? 0) < element.scrollTop) {
        pendingScroll.current +=
          (real.height - existing.height) * zoomRef.current;
      }
    }

    const next = [...current];
    next[index] = real;
    sizesRef.current = next;
    setSizes(next);
  }, []);

  useLayoutEffect(() => {
    if (pendingScroll.current === 0) return;
    const element = scroller.current;
    if (element) element.scrollTop += pendingScroll.current;
    pendingScroll.current = 0;
  }, [sizes]);

  const recompute = useCallback(() => {
    const element = scroller.current;
    const { offsets } = layout;
    if (!element || offsets.length === 0) return;

    const top = element.scrollTop;
    const bottom = top + element.clientHeight;

    // Walked rather than divided: page heights are not necessarily equal.
    let first = 0;
    while (first + 1 < offsets.length && offsets[first + 1]! <= top) {
      first += 1;
    }
    let last = first;
    while (last + 1 < offsets.length && offsets[last + 1]! < bottom) {
      last += 1;
    }

    setVisible({ from: Math.max(0, first - OVERSCAN), to: last + OVERSCAN });
    setCurrentPage(first + 1);
  }, [layout]);

  useEffect(recompute, [recompute]);

  /** Scrolls a page to the top of the viewport. */
  const goToPage = useCallback(
    (pageNumber: number) => {
      const element = scroller.current;
      const { offsets } = layout;
      if (!element || offsets.length === 0) return;

      const clamped = Math.min(Math.max(1, pageNumber), offsets.length);
      element.scrollTo({ top: offsets[clamped - 1]! });
      setCurrentPage(clamped);
    },
    [layout],
  );

  /** Commits whatever is in the page box, or puts back the current page. */
  const commitPageDraft = useCallback(() => {
    if (pageDraft === null) return;
    const parsed = Number.parseInt(pageDraft, 10);
    if (Number.isFinite(parsed)) goToPage(parsed);
    setPageDraft(null);
  }, [pageDraft, goToPage]);

  // A fitted zoom is rarely one of the steps, so "next" and "previous" are
  // found by value. `null` means there is nothing further in that direction.
  const zoomIn = ZOOM_STEPS.find((step) => step > zoom + 0.001) ?? null;
  const zoomOut =
    [...ZOOM_STEPS].reverse().find((step) => step < zoom - 0.001) ?? null;

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
      {/*
        `flex-wrap` because this row is the densest thing on a narrow screen:
        a page box, a zoom readout and four buttons. It wraps rather than
        squeezing the controls below a usable tap target.
      */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2 text-xs text-muted">
        {/*
          A box you can type into rather than a label you cannot: scrolling to
          page 9 of a 12-page document was previously only possible by
          dragging, and in a long one that is a lot of dragging.
        */}
        <label className="flex items-center gap-1.5">
          <span className="sr-only">Go to page</span>
          <input
            type="number"
            min={1}
            max={doc.numPages}
            data-testid="pdf-page-input"
            // Shows where you are while scrolling, and what you are typing
            // while typing — the draft wins until it is committed.
            value={pageDraft ?? String(currentPage)}
            onChange={(event) => setPageDraft(event.target.value)}
            onBlur={commitPageDraft}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitPageDraft();
                event.currentTarget.blur();
              }
              if (event.key === "Escape") setPageDraft(null);
            }}
            className="w-12 rounded border border-line bg-surface px-1.5 py-1 text-center tabular-nums text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          />
          <span data-testid="pdf-page-count">of {doc.numPages}</span>
        </label>
        <div className="ml-auto flex items-center gap-1">
          {/*
            Steps are taken relative to the zoom in effect rather than to an
            index, because the starting point can be a fitted zoom that is not
            one of the steps at all.
          */}
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
          {/*
            `aria-pressed` rather than a disabled button: fit is a mode you can
            see you are in, and a disabled control announces nothing.
          */}
          <button
            type="button"
            aria-label="Fit page width"
            aria-pressed={fitting}
            onClick={() => setChosenZoom(null)}
            className={[
              "ml-1 rounded border px-2 py-1",
              fitting
                ? "border-accent text-ink"
                : "border-line hover:text-ink",
            ].join(" ")}
          >
            Fit
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
        className="viewer-scroller bg-canvas p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <div className="mx-auto flex w-max flex-col gap-4">
          {sizes.map((size, index) => (
            <PdfPage
              key={index}
              doc={doc}
              pageNumber={index + 1}
              zoom={zoom}
              size={size}
              onMeasure={measurePage}
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
  onMeasure,
}: {
  doc: PdfDocument;
  pageNumber: number;
  zoom: number;
  size: PageSize;
  active: boolean;
  onMeasure: (pageNumber: number, size: PageSize) => void;
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

      /*
       * The size this page actually is, which until now was assumed to match
       * page 1. The canvas below is rasterised from this page's own viewport,
       * so a page whose estimate is wrong is drawn at one aspect ratio and
       * displayed at another — a landscape page squashed into a portrait box.
       */
      const natural = page.getViewport({ scale: 1 });
      onMeasure(pageNumber, {
        width: natural.width,
        height: natural.height,
      });

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
  }, [doc, pageNumber, zoom, size, active, onMeasure]);

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
