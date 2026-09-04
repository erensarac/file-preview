/**
 * Browser-side adapters.
 *
 * Everything in here runs in the user's tab: the file is read with the File API
 * and never touches the network. Parsers are loaded with dynamic `import()` so
 * a user previewing a CSV doesn't download the Markdown renderer, and vice
 * versa.
 */

import { extensionOf, FORMATS, getFormat, type FormatId } from "../formats";
import {
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

    /*
     * Every row, not the first `MAX_PREVIEW_ROWS` of them.
     *
     * That cap belongs to the server adapter, where it bounds what a parser
     * builds inside a request. Here it bounded nothing: papaparse has already
     * produced the whole array by this line, so slicing it cost the rows
     * without saving the memory — the file was read in the tab, no instance
     * was at risk, and a 50,000-row CSV was cut to 2,000 for a reason that
     * belonged to the other runtime.
     *
     * The viewer mounts only the rows in view and sizes columns from a sample,
     * so what this hands over is bounded by the file's own size cap and
     * nothing else.
     */
    const rows = result.data;
    const totalRows = rows.length;

    return {
      kind: "sheet",
      sheets: [{ name: file.name, rows, totalRows }],
    };
  };

const parseMarkdown: ClientParser = async (file) => {
  const [{ marked }, { default: DOMPurify }, { sanitizeDocumentHtml }] =
    await Promise.all([
      import("marked"),
      import("dompurify"),
      import("../document-html"),
    ]);

  const raw = await marked.parse(await file.text(), { async: true });

  // The file is untrusted input rendered into our own origin, so it goes
  // through the document pass before it ever reaches dangerouslySetInnerHTML.
  return { kind: "html", html: sanitizeDocumentHtml(DOMPurify, raw) };
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

/**
 * PDF is passed through rather than parsed.
 *
 * The bytes are checked for the file signature and handed to the viewer, which
 * renders pages with pdf.js as they are scrolled to. Doing the rendering here
 * would mean producing every page as a bitmap before the first one could be
 * shown.
 */
const parsePdf: ClientParser = async (file) => {
  const bytes = new Uint8Array(await file.arrayBuffer());

  // "%PDF-". A file that fails this would otherwise reach pdf.js and come back
  // as an opaque worker error.
  const signature = [0x25, 0x50, 0x44, 0x46, 0x2d];
  const looksRight = signature.every((byte, index) => bytes[index] === byte);
  if (!looksRight) {
    throw new Error("This doesn't look like a PDF file.");
  }

  return { kind: "pdf", bytes };
};

/**
 * The MIME type to wrap an image's bytes in.
 *
 * `file.type` is the browser's own guess and is routinely empty — a file
 * dragged from an archive, or handed over by an operating system that does not
 * know the extension. A blob with no type will not render, so the extension is
 * the fallback rather than the other way round.
 */
const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
};

/**
 * An image is passed through, like a PDF: the browser is the decoder.
 *
 * There is no signature check here on purpose. The equivalent of the PDF one
 * would be a table of magic bytes for eight formats, which can only ever
 * reject things — and the browser already gives a definitive answer when it
 * tries to decode. A file that is not really a PNG fails there, along with
 * every corrupt file, and the viewer says so in one place.
 */
const parseImage: ClientParser = async (file) => {
  const extension = extensionOf(file.name);
  const declared = file.type.startsWith("image/") ? file.type : null;

  return {
    kind: "image",
    bytes: new Uint8Array(await file.arrayBuffer()),
    mimeType: declared ?? IMAGE_MIME[extension] ?? "application/octet-stream",
  };
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
  pdf: parsePdf,
  image: parseImage,
};

// A format whose runtime and parser disagree fails confusingly at the far end —
// the client hands it to the server action, which replies that it should have
// been parsed in the browser. Catch the mismatch at module load instead.
if (process.env.NODE_ENV !== "production") {
  const missing = FORMATS.filter(
    (f) => f.runtime === "client" && !(f.id in PARSERS),
  ).map((f) => f.id);
  if (missing.length > 0) {
    throw new Error(
      `Formats declared runtime: "client" with no browser parser: ${missing.join(", ")}`,
    );
  }
}

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
