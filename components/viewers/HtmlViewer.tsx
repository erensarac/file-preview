"use client";

import { useEffect, useState } from "react";

import { highlightFragment } from "@/lib/highlight";
import { grammarForFenceName } from "@/lib/languages";

/** Matches the cap the text viewer uses, for the same reason. */
const MAX_BLOCK_LENGTH = 100_000;

/**
 * Colours the fenced code blocks in already-rendered Markdown.
 *
 * The document is returned unchanged when nothing needs highlighting, which is
 * every Word document and any Markdown without a recognised fence — the
 * highlighter is not even loaded in that case.
 *
 * Only the contents of each `<code>` are replaced. The `<pre>` that Markdown
 * produced stays exactly where it was, so a block gains colour without moving,
 * and Shiki's own per-line wrappers are unwrapped before insertion.
 */
async function highlightCodeBlocks(html: string): Promise<string | null> {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const blocks = [...parsed.querySelectorAll("pre > code[class*='language-']")];
  if (blocks.length === 0) return null;

  let changed = false;

  await Promise.all(
    blocks.map(async (block) => {
      const declared = /language-(\S+)/.exec(block.className)?.[1];
      const grammar = declared ? grammarForFenceName(declared) : null;
      const code = block.textContent ?? "";
      if (!grammar || code.length > MAX_BLOCK_LENGTH) return;

      const fragment = await highlightFragment(code, grammar);
      if (!fragment) return;

      block.innerHTML = fragment;
      changed = true;
    }),
  );

  return changed ? parsed.body.innerHTML : null;
}

/**
 * Renders HTML produced by an adapter.
 *
 * The `html` here has already been through DOMPurify — on the client for
 * Markdown, on the server for Word — which is what makes the
 * `dangerouslySetInnerHTML` below safe. Any new adapter emitting `kind: "html"`
 * must sanitize before returning, not here.
 *
 * The highlighted version is not re-sanitized: Shiki builds its output from
 * parsed tokens rather than by interpolating the source, and a second pass
 * would strip the CSS custom properties that carry the light and dark palettes.
 */
export default function HtmlViewer({ html }: { html: string }) {
  const [coloured, setColoured] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setColoured(null);

    highlightCodeBlocks(html).then((next) => {
      if (current && next) setColoured(next);
    });

    return () => {
      current = false;
    };
  }, [html]);

  return (
    <div
      role="region"
      aria-label="Document"
      tabIndex={0}
      className="overflow-auto px-6 py-8 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent sm:px-10"
    >
      <div
        className="rendered-doc mx-auto max-w-3xl"
        dangerouslySetInnerHTML={{ __html: coloured ?? html }}
      />
    </div>
  );
}
