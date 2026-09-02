# file

Open a spreadsheet, document or data file in the browser without installing
anything. PDF, Excel, Word, CSV, TSV, Markdown, JSON and plain text/code today;
the architecture is built so adding the next format is a small, local change.

## The idea

Instead of one site per format, one site for all of them. The user's problem is
never "I need an XLSX viewer" — it's "I have a file and nothing to open it
with." Format is our concern, not theirs.

## Where files are parsed

This is the one design decision everything else follows from. Each format
declares a `runtime` in `lib/formats.ts`:

| Runtime  | Formats                          | What happens                                                        |
| -------- | -------------------------------- | ------------------------------------------------------------------- |
| `client` | CSV, TSV, Markdown, JSON, text, PDF | Read with the File API in the tab. **Never sent anywhere.**       |
| `server` | Excel (xlsx/xlsm), Word (docx)   | Posted to a server action, parsed in memory, discarded with the request. |

Text formats stay local because they can — that privacy guarantee is the
product's main differentiator, so it is given up only where a parser is genuinely
too heavy to ship to the browser. Moving a format between runtimes is a one-word
change plus a parser in the other file; nothing in the UI knows the difference.

The split is covered by a test rather than just asserted: opening a CSV must
produce zero network requests, and opening an XLSX must produce exactly one.

## Layout

```
lib/formats.ts          Format registry + detection. No parsing deps — imported by both sides.
lib/languages.ts        Extension → syntax grammar, one lazy import per grammar.
lib/highlight.ts        Shiki highlighter, built on first use and reused.
lib/preview.ts          The Preview union every adapter returns and every viewer renders.
lib/adapters/client.ts  Browser parsers (papaparse, marked, JSON, PDF passthrough).
lib/adapters/server.ts  Server parsers (exceljs, mammoth). `server-only`.
app/actions/preview.ts  The upload API, as a server action. Re-validates everything.
components/             DropZone, PreviewPane, and one viewer per Preview kind.
```

## PDF

Rendered with pdf.js in the browser, so a PDF is never uploaded and the
deployment's body limit doesn't apply to it. Pages are rasterised only while
near the viewport and released again afterwards — a hundred-page document held
entirely as bitmaps is hundreds of megabytes, and only a page or two is ever on
screen.

pdf.js's standard fonts and CMaps are not bundled with the library; without them
documents using the fourteen base fonts render with missing text. They are
copied into `public/pdfjs/` by `scripts/copy-pdf-assets.mjs`, which `prebuild`
and `predev` run, along with the worker. They are copied rather than committed
so they cannot drift from the installed version.

The **legacy** build is used deliberately: the default one calls
`Map.prototype.getOrInsertComputed`, which is new enough that rendering throws
on browsers still in common use.

## Syntax highlighting

Source files are coloured with Shiki, in the browser — a file is not uploaded
just to be highlighted. Around 90 extensions map to a grammar in
`lib/languages.ts`; anything without one still opens, plain.

Grammars are never bundled up front. Measured on a production build:

| | JS transferred |
| --- | --- |
| Initial page load | 239 KB |
| First highlighted file (core + engine + one grammar) | +134 KB |
| A second language after that (grammar only) | +172 KB |
| A CSV (no highlighting) | +19 KB |

Highlighting is a progressive enhancement: plain text paints first and is
replaced when the grammar arrives, so a file stays readable even if it never
does. Files over 300 KB are left plain.

Shiki's JavaScript regex engine is used rather than the Oniguruma one, which
would mean shipping a ~500 KB WebAssembly binary to colour a SQL file. It runs
in forgiving mode, costing some fidelity in corners of a few grammars.

## Adding a format

1. Add an entry to `FORMATS` in `lib/formats.ts` with its extensions, size cap
   and runtime.
2. Add a parser to `lib/adapters/client.ts` or `lib/adapters/server.ts`, keyed by
   the new id, returning one of the existing `Preview` shapes.

That's it — detection, routing, the drop zone chips, size limits and the viewer
all follow from the registry. Only a genuinely new *kind* of content — an image,
say — needs a new `Preview` variant and viewer, as PDF did.

## Safety notes

- Parser HTML output (Markdown, Word) goes through DOMPurify **in the adapter**,
  before it reaches `dangerouslySetInnerHTML`. New `kind: "html"` adapters must
  do the same.
- The server action re-detects the format and re-checks the size; the filename
  and MIME type from the client are treated as untrusted.
- Parser errors are logged server-side and replaced with a generic message,
  since they can quote file contents.
- Spreadsheets are capped at 2,000 rows and 200 columns per sheet for preview,
  with a notice when truncation happens.
- Office formats are zip archives, so `lib/zip-guard.ts` reads the central
  directory — the archive's own record of each entry's compressed and expanded
  size — and refuses implausible expansion **before** a parser allocates
  anything. Real fixtures peak around 9x; the limit is 200x.
- `lib/concurrency.ts` caps concurrent parses per instance and sheds the excess
  rather than queueing it. This protects one instance under load; it is not
  rate limiting, which needs a shared store and belongs at the edge.
- Server-parsed formats are capped at 4 MB because the deployment rejects
  larger request bodies at its edge, before any of this code runs. Raising a
  cap past that ceiling **fails the build** rather than shipping a limit the
  platform will silently override. Oversized files are caught in the browser so
  the user gets our message instead of a bare 413 — the upload is never
  attempted.

## Development

```bash
npm install
npm run dev        # http://localhost:3000
npm run build
npm run typecheck
```

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4.
