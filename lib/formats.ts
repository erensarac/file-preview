/**
 * The format registry: the single place that knows which files `file` can open,
 * and where each one gets parsed.
 *
 * This module is imported from both the browser and the server, so it must stay
 * free of heavy parsing dependencies — it only describes formats, it never
 * opens them. The actual parsers live in `lib/adapters/client.ts` and
 * `lib/adapters/server.ts`, keyed by the ids declared here.
 *
 * Adding a format means adding an entry here plus a parser in one of those two
 * files. Nothing else in the app needs to change.
 */

export type FormatId =
  | "csv"
  | "tsv"
  | "markdown"
  | "json"
  | "text"
  | "xlsx"
  | "docx";

/**
 * Where a format is parsed.
 *
 * "client" files never leave the browser. "server" is reserved for binary
 * formats whose parsers are too heavy (or too awkward) to ship to the browser;
 * those are streamed through a server action, held in memory, and dropped.
 */
export type Runtime = "client" | "server";

export interface FormatSpec {
  id: FormatId;
  /** Human label, shown in the UI and on the format chips. */
  label: string;
  /** Lowercase, dot-less extensions. First one is treated as canonical. */
  extensions: string[];
  /** MIME types used as a fallback when the extension is missing or wrong. */
  mimeTypes: string[];
  runtime: Runtime;
  maxBytes: number;
}

const MB = 1024 * 1024;

/**
 * The deployment's request body ceiling.
 *
 * Serverless platforms cap how large a request body they will accept, and the
 * rejection happens at the platform edge — before any of this code runs, so
 * none of our error handling applies and the user sees a bare 413. Vercel's
 * limit is 4.5 MB.
 *
 * A server-parsed format registered above this is therefore a limit we
 * advertise but cannot honour. The assertion below the registry makes that
 * impossible to do by accident; client-parsed formats are unaffected, since
 * they are never uploaded.
 */
const PLATFORM_BODY_LIMIT = 4.5 * MB;
/** Headroom for multipart framing around the file itself. */
const BODY_FRAMING_ALLOWANCE = 0.5 * MB;

export const FORMATS: readonly FormatSpec[] = [
  {
    id: "csv",
    label: "CSV",
    extensions: ["csv"],
    mimeTypes: ["text/csv", "application/csv"],
    runtime: "client",
    maxBytes: 25 * MB,
  },
  {
    id: "tsv",
    label: "TSV",
    extensions: ["tsv", "tab"],
    mimeTypes: ["text/tab-separated-values"],
    runtime: "client",
    maxBytes: 25 * MB,
  },
  {
    id: "markdown",
    label: "Markdown",
    extensions: ["md", "markdown", "mdown", "mkd"],
    mimeTypes: ["text/markdown", "text/x-markdown"],
    runtime: "client",
    maxBytes: 5 * MB,
  },
  {
    id: "json",
    label: "JSON",
    extensions: ["json", "jsonc", "geojson"],
    mimeTypes: ["application/json", "application/geo+json"],
    runtime: "client",
    maxBytes: 10 * MB,
  },
  {
    id: "text",
    label: "Text",
    extensions: [
      "txt",
      "log",
      "yml",
      "yaml",
      "toml",
      "ini",
      "env",
      "xml",
      "svg",
      "html",
      "css",
      "js",
      "jsx",
      "ts",
      "tsx",
      "py",
      "rb",
      "go",
      "rs",
      "java",
      "c",
      "h",
      "cpp",
      "sh",
      "sql",
    ],
    mimeTypes: ["text/plain"],
    runtime: "client",
    maxBytes: 10 * MB,
  },
  {
    id: "xlsx",
    label: "Excel",
    extensions: ["xlsx", "xlsm"],
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel.sheet.macroEnabled.12",
    ],
    runtime: "server",
    maxBytes: 4 * MB,
  },
  {
    id: "docx",
    label: "Word",
    extensions: ["docx"],
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    runtime: "server",
    maxBytes: 4 * MB,
  },
] as const;

/** Largest file any server-side adapter will accept — the server action's ceiling. */
export const MAX_UPLOAD_BYTES = FORMATS.filter(
  (f) => f.runtime === "server",
).reduce((max, f) => Math.max(max, f.maxBytes), 0);

// Constant against constant, so this either always holds or always fails —
// and it fails at build time rather than shipping a limit the platform will
// override. Raising a server format's cap past what the deployment accepts is
// the mistake this exists to catch.
if (MAX_UPLOAD_BYTES > PLATFORM_BODY_LIMIT - BODY_FRAMING_ALLOWANCE) {
  throw new Error(
    `Server-parsed formats accept up to ${MAX_UPLOAD_BYTES} bytes, but the ` +
      `deployment rejects request bodies over ${PLATFORM_BODY_LIMIT} bytes ` +
      `before this code runs. Lower the format cap, or move the format to a ` +
      `client runtime.`,
  );
}

const BY_ID = new Map<FormatId, FormatSpec>(FORMATS.map((f) => [f.id, f]));

export function getFormat(id: FormatId): FormatSpec {
  const spec = BY_ID.get(id);
  if (!spec) throw new Error(`Unknown format: ${id}`);
  return spec;
}

export function extensionOf(filename: string): string {
  const base = filename.slice(filename.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot < 0) return "";
  // A leading dot means the rest *is* the extension (`.env` → `env`), rather
  // than the file being extensionless.
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Works out which format a file is, preferring the extension and falling back
 * to the browser-reported MIME type. Returns null when we can't open it.
 *
 * Note that both signals come from the client and neither is trustworthy, so
 * the server re-runs this and re-checks the size before parsing anything.
 */
export function detectFormat(
  filename: string,
  mimeType = "",
): FormatSpec | null {
  const ext = extensionOf(filename);
  if (ext) {
    const byExt = FORMATS.find((f) => f.extensions.includes(ext));
    if (byExt) return byExt;
  }

  const mime = mimeType.split(";")[0]!.trim().toLowerCase();
  if (mime) {
    const byMime = FORMATS.find((f) => f.mimeTypes.includes(mime));
    if (byMime) return byMime;
    // Anything else that is plainly text is still worth showing as text.
    if (mime.startsWith("text/")) return getFormat("text");
  }

  return null;
}

/** All extensions, dotted — suitable for an `<input accept>` attribute. */
export const ACCEPT_ATTRIBUTE = FORMATS.flatMap((f) =>
  f.extensions.map((e) => `.${e}`),
).join(",");

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}
