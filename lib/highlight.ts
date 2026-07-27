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
 */
const THEMES = { light: "github-light", dark: "github-dark" } as const;

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loaded = new Set<string>();

async function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, light, dark] =
        await Promise.all([
          import("shiki/core"),
          import("shiki/engine/javascript"),
          import("@shikijs/themes/github-light"),
          import("@shikijs/themes/github-dark"),
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
