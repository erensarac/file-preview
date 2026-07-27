"use client";

import { useCallback, useState } from "react";

import { previewFile } from "@/app/actions/preview";
import { hasClientParser, parseInBrowser } from "@/lib/adapters/client";
import { detectFormat, formatBytes } from "@/lib/formats";
import type { PreviewDocument } from "@/lib/preview";

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
export default function FileWorkbench() {
  const [document, setDocument] = useState<PreviewDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Bumped on every successful open and used as the pane's key, so viewer state
  // (the selected sheet, the scroll window) starts fresh per file instead of
  // being inherited from the file before it.
  const [openId, setOpenId] = useState(0);

  const open = useCallback(async (file: File) => {
    setBusy(true);
    setError(null);

    // A failed open must not leave the previous file on screen, or the error
    // sits above a header naming a different document.
    const fail = (message: string) => {
      setDocument(null);
      setError(message);
    };

    const succeed = (opened: PreviewDocument) => {
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
        succeed(await parseInBrowser(file, spec.id));
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
      const result = await previewFile(formData);

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
      setBusy(false);
    }
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <DropZone onFile={open} busy={busy} compact={document !== null} />

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
        />
      )}
    </div>
  );
}
