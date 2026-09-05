import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

/**
 * What the deployment will actually contain.
 *
 * The Office parsers run in a plain `.mjs` spawned by path, which is what lets
 * a parse be stopped — and it means the bundler never reads that file. So
 * nothing told the tracer that `exceljs`, `mammoth` and `xlsx` were needed:
 * `next.config.ts` copied the child script into the output and left its
 * parsers behind.
 *
 * Every local test passed. Production accepted the upload, answered 200, and
 * told people their spreadsheet might be corrupt — for as long as nobody had
 * uploaded one to the real thing.
 *
 * This reads the build's own manifest of traced files, so the check happens
 * against the artefact that gets deployed rather than against a running server
 * that has all of `node_modules` sitting next to it.
 */

function traceFiles(directory: string): string[] {
  const found: string[] = [];
  const walk = (at: string) => {
    for (const entry of readdirSync(at)) {
      const path = join(at, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith(".nft.json")) found.push(path);
    }
  };
  walk(directory);
  return found;
}

test.describe("the deployed output", () => {
  const traces = traceFiles(join(process.cwd(), ".next", "server"));
  const everything = traces.map((path) => readFileSync(path, "utf8")).join("\n");

  test("has traces to read at all", () => {
    // Guards the rest: if the build layout changes, these assertions would
    // otherwise pass by finding nothing to contradict them.
    expect(traces.length).toBeGreaterThan(0);
  });

  test("carries the child script the parsers run in", () => {
    // Nothing imports it, so only `outputFileTracingIncludes` puts it there.
    expect(everything).toContain("parse-child.mjs");
  });

  for (const parser of ["exceljs", "mammoth", "xlsx"]) {
    test(`carries ${parser}, which only the child imports`, () => {
      // Copying the child is not enough: a file the tracer never reads takes
      // its dependencies with it into nothing.
      expect(everything).toContain(`node_modules/${parser}/`);
    });
  }
});
