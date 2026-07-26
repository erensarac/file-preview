"use client";

import { formatBytes } from "@/lib/formats";
import type { PreviewDocument } from "@/lib/preview";

import HtmlViewer from "./viewers/HtmlViewer";
import SheetViewer from "./viewers/SheetViewer";
import TextViewer from "./viewers/TextViewer";

function Viewer({ preview }: { preview: PreviewDocument["preview"] }) {
  switch (preview.kind) {
    case "sheet":
      return <SheetViewer sheets={preview.sheets} />;
    case "html":
      return <HtmlViewer html={preview.html} />;
    case "text":
      return <TextViewer text={preview.text} />;
  }
}

export default function PreviewPane({
  document,
  onClose,
}: {
  document: PreviewDocument;
  onClose: () => void;
}) {
  const { meta } = document;

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3">
        <h2 className="mr-auto truncate font-medium" title={meta.name}>
          {meta.name}
        </h2>

        <span className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted">
          {meta.formatLabel}
        </span>
        <span className="text-xs text-muted tabular-nums">
          {formatBytes(meta.size)}
        </span>
        <span
          className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted"
          title={
            meta.parsedIn === "browser"
              ? "This file was read in your browser and never left your device."
              : "This file was converted on the server and was not stored."
          }
        >
          {meta.parsedIn === "browser" ? "read locally" : "converted on server"}
        </span>

        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:text-ink"
        >
          Close
        </button>
      </header>

      {meta.notices.length > 0 && (
        <ul className="space-y-1 border-b border-line bg-canvas px-4 py-2 text-xs text-muted">
          {meta.notices.map((notice, index) => (
            <li key={index}>{notice}</li>
          ))}
        </ul>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        <Viewer preview={document.preview} />
      </div>
    </section>
  );
}
