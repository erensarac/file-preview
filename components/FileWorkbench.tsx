"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { previewFile } from "@/app/actions/preview";
import { reportClientFailure } from "@/app/actions/telemetry";
import { hasClientParser, parseInBrowser } from "@/lib/adapters/client";
import { detectFormat, formatBytes } from "@/lib/formats";
import type { PreviewDocument } from "@/lib/preview";
import { safeErrorName, sizeBucket } from "@/lib/telemetry";

import DropZone from "./DropZone";
import PreviewPane from "./PreviewPane";

/**
 * Routes a dropped file to the right adapter.
 *
 * The runtime declared in the format registry decides this: client formats are
 * parsed here in the tab and never hit the network, server formats go through
 * the `previewFile` action. Nothing else in the UI needs to know the
 * difference — both paths produce the same `PreviewDocument`.
 */
/**
 * `launchQueue` is a Chromium-only API with no TypeScript lib definition, so
 * the shape this code relies on is declared here rather than reaching for
 * `any`. Only the two members actually used are described.
 */
interface WindowWithLaunchQueue extends Window {
  launchQueue?: {
    setConsumer: (
      consumer: (params: { files: FileSystemFileHandle[] }) => void,
    ) => void;
  };
}

/**
 * How many files a single drop may open at once.
 *
 * A strip is a way of choosing between a handful of files, not a file manager;
 * past this it stops being readable and starts being a list. Anything beyond
 * is disclosed rather than silently dropped, which is the whole point.
 */
const MAX_FILES = 20;

function unreachableMessage(label: string): string {
  return (
    `We couldn't reach the server to convert this ${label} file. ` +
    `Files read in your browser — CSV, Markdown, JSON, PDF and text — ` +
    `open with no connection.`
  );
}

function rateLimitedMessage(label: string): string {
  return (
    `Too many files in quick succession, so the server is turning ` +
    `requests away for a moment. Wait a minute and open this ${label} file ` +
    `again. Files read in your browser — CSV, Markdown, JSON, PDF and text — ` +
    `are unaffected.`
  );
}

/**
 * Which of the two an upload failure was.
 *
 * The rate limit lives in the platform's firewall, which refuses the request
 * before it reaches the application — so nothing on the server can tell us
 * this happened, and the action's rejection looks exactly like the network
 * being gone. The status code is the only place the difference exists, and a
 * server action's rejection does not carry it.
 *
 * So the failure path asks, with one request of the same shape the rule
 * matches. A refusal answers 403; an ordinary POST to a page path answers 405,
 * because the page is not an endpoint. Two codes, unambiguous, and the app
 * itself needs no new route to answer with.
 *
 * It costs one request, only after an upload has already failed. If the
 * network is what failed, this rejects without reaching anyone. If the limit
 * is what failed, the budget it spends is already spent.
 */
async function refusedByRateLimit(): Promise<boolean> {
  try {
    const response = await fetch(window.location.pathname, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=UTF-8" },
      body: "",
      cache: "no-store",
    });
    return response.status === 403;
  } catch {
    // No answer at all is the offline case, which is the other message.
    return false;
  }
}

export default function FileWorkbench() {
  const [document, setDocument] = useState<PreviewDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Bumped on every successful open and used as the pane's key, so viewer state
  // (the selected sheet, the scroll window) starts fresh per file instead of
  // being inherited from the file before it.
  const [openId, setOpenId] = useState(0);
  /**
   * Everything that arrived together, and which one is on screen.
   *
   * Only the selected file is ever parsed. Opening a dozen spreadsheets
   * because a dozen were dropped would mean a dozen uploads for a person who
   * wanted to look at one of them.
   */
  const [files, setFiles] = useState<File[]>([]);
  const [activeFile, setActiveFile] = useState(0);
  /** Set when a drop carried more files than the strip will show. */
  const [droppedTooMany, setDroppedTooMany] = useState<string | null>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  /**
   * Which open is the current one.
   *
   * Choosing another file while one is still loading used to be a race the
   * slower parse could win, leaving the pane showing a document the strip says
   * is not selected. Each call takes a ticket and drops its result if a later
   * one has started since.
   */
  const openToken = useRef(0);

  const open = useCallback(async (file: File) => {
    const token = openToken.current + 1;
    openToken.current = token;
    const current = () => openToken.current === token;

    setBusy(true);
    setError(null);

    // A failed open must not leave the previous file on screen, or the error
    // sits above a header naming a different document.
    const fail = (message: string) => {
      if (!current()) return;
      setDocument(null);
      setError(message);
    };

    const succeed = (opened: PreviewDocument) => {
      if (!current()) return;
      setDocument(opened);
      setOpenId((id) => id + 1);
    };

    try {
      const spec = detectFormat(file.name, file.type);

      if (!spec) {
        fail(`We can't open ${file.name} yet.`);
        return;
      }

      if (spec.runtime === "client" && hasClientParser(spec.id)) {
        try {
          succeed(await parseInBrowser(file, spec.id));
        } catch (cause) {
          /*
           * A file parsed in the browser fails in the browser, where nothing
           * reaches us. This is the one thing a client-runtime format sends
           * anywhere, and only after it has already failed: the format, the
           * phase and the error's class. The file, its name and the message
           * stay on the device.
           */
          void reportClientFailure({
            formatId: spec.id,
            phase: "parse",
            errorName: safeErrorName(cause),
            sizeBucket: sizeBucket(file.size),
          });
          // Rethrown so the message the user sees is unchanged — this adds an
          // observation, not a behaviour.
          throw cause;
        }
        return;
      }

      // Checked here, before the upload is attempted, because an oversized body
      // is rejected at the platform edge — the server action never runs, so its
      // own size check can't produce a message the user would understand.
      // The action still re-checks; this is about which error they see.
      if (file.size > spec.maxBytes) {
        fail(
          `${spec.label} files are limited to ${formatBytes(spec.maxBytes)}. ` +
            `This one is ${formatBytes(file.size)}.`,
        );
        return;
      }

      const formData = new FormData();
      formData.append("file", file);

      /*
       * Server-parsed formats are the only thing here that needs a network,
       * and when they cannot reach it they must say so — the generic parser
       * message reads as the app being broken, when in fact every other format
       * still works with no connection at all.
       *
       * The signal is the action *throwing* rather than returning. A file the
       * parser cannot read comes back as `{ ok: false }` with its own message
       * and never lands here, so a throw means the conversion never happened:
       * no network, or a server that failed outright. Both are the same thing
       * to the person holding the file.
       *
       * Deliberately not `navigator.onLine`, which was the first attempt and
       * is not trustworthy: it reports whether the device has *a* network, not
       * whether this server is reachable. A captive-portal wifi reports online,
       * and a browser driven offline in CI reported online too — which is how
       * this was caught, showing "Failed to fetch" instead of the message.
       */
      let result: Awaited<ReturnType<typeof previewFile>>;
      try {
        result = await previewFile(formData);
      } catch {
        // Which failure this was is not knowable from the rejection, so it is
        // asked rather than guessed. "Too fast" and "no connection" call for
        // opposite things from the person holding the file: one means wait a
        // moment, the other means the file needs a format that opens locally.
        fail(
          (await refusedByRateLimit())
            ? rateLimitedMessage(spec.label)
            : unreachableMessage(spec.label),
        );
        return;
      }

      if (result.ok) {
        succeed(result.document);
      } else {
        fail(result.error);
      }
    } catch (cause) {
      fail(
        cause instanceof Error
          ? cause.message
          : "Something went wrong opening that file.",
      );
    } finally {
      if (current()) setBusy(false);
    }
  }, []);

  const openMany = useCallback(
    async (incoming: File[]) => {
      const kept = incoming.slice(0, MAX_FILES);
      setFiles(kept);
      setActiveFile(0);
      setDroppedTooMany(
        incoming.length > kept.length
          ? `${incoming.length} files were dropped; showing the first ${kept.length}.`
          : null,
      );
      if (kept[0]) await open(kept[0]);
    },
    [open],
  );

  const select = useCallback(
    async (index: number) => {
      const file = files[index];
      if (!file) return;
      setActiveFile(index);
      await open(file);
    },
    [files, open],
  );

  /*
   * A file the operating system handed over, because the app is installed and
   * the manifest registered it as a handler for that type.
   *
   * Chromium only, and only when installed — `launchQueue` is simply absent
   * everywhere else, which is why this is a capability check rather than a
   * feature flag. It routes into the same `open` as a drop or a file picker,
   * so nothing downstream knows the difference.
   */
  useEffect(() => {
    const queue = (window as WindowWithLaunchQueue).launchQueue;
    if (!queue) return;

    queue.setConsumer(async ({ files: handles }) => {
      // Selecting several files and choosing "open with" hands over all of
      // them, so this is not a hypothetical plural.
      const opened = await Promise.all(handles.map((handle) => handle.getFile()));
      if (opened.length > 0) await openMany(opened);
    });
  }, [openMany]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <DropZone
        onFiles={openMany}
        onNothingUsable={(reason) => {
          setDocument(null);
          setError(reason);
        }}
        busy={busy}
        compact={document !== null}
      />

      {/*
        The other files that came with this one.
        
        Shown only when there is a choice to make. A tablist because that is
        what it is — one panel below, several things selecting it — and it
        follows the sheet tabs in taking a single tab stop with arrow keys
        inside, rather than putting twenty stops between the drop zone and the
        document.
      */}
      {files.length > 1 && (
        <div
          role="tablist"
          aria-label="Dropped files"
          className="-mx-1 flex gap-1 overflow-x-auto px-1"
          onKeyDown={(event) => {
            const step =
              event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
            let next = activeFile;
            if (step !== 0) {
              next = (activeFile + step + files.length) % files.length;
            } else if (event.key === "Home") {
              next = 0;
            } else if (event.key === "End") {
              next = files.length - 1;
            } else {
              return;
            }
            event.preventDefault();
            tabs.current[next]?.focus();
            void select(next);
          }}
        >
          {files.map((candidate, index) => (
            <button
              key={`${candidate.name}-${index}`}
              ref={(element) => {
                tabs.current[index] = element;
              }}
              role="tab"
              aria-selected={index === activeFile}
              tabIndex={index === activeFile ? 0 : -1}
              // Deliberately not disabled while a file is opening. The browser
              // moves focus off a control that becomes disabled, so arrowing
              // along the strip lost focus after the first move and the rest
              // of the keys went nowhere. `open` guards the race instead.
              title={candidate.name}
              onClick={() => void select(index)}
              className={[
                "max-w-52 shrink-0 truncate rounded-lg border px-3 py-1.5 text-xs transition-colors",
                index === activeFile
                  ? "border-accent bg-accent/5 text-ink"
                  : "border-line text-muted hover:text-ink",
              ].join(" ")}
            >
              {candidate.name}
            </button>
          ))}
        </div>
      )}

      {droppedTooMany !== null && (
        <p className="text-xs text-muted">{droppedTooMany}</p>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-accent/40 bg-accent/5 px-4 py-3 text-sm"
        >
          {error}
        </p>
      )}

      {document && (
        <PreviewPane
          key={openId}
          document={document}
          onClose={() => {
            setDocument(null);
            setError(null);
          }}
          /*
           * A file that came out of an archive opens exactly like a dropped
           * one: same detection, same caps, same viewer, same sequence ticket.
           * The strip is deliberately left alone — the archive is still the
           * file the person opened, and replacing it in the list would lose
           * the way back to it.
           */
          onOpen={(inner) => void open(inner)}
        />
      )}
    </div>
  );
}
