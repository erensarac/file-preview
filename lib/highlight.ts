/**
 * Lazily-built syntax highlighter.
 *
 * Nothing here is loaded until a file that needs colouring is opened, and each
 * grammar arrives as its own chunk. The highlighter itself is created once and
 * reused, with grammars added to it as they turn up.
 *
 * The JavaScript regex engine is used rather than the Oniguruma one, which
 * would mean shipping a ~500 KB WebAssembly binary to colour a SQL file. It is
 * run in forgiving mode: a grammar rule it cannot translate is skipped, which
 * costs some fidelity in corners of a few languages and is a better trade than
 * the download.
 */

import type { HighlighterCore } from "shiki/core";

import { loadGrammar } from "./languages";

/**
 * Both themes are emitted at once as CSS variables, so the rendered code
 * follows the page's light/dark setting without re-highlighting.
 *
 * The high-contrast variants, because the ordinary ones do not meet WCAG AA
 * against this app's backgrounds: measured with axe, `github-light` put
 * keywords at 4.41:1 and `github-dark` put comments at 3.42:1, both short of
 * the 4.5:1 required for body-sized text.
 */
const THEMES = {
  light: "github-light-high-contrast",
  dark: "github-dark-high-contrast",
} as const;

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loaded = new Set<string>();

async function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, light, dark] =
        await Promise.all([
          import("shiki/core"),
          import("shiki/engine/javascript"),
          import("@shikijs/themes/github-light-high-contrast"),
          import("@shikijs/themes/github-dark-high-contrast"),
        ]);

      return createHighlighterCore({
        themes: [light.default, dark.default],
        langs: [],
        engine: createJavaScriptRegexEngine({ forgiving: true }),
      });
    })();
  }
  return highlighterPromise;
}

/**
 * Returns Shiki's HTML for the given source, or null if the grammar can't be
 * loaded. The output is already escaped by Shiki — it builds the markup from
 * parsed tokens rather than interpolating the input.
 */
/**
 * Highlights a fenced code block for insertion into already-rendered Markdown.
 *
 * Returns only the tokens, with Shiki's per-line wrappers unwrapped. Those
 * wrappers are block-level and separated by real newlines, which under
 * `white-space: pre` would break twice and double the spacing — and the
 * surrounding `<pre>` is the one Markdown produced, so leaving it in place is
 * what keeps the block from moving when colour arrives.
 */
export async function highlightFragment(
  code: string,
  grammar: string,
): Promise<string | null> {
  const html = await highlightToHtml(code, grammar);
  if (!html) return null;

  const parsed = new DOMParser().parseFromString(html, "text/html");
  const source = parsed.querySelector("pre > code");
  if (!source) return null;

  for (const line of source.querySelectorAll(".line")) {
    line.replaceWith(...line.childNodes);
  }

  return source.innerHTML;
}

export async function highlightToHtml(
  code: string,
  grammar: string,
): Promise<string | null> {
  try {
    const highlighter = await getHighlighter();

    if (!loaded.has(grammar)) {
      await highlighter.loadLanguage(
        (await loadGrammar(grammar)) as Parameters<
          HighlighterCore["loadLanguage"]
        >[0],
      );
      loaded.add(grammar);
    }

    return highlighter.codeToHtml(code, {
      lang: grammar,
      themes: THEMES,
      // Emit both palettes as CSS variables instead of committing to one.
      defaultColor: false,
    });
  } catch (error) {
    // Colour is an enhancement; a grammar that fails to load or parse must not
    // take the preview down with it.
    console.warn(`Highlighting failed for ${grammar}`, error);
    return null;
  }
}
