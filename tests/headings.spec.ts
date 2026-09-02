import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { slugify } from "@/lib/document-html";
import { FIXTURE_DIR } from "./fixtures";

const fixture = (name: string) => join(FIXTURE_DIR, name);

test("slugs follow the rule links were written against", () => {
  // GitHub's rule, deliberately: a table of contents in a README was written
  // against that rendering, and a different rule would break every such link.
  expect(slugify("Notes")).toBe("notes");
  expect(slugify("What's new?")).toBe("whats-new");
  expect(slugify("  Trailing space  ")).toBe("trailing-space");
  expect(slugify("Multiple   spaces")).toBe("multiple-spaces");
  expect(slugify("Already-hyphenated")).toBe("already-hyphenated");

  // Letters are matched by Unicode property, not a-z, or every non-Latin
  // heading would collapse to nothing and share one id.
  expect(slugify("Şubat Özeti")).toBe("şubat-özeti");
  expect(slugify("Ağustos")).toBe("ağustos");

  // A heading of pure punctuation still needs something to link to.
  expect(slugify("!!!")).toBe("section");
});

test.describe("in-document anchors", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', fixture("toc.md"));
    await expect(
      page.getByRole("heading", { name: "Contents", exact: true }),
    ).toBeVisible();
  });

  test("headings carry ids, and repeats are distinguished", async ({
    page,
  }) => {
    const ids = await page.evaluate(() =>
      [...document.querySelectorAll(".rendered-doc h1, .rendered-doc h2")].map(
        (heading) => heading.id,
      ),
    );

    // Two headings read "Notes"; the second takes a suffix in document order,
    // which is the only scheme where a link written against the rendering
    // keeps working.
    expect(ids).toEqual([
      "contents",
      "notes",
      "şubat-özeti",
      "whats-new",
      "notes-1",
    ]);
  });

  test("clicking an anchor scrolls to its heading", async ({ page }) => {
    const heading = page.getByRole("heading", { name: "Şubat Özeti" });

    // Out of view to begin with, or the assertion below proves nothing.
    expect(await heading.evaluate((element) => element.getBoundingClientRect().top))
      .toBeGreaterThan(0);

    await page.getByRole("link", { name: "Turkish heading" }).click();
    await expect(heading).toBeInViewport();
  });

  test("a link to the second of two identical headings lands on the second", async ({
    page,
  }) => {
    await page.getByRole("link", { name: "The second notes" }).click();

    const target = page.locator("#notes-1");
    await expect(target).toBeInViewport();
    await expect(target).toHaveText("Notes");
    // The paragraph after it is what tells the two apart.
    await expect(page.getByText("Second set, same heading text.")).toBeVisible();
  });

  test("anchors are still left live by the unreachable-target pass", async ({
    page,
  }) => {
    // #13 strips relative hrefs; same-document anchors must survive it, or
    // this feature has nothing to click.
    await expect(
      page.getByRole("link", { name: "Straight to notes" }),
    ).toHaveAttribute("href", "#notes");
  });
});
