/**
 * Copies pdf.js's runtime data into `public/` so the browser can fetch it.
 *
 * pdf.js does not bundle these. Without the standard fonts, any PDF using one
 * of the fourteen base fonts renders with missing text; without the CMaps,
 * CJK documents do the same. They are copied rather than committed because
 * they belong to the installed version of the library and would otherwise
 * drift from it silently.
 */

import { copyFileSync, cpSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve("pdfjs-dist/package.json"));
const target = join(process.cwd(), "public", "pdfjs");

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

for (const asset of ["standard_fonts", "cmaps"]) {
  cpSync(join(pdfjsRoot, asset), join(target, asset), { recursive: true });
}

// The worker is served from here too, rather than resolved through the
// bundler: `new URL(<bare specifier>, import.meta.url)` is not something every
// bundler rewrites, and getting it wrong fails as a 404 at runtime instead of
// at build time.
copyFileSync(
  join(pdfjsRoot, "legacy", "build", "pdf.worker.min.mjs"),
  join(target, "pdf.worker.min.mjs"),
);

console.log(`pdf.js assets copied to ${target}`);
