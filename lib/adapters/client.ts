/**
 * Browser-side adapters.
 *
 * Everything in here runs in the user's tab: the file is read with the File API
 * and never touches the network. Parsers are loaded with dynamic `import()` so
 * a user previewing a CSV doesn't download the Markdown renderer, and vice
 * versa.
 */

import { extensionOf, getFormat, type FormatId } from "../formats";
import {
  MAX_PREVIEW_ROWS,
  type Preview,
  type PreviewDocument,
} from "../preview";

type ClientParser = (
  file: File,
  notices: string[],
) => Promise<Preview>;

const parseDelimited =
  (delimiter: string): ClientParser =>
  async (file, notices) => {
    const { default: Papa } = await import("papaparse");
    const text = await file.text();

    const result = Papa.parse<string[]>(text, {
      delimiter,
      skipEmptyLines: "greedy",
    });

    if (result.errors.length > 0) {
      const first = result.errors[0]!;
      notices.push(
        `${result.errors.length} parsing issue(s); first: ${first.message}` +
          (first.row !== undefined ? ` (row ${first.row + 1})` : ""),
      );
    }

    const totalRows = result.data.length;
    const rows = result.data.slice(0, MAX_PREVIEW_ROWS);
    if (totalRows > rows.length) {
      notices.push(
        `Showing the first ${rows.length.toLocaleString()} of ${totalRows.toLocaleString()} rows.`,
      );
    }

    return {
      kind: "sheet",
      sheets: [{ name: file.name, rows, totalRows }],
    };
  };

const parseMarkdown: ClientParser = async (file) => {
  const [{ marked }, { default: DOMPurify }] = await Promise.all([
    import("marked"),
    import("dompurify"),
  ]);

  const raw = await marked.parse(await file.text(), { async: true });

  // The file is untrusted input rendered into our own origin, so it goes
  // through DOMPurify before it ever reaches dangerouslySetInnerHTML.
  return { kind: "html", html: DOMPurify.sanitize(raw) };
};

const parseJson: ClientParser = async (file, notices) => {
  const text = await file.text();
  try {
    // Re-serialize so the preview is pretty-printed regardless of the source.
    return {
      kind: "text",
      text: JSON.stringify(JSON.parse(text), null, 2),
      language: "json",
    };
  } catch (error) {
    notices.push(
      `Not valid JSON (${error instanceof Error ? error.message : "parse error"}); showing the raw text.`,
    );
    return { kind: "text", text, language: "json" };
  }
};

const parseText: ClientParser = async (file) => ({
  kind: "text",
  text: await file.text(),
  language: extensionOf(file.name) || "text",
});

const PARSERS: Partial<Record<FormatId, ClientParser>> = {
  csv: parseDelimited(","),
  tsv: parseDelimited("\t"),
  markdown: parseMarkdown,
  json: parseJson,
  text: parseText,
};

export function hasClientParser(id: FormatId): boolean {
  return id in PARSERS;
}

/**
 * Parses a file entirely in the browser. Throws if the format has no
 * client-side parser — callers should route those to the server action instead.
 */
export async function parseInBrowser(
  file: File,
  formatId: FormatId,
): Promise<PreviewDocument> {
  const parser = PARSERS[formatId];
  if (!parser) {
    throw new Error(`${formatId} has no browser parser`);
  }

  const spec = getFormat(formatId);
  if (file.size > spec.maxBytes) {
    throw new Error(
      `${spec.label} files are limited to ${Math.round(spec.maxBytes / (1024 * 1024))} MB.`,
    );
  }

  const notices: string[] = [];
  const preview = await parser(file, notices);

  return {
    meta: {
      name: file.name,
      size: file.size,
      formatId,
      formatLabel: spec.label,
      parsedIn: "browser",
      notices,
    },
    preview,
  };
}
