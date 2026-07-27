# file

Open a spreadsheet, document or data file in the browser without installing
anything. Excel, Word, CSV, TSV, Markdown, JSON and plain text/code today; the
architecture is built so adding the next format is a small, local change.

## The idea

Instead of one site per format, one site for all of them. The user's problem is
never "I need an XLSX viewer" — it's "I have a file and nothing to open it
with." Format is our concern, not theirs.

## Where files are parsed

This is the one design decision everything else follows from. Each format
declares a `runtime` in `lib/formats.ts`:

| Runtime  | Formats                          | What happens                                                        |
| -------- | -------------------------------- | ------------------------------------------------------------------- |
| `client` | CSV, TSV, Markdown, JSON, text   | Read with the File API in the tab. **Never sent anywhere.**          |
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
lib/preview.ts          The Preview union every adapter returns and every viewer renders.
lib/adapters/client.ts  Browser parsers (papaparse, marked, JSON).
lib/adapters/server.ts  Server parsers (exceljs, mammoth). `server-only`.
app/actions/preview.ts  The upload API, as a server action. Re-validates everything.
components/             DropZone, PreviewPane, and one viewer per Preview kind.
```

## Adding a format

1. Add an entry to `FORMATS` in `lib/formats.ts` with its extensions, size cap
   and runtime.
2. Add a parser to `lib/adapters/client.ts` or `lib/adapters/server.ts`, keyed by
   the new id, returning one of the existing `Preview` shapes.

That's it — detection, routing, the drop zone chips, size limits and the viewer
all follow from the registry. Only a genuinely new *kind* of content (a paged
PDF, an image) needs a new `Preview` variant and viewer.

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

## Development

```bash
npm install
npm run dev        # http://localhost:3000
npm run build
npm run typecheck
```

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4.
