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

## The deployment checks itself after every release

`Verify deployment` runs an Office upload against production whenever the
platform reports a successful deployment of `main`. It exists because of a
release where **no Office file could be opened at all** — the suite green, the
platform answering 200, and nobody the wiser until someone pushed a real file
at the real deployment by hand.

That failure could not have been caught locally. The parsers live in a child
process spawned by path, so the bundler never reads it, and the deployment
shipped the child script without them. A dev server has all of `node_modules`
sitting beside it and cannot tell the difference; `tests/tracing.spec.ts` reads
the build's trace manifest for exactly this reason, and the upload check is the
backstop for whatever that spec does not think to look at.

**If it goes red, the deployment is broken for users right now.** It is not a
flaky end-to-end test to re-run — it drives a browser against production and
asserts a fixture's own value appears on screen.

## Checking the rate limits

Both things a caller can reach — uploading a file and reporting a browser-side
failure — are protected by **one** rate-limit rule in Vercel's firewall, in
front of the application: 30 POST requests per minute from one IP address. They
share a counter because the account's plan allows a single custom rule; the
README says why that is a compromise rather than a design.

Nothing in this repository configures the rule and no spec can reach it: the
suite drives a local server that the firewall never sees, so the rule could be
removed and every test here would stay green.

That gap is covered by hand:

```
scripts/verify-rate-limit.sh https://file-preview.vercel.app
```

or, if you would rather not point a few hundred requests at production from
your own connection, run the **Verify deployment** workflow from the Actions
tab, which does the same thing from a runner.

It takes the limits as optional arguments and defaults to the rule as
deployed. Pass them only when checking a rule you have changed but not yet
published — a default that disagrees with the dashboard is a run that reports
confidently about a threshold nobody set.

Run it after changing the rule, and after any change to how either endpoint is
called — the rule matches on request *shape* (method and content type), so a
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
from the registry. A genuinely new *kind* of content also needs a `Preview`
variant and a viewer, as PDF and images each did.

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
- **The README's runtime table has to name it.** A spec checks that table
  against the registry, so a format missing from it — or listed under the wrong
  runtime — fails CI. That table is how the project explains itself, and it had
  quietly stopped being true once already, which is why it is enforced rather
  than trusted.

## Server actions, and one thing that will refuse yours

The file is `proxy.ts`, not `middleware.ts`: Next 16.3 deprecated that
convention and warns about it at build time. The rename is the whole of the
difference — a convention that is wrong about the name simply never runs, and
a guard that never runs looks exactly like one that passes, which is why the
specs that drive it matter more than the file's name does.

`proxy.ts` answers **405** to a `multipart/form-data` POST that carries no
`Next-Action` header. That exists because the framework decodes such a request
as an action submission and throws when it cannot find one, answering 500 to a
request anyone could send — a server error, in the log where real regressions
are meant to be visible.

The consequence for a contributor: **a `<form action={…}>` that submits without
JavaScript would be refused by it.** Progressive enhancement carries the action
id in the body rather than a header, which is precisely the shape being
rejected. There is no such form here today; adding one means teaching that
check about it first, and the spec named `a real upload is unaffected` is what
will tell you it needs teaching.

## The SheetJS dependency is not from npm

`package.json` names a tarball URL:

```
"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
```

That is deliberate, not an accident of someone's local install. The `xlsx`
package on npm has been frozen since March 2022 and carries two high-severity
advisories whose fixes were never published there; the maintained builds exist
only on the vendor's CDN. The lockfile pins the tarball's integrity hash, so
installs verify what they fetch.

Two consequences for you:

- **Builds need `cdn.sheetjs.com` reachable.** If it is blocked or down, `npm
  ci` fails rather than degrading. A sandbox without egress to it cannot
  install this project.
- **Do not "fix" it by pointing at the registry.** `xlsx@0.18.5` installs
  cleanly and is four years of unfixed parser bugs behind, on code that reads
  untrusted files on the server.

If the dependency ever needs to change, the version must be bumped in both
`package.json` and the lockfile entry, integrity hash included — and that hash
can only be produced by fetching the tarball once.

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
