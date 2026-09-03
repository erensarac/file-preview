# Contributing

Thanks for looking. This file covers the things that are not obvious from the
code, and nothing that is — the [README](README.md) explains what the project
is and why it is built the way it is, and it is worth reading first.

## Getting it running

Node 22 is what CI uses.

```bash
npm install
npm run dev        # http://localhost:3000
```

`predev` and `prebuild` copy pdf.js's worker, standard fonts and CMaps into
`public/pdfjs/`. That directory is generated and gitignored — without it, PDFs
render with missing text, so run through the npm scripts rather than
`next dev` directly.

## Before you open a pull request

```bash
npm run typecheck
npm test
```

Both are what CI runs, and both have to pass. The first run of `npm test`
downloads a browser:

```bash
npx playwright install --with-deps chromium
```

If you are somewhere that cannot download one — a sandbox, a locked-down CI —
point the config at a Chromium you already have:

```bash
CHROMIUM_EXECUTABLE_PATH=/path/to/chrome npm test
```

## Test fixtures are generated, not committed

`tests/.fixtures/` is gitignored and built by `tests/fixtures.ts` before the
suite runs. **Do not commit a binary `.xlsx`, `.docx` or `.pdf`.**

A binary fixture is opaque in review and in diffs: nobody can see from the pull
request whether the spreadsheet has a formula in it, and nobody can change it
later without a copy of Excel. Building them in code keeps the shape being
tested — a resolved formula, a second sheet, a quoted delimiter — readable
right next to the assertions that depend on it. The PDF fixture is written by
hand for the same reason, offsets and all.

If you need a new one, add it to `buildFixtures()`.

## Writing tests

The suite is Playwright, and it runs against a **production build** rather than
the dev server: what is being asserted includes preview budgets and the
client/server split, and dev-mode behaviour differs enough to make those
unreliable.

Two habits that this project has learned the hard way:

- **Assert the outcome, not the mechanism.** A test that blocks a request by
  URL pattern, or reaches for a Tailwind utility class, passes for as long as
  that incidental detail holds and then silently stops testing anything. One
  spec here spent a while comparing a highlighted page against itself because
  its request filter never matched a content-hashed chunk.
- **Poll rather than read once** when you are waiting on the browser to act.
  `keyboard.press` returns when the browser has taken the event, not when it
  has finished acting on it.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), scoped to the
area touched:

```
fix(sheet-viewer): keep column widths while a file is open
feat(pdf): selectable, searchable text over rendered pages
docs: license the project under MIT
```

Say **why** in the body, not what — the diff already says what. If a decision
has a trade-off, the body is where it belongs, so the next person finds it with
`git log` instead of rediscovering it.

## Merging

Pull requests are merged with a **merge commit**. Not squash, not rebase — the
branch's own commits stay reachable in the history.

## Checking the rate limits

The upload action is protected by rate-limit rules in Vercel's firewall, in
front of the application. Nothing in this repository configures them and no
spec can reach them: the suite drives a local server that the firewall never
sees, so the rules could be removed and every test here would stay green.

That gap is covered by hand:

```
scripts/verify-rate-limit.sh https://file-preview.vercel.app
```

or, if you would rather not point a few hundred requests at production from
your own connection, run the **Verify deployment** workflow from the Actions
tab, which does the same thing from a runner.

Run it after changing a rule, and after any change to how the upload action is
called — the rules match on request *shape* (method and content type), so a
change there can walk straight past a rule that still looks correct in the
dashboard.

The script fails in both directions on purpose. A rule that blocks nothing is
caught by the bursts; a rule that blocks everything is caught by the negative
control, which loads the page normally first and fails if that is refused. It
also waits out the window and checks traffic is allowed again, because a block
that never lifts is an outage rather than a limit.

## Adding a format

Two edits, in this order:

1. An entry in `FORMATS` in `lib/formats.ts` — extensions, size cap, and a
   `runtime` of `"client"` or `"server"`.
2. A parser in `lib/adapters/client.ts` or `lib/adapters/server.ts`, keyed by
   the new id, returning one of the existing `Preview` shapes.

Detection, routing, the drop zone chips, size limits and the viewer all follow
from the registry. A genuinely new *kind* of content — an image, say — also
needs a `Preview` variant and a viewer, as PDF did.

Three constraints that are easy to trip over:

- **`lib/formats.ts` must stay free of parsing dependencies.** It is imported
  by both runtimes and by `next.config.ts`; pulling `exceljs` into it drags a
  server-only parser into the browser bundle.
- **Client is the default; server is the exception.** Text formats stay local
  because they can, and that guarantee is the product's whole differentiator.
  A format only goes server-side when its parser is genuinely too heavy to ship
  to the browser. A spec asserts a CSV produces zero network requests and an
  XLSX exactly one, so flipping a `runtime` without meaning to will fail.
- **A server-parsed format cannot be capped above ~4 MB.** The deployment
  rejects larger request bodies at its edge, before any of this code runs.
  Raising a cap past that ceiling fails the build rather than shipping a limit
  the platform will silently override.

## Anything producing HTML

Parser output goes through DOMPurify **in the adapter**, before it reaches
`dangerouslySetInnerHTML` — on the client for Markdown, on the server for Word.
Any new adapter returning `kind: "html"` must do the same; the viewer trusts
what it is given.

`lib/document-html.ts` carries the rest of the document policy in a single
pass: heading ids, stripping relative link and image targets that would
otherwise resolve against our own origin, and a focus stop on code blocks that
can scroll. Add to that pass rather than post-processing in a viewer, so both
adapters get it.

## Accessibility

Every viewer is audited with axe against WCAG A and AA, in both colour schemes,
at a desktop and a phone width, as part of the suite. It is not decoration:
that audit has found an unlabelled file input, unreachable scroll regions,
contrast failures, and a code block no keyboard could scroll.

Automated rules cannot tell whether a control can actually be *operated*, so
new controls need a keyboard path and a spec covering it.
