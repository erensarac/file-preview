"use client";

import { useCallback, useState } from "react";

import { previewFile } from "@/app/actions/preview";
import { hasClientParser, parseInBrowser } from "@/lib/adapters/client";
import { detectFormat } from "@/lib/formats";
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

  const open = useCallback(async (file: File) => {
    setBusy(true);
    setError(null);

    try {
      const spec = detectFormat(file.name, file.type);

      if (!spec) {
        setError(`We can't open ${file.name} yet.`);
        return;
      }

      if (spec.runtime === "client" && hasClientParser(spec.id)) {
        setDocument(await parseInBrowser(file, spec.id));
        return;
      }

      const formData = new FormData();
      formData.append("file", file);
      const result = await previewFile(formData);

      if (result.ok) {
        setDocument(result.document);
      } else {
        setError(result.error);
      }
    } catch (cause) {
      setError(
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
