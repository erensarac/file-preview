"use client";

import { useEffect, useMemo, useState } from "react";

import { highlightToHtml } from "@/lib/highlight";
import { grammarForExtension, MAX_HIGHLIGHT_BYTES } from "@/lib/languages";

/** Beyond this the line-number gutter costs more than it's worth rendering. */
const MAX_NUMBERED_LINES = 20_000;

export default function TextViewer({
  text,
  language,
}: {
  text: string;
  language: string;
}) {
  const lines = useMemo(() => text.split("\n"), [text]);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  const grammar = grammarForExtension(language);
  const worthHighlighting =
    grammar !== null && text.length <= MAX_HIGHLIGHT_BYTES;

  /**
   * Highlighting is a progressive enhancement: the plain text is on screen
   * immediately and gets replaced once the grammar has been fetched and run.
   * A file therefore stays readable even if the grammar never arrives.
   */
  useEffect(() => {
    if (!worthHighlighting || !grammar) {
      setHighlighted(null);
      return;
    }

    let current = true;
    highlightToHtml(text, grammar).then((html) => {
      if (current) setHighlighted(html);
    });
    return () => {
      current = false;
    };
  }, [text, grammar, worthHighlighting]);

  if (highlighted) {
    return (
      <div className="overflow-auto px-2 py-4">
        {/*
          Shiki builds this markup from parsed tokens rather than by
          interpolating the source, so the file's own text is never treated as
          markup. Line numbers come from a CSS counter over its `.line` spans.
        */}
        <div
          className="code-block"
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </div>
    );
  }

  if (lines.length > MAX_NUMBERED_LINES) {
    return (
      <pre className="overflow-auto px-6 py-6 font-mono text-sm leading-6">
        {text}
      </pre>
    );
  }

  return (
    <div className="overflow-auto">
      <table className="w-max border-collapse font-mono text-sm leading-6">
        <tbody>
          {lines.map((line, index) => (
            <tr key={index}>
              <td className="sticky left-0 select-none border-r border-line bg-canvas px-3 text-right align-top tabular-nums text-muted">
                {index + 1}
              </td>
              <td className="whitespace-pre px-4">{line || " "}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
