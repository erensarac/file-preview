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

Each rendered page also carries a transparent layer of positioned text from
pdf.js, so a page can be selected, copied and found with the browser's own
search, and read by a screen reader. The canvas is `aria-hidden` for that
reason — the words are already in the DOM, and announcing the bitmap too would
read the page twice.

The layer is laid out in CSS pixels, using the zoom alone rather than the
canvas's zoom × device-pixel-ratio backing scale. Mixing the two puts the
selection boxes at a fraction of the glyphs they belong to, which is invisible
until someone tries to select something.

Page positions are accumulated rather than multiplied. Every page was once
assumed to be the size of page 1 — which is what a viewer needs before it can
size the scroll region without parsing the whole document — while each canvas
was rasterised from its own viewport. A landscape page inside a portrait
report was therefore drawn landscape and displayed in a portrait box, squashed,
with its text layer sliding off its glyphs. Page 1's size is still the estimate,
but each page reports its real one as it comes into view and the layout
corrects itself; a correction above the viewport is compensated in the scroll
position so nothing jumps under the reader.

That arithmetic is also what the page box in the toolbar uses: typing a number
scrolls to where that page actually starts, which in a mixed-size document is
not a multiple of anything.

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

Fenced code blocks inside Markdown are coloured the same way, upgraded in place
after the document renders. Only the contents of each `<code>` are replaced, so
a block gains colour without moving. A fence naming a language nothing has a
grammar for — or naming `text` — is left alone, and a document with no
recognised fence never loads the highlighter at all.

## Adding a format

1. Add an entry to `FORMATS` in `lib/formats.ts` with its extensions, size cap
   and runtime.
2. Add a parser to `lib/adapters/client.ts` or `lib/adapters/server.ts`, keyed by
   the new id, returning one of the existing `Preview` shapes.

That's it — detection, routing, the drop zone chips, size limits and the viewer
all follow from the registry. Only a genuinely new *kind* of content — an image,
say — needs a new `Preview` variant and viewer, as PDF did.

## Landing pages

People do not search for "file preview" — they search for "open xlsx online" or
"view a docx without Word". `lib/landing.ts` carries one page per format, and
`app/[viewer]/page.tsx` prerenders them with their own titles, descriptions and
canonical URLs. `dynamicParams` is off, so an unlisted slug is a 404 rather than
a dynamic segment answering for every unknown path on the site.

The copy lives apart from `lib/formats.ts` deliberately: that registry describes
how files are parsed and is imported by both runtimes. A spec asserts every
landing page names a format the registry knows, so they cannot drift.

`app/sitemap.ts` and `app/robots.ts` are generated from the same list, and
`lib/site.ts` resolves the canonical origin — preferring Vercel's production
domain over the per-deployment hostname, so previews do not claim to be
canonical.

Each page also has its own link preview card, generated at build time by
`app/[viewer]/opengraph-image.tsx` from the same landing entry the page uses,
so `/excel-viewer` unfurls into a card that says Excel rather than one generic
image for all six. The second line comes from the format's `runtime`: an Excel
card says it is converted on the server, a PDF card says it is not — the
distinction the pages exist to make. `lib/og-card.tsx` holds the layout once,
because six cards drifting apart is how a set of pages stops looking like one
product.

The images are generated rather than committed so the wordmark and the palette
cannot drift from the site's own. They carry no `fontWeight`: satori's built-in
font ships a single weight, so declaring one renders identically and only
implies an effect it does not have — the hierarchy is size and colour. A real
bold would mean committing a font file, which is a lot of weight for a link
preview.

## What is remembered

Column widths, per sheet, for as long as the file is open. Widen a column, look
at another sheet, come back — it is still widened. Opening another file starts
fresh, because the pane is remounted per file.

That is the whole list, and it lives in component state rather than storage on
purpose: remembering widths across visits would mean keeping a record of which
files someone opened, which is not a trade worth making for a column width.

## Narrow screens

Nothing was designed below a desktop width until it was measured. At 390x844 —
the most common phone viewport — 328px of an 844px screen went on the title,
the description and the drop target before any of the file the user came to
read, a PDF page rendered 620px wide inside a 390px window with nothing to say
the rest was reachable, and a long Markdown document had no height cap at all,
so the pane grew past the viewport and scrolled the filename off the top.

Three rules came out of that:

- **One scroll region rule, in `.viewer-scroller`.** The four viewers used to
  disagree — two capped at `70vh`, two had no cap — and now share one. It is
  `dvh`, not `vh`: a phone's URL bar retracts as you scroll and `vh` stays
  pinned to the tall viewport, so a `vh`-sized scroller resizes underneath the
  finger scrolling it.
- **A PDF fits the width it has.** Zoom is a number the user picked or, by
  default, whatever fits. Fitting never magnifies — it only shrinks a page too
  wide for the window — so nothing changes on a desktop, where a page already
  fits at 100%.
- **The column resize handle stops taking pointer events on a coarse pointer.**
  It is an 8px strip carrying `touch-action: none` down the right edge of every
  column header, so on a phone it swallowed any scroll that started near a
  column border. It stays in the DOM and stays focusable: the keyboard path is
  untouched, which is what a tablet with a keyboard needs.

Below `sm` the drop zone stops describing a drag. A phone has no such gesture,
and naming it next to the button that is the only way in is worse than saying
nothing.

## Installing it

`app/manifest.ts` makes the site installable, and `public/sw.js` makes it work
with no connection. That is worth more here than it is for most sites: every
format except Excel and Word is parsed in the tab and never uploaded, so there
is no round-trip to lose — what was missing was the shell.

The worker is **network-first for everything**, with the cache used only as a
fallback. The usual arrangement, cache-first for static assets, is faster and
is also the easiest way to ship a bug that outlives its fix: a stale entry gets
served forever, and "clear your cache" does not reach someone who installed the
app rather than bookmarking it. Nothing is precached either, so there is no
hand-written inventory of build artefacts to go stale — offline therefore works
from the second visit, and a PDF opens offline once pdf.js's worker and fonts
have been fetched at least once.

Only same-origin successful GETs are cached, which excludes the server action
by construction. A spec asserts the cache holds nothing derived from a user's
file, because a cache quietly retaining document content would break the
privacy split in the least visible way possible.

Excel and Word need a connection, and offline they say so rather than failing
with the generic parser message, which would read as the app being broken.

`file_handlers` in the manifest registers the app with the operating system, so
a double-clicked spreadsheet can open here. The accept map is derived from
`lib/formats.ts` the same way `ACCEPT_ATTRIBUTE` is — adding a format registers
it with the OS by the same one-line change. It is Chromium-only and only once
installed; nothing depends on it.

## Accessibility

Every viewer is audited with axe against WCAG A and AA, in both colour schemes,
as part of the suite. The first run found three real failures: an unlabelled
file input, scroll regions no keyboard could reach, and contrast — the primary
button at 2.66:1 in dark mode, and syntax tokens at 3.42:1 and 4.41:1 against
the required 4.5:1.

Contrast is why the high-contrast Shiki themes are used and why the accent
carries its own foreground token: white on the dark scheme's accent does not
pass, so the text flips instead.

The same sweep runs at a phone width, which is not redundant: width changes
what axe can see. Its first run found a code block inside a rendered document
scrolling sideways with no way to focus it — invisible to the desktop sweep,
because at that width the same block fits and is not a scroll region at all.
WCAG 2.2 AA is included for its target-size rule, which only says anything
where the controls are tightest.

Automated rules cannot judge whether a control can actually be operated, so
keyboard paths are covered separately: sheet tabs are one tab stop with arrow
keys inside, column resize handles take arrow keys and Enter for auto-fit, and
scroll regions are focusable so they can be scrolled without a pointer.

## Safety notes

- Parser HTML output (Markdown, Word) goes through DOMPurify **in the adapter**,
  before it reaches `dangerouslySetInnerHTML`. New `kind: "html"` adapters must
  do the same.
- Relative link and image targets are stripped by the same sanitizer pass
  (`lib/document-html.ts`). A previewed document isn't hosted anywhere, so a
  relative href resolves against *our* origin — it navigates away from the
  preview, loses the open file, and lets a document make this site appear to
  offer whatever it names. Absolute `http(s)`, `mailto:` and `tel:` links, and
  same-document anchors, are left alone.
- Headings are given ids by that same pass, using GitHub's slug rule so a table
  of contents written against GitHub's rendering still works. Repeated headings
  take a numeric suffix in document order, and letters are matched by Unicode
  property rather than `a-z` — "Şubat Özeti" becomes `şubat-özeti` instead of
  collapsing to nothing.
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

CI runs typecheck and the full suite on every pull request. The Chromium
Playwright drives is cached between runs, keyed on the resolved Playwright
version rather than the lockfile — the lockfile changes whenever any dependency
does, which would discard a browser that is still correct. There are no
`restore-keys`: a near-miss would restore a browser the installed Playwright
cannot drive.

Note that `playwright install --with-deps` also installs system libraries, and
those live outside the cached directory, so the cache-hit path still runs
`playwright install-deps`.

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4.

[CONTRIBUTING.md](CONTRIBUTING.md) covers the conventions that are not visible
from the code: that fixtures are generated rather than committed, what a new
format costs, and which constraints on the format registry the build enforces.

## License

MIT — see [LICENSE](LICENSE).
