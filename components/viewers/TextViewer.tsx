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
    grammar !== null &&
    text.length <= MAX_HIGHLIGHT_BYTES &&
    lines.length <= MAX_NUMBERED_LINES;

  /**
   * Highlighting is a progressive enhancement: the text is on screen
   * immediately and gains colour once the grammar has been fetched and run, so
   * a file stays readable even if that never happens.
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

  // Files too large to number are also too large to highlight, so this branch
  // never swaps and can afford its own simpler layout.
  if (lines.length > MAX_NUMBERED_LINES) {
    return (
      <pre className="overflow-auto px-6 py-6 font-mono text-sm leading-6">
        {text}
      </pre>
    );
  }

  /**
   * Both states render the same structure — a `pre > code > span.line` tree
   * styled by `.code-block` — so gaining colour changes no geometry.
   *
   * They used to differ: the plain state was a table and the highlighted one
   * Shiki's markup, so when highlighting landed the text visibly shifted and
   * reindented. Matching the markup is what makes the swap invisible, and the
   * spec pins the line positions across it.
   */
  return (
    <div className="overflow-auto py-3">
      {highlighted ? (
        // Shiki builds this from parsed tokens rather than by interpolating
        // the source, so the file's own text is never treated as markup.
        <div
          className="code-block"
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      ) : (
        <div className="code-block">
          <pre>
            <code>
              {lines.map((line, index) => (
                <span key={index} className="line">
                  {line}
                </span>
              ))}
            </code>
          </pre>
        </div>
      )}
    </div>
  );
}
