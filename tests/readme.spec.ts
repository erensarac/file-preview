import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { FORMATS } from "@/lib/formats";
import { LANDING_PAGES } from "@/lib/landing";

/**
 * The README's runtime table, checked against the registry it describes.
 *
 * That table is the first thing the README calls "the one design decision
 * everything else follows from", and it had quietly stopped being true: images
 * were added as a client format, with eight extensions and a section of their
 * own further down, and the table still listed six formats. It contradicted
 * its own document, and the only way to notice was to read both halves and
 * compare them by hand.
 *
 * Prose cannot be tested in general. This particular sentence can, because it
 * is a claim about a data structure sitting in the same repository — the same
 * reason a spec already asserts every landing page names a format the registry
 * knows.
 *
 * It checks presence in the right row, and absence from the wrong one, so a
 * format that changes runtime is caught as surely as one that is added. The
 * matching is deliberately loose about case and plurals and nothing else:
 * prose should be free to say "images" where the registry says "Image",
 * without being free to omit it.
 */

const README = readFileSync(join(process.cwd(), "README.md"), "utf8");

function runtimeRow(runtime: string): string {
  const row = README.split("\n").find((line) =>
    line.startsWith(`| \`${runtime}\``),
  );
  expect(row, `the README has no \`${runtime}\` row in its runtime table`).toBeTruthy();
  return row!;
}

test.describe("the README's runtime table", () => {
  const rows = {
    client: runtimeRow("client"),
    server: runtimeRow("server"),
  };

  for (const format of FORMATS) {
    test(`lists ${format.label} under ${format.runtime}`, () => {
      // Optional trailing "s" so the prose may pluralise; word boundaries so
      // "TSV" is not found inside some longer token.
      const mentioned = new RegExp(`\\b${format.label}s?\\b`, "i");
      const other = format.runtime === "client" ? "server" : "client";

      expect(
        rows[format.runtime],
        `${format.label} is missing from the ${format.runtime} row`,
      ).toMatch(mentioned);

      expect(
        rows[other],
        `${format.label} is listed as ${other}, but the registry says ${format.runtime}`,
      ).not.toMatch(mentioned);
    });
  }

  /**
   * The sentence under the table counts the split. A number in prose is the
   * first thing to rot, and this one is cheap to keep honest.
   */
  test("counts the split correctly", () => {
    const client = FORMATS.filter((f) => f.runtime === "client").length;
    const claim = README.match(
      /(\w+) of the (\w+) formats never leave the device/,
    );
    expect(claim, "the sentence counting the split is gone").toBeTruthy();

    const words = ["zero", "one", "two", "three", "four", "five", "six",
      "seven", "eight", "nine", "ten", "eleven", "twelve"];
    expect(claim![1]!.toLowerCase()).toBe(words[client]);
    expect(claim![2]!.toLowerCase()).toBe(words[FORMATS.length]);
  });
});

/**
 * The landing pages are counted in prose too, and that count was wrong: the
 * README said "one page per format" while six of the nine had one. The spec
 * that already existed could not catch it, because it checks that every page
 * names a known format — the direction that was never the problem.
 *
 * The reverse cannot be asserted directly: not every format is *meant* to have
 * a page. So the number is what gets checked, which is the thing that was
 * actually false.
 */
test("the README counts the landing pages correctly", () => {
  const claim = README.match(/a page for (\w+) of the (\w+)\s+formats/);
  expect(claim, "the sentence counting the landing pages is gone").toBeTruthy();

  const words = ["zero", "one", "two", "three", "four", "five", "six",
    "seven", "eight", "nine", "ten", "eleven", "twelve"];
  expect(claim![1]!.toLowerCase()).toBe(words[LANDING_PAGES.length]);
  expect(claim![2]!.toLowerCase()).toBe(words[FORMATS.length]);
});
