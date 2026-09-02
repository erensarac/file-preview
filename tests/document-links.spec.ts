import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { FIXTURE_DIR } from "./fixtures";

const fixture = (name: string) => join(FIXTURE_DIR, name);

const link = (page: Page, text: string) =>
  page.locator(".rendered-doc a", { hasText: text });

test.describe("targets that do not exist outside the original file", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', fixture("links.md"));
    await expect(
      page.getByRole("heading", { name: "Links", exact: true }),
    ).toBeVisible();
  });

  for (const [name, target] of [
    ["sibling", "test.js"],
    ["nested", "./docs/readme.md"],
    ["parent", "../other.txt"],
    ["rooted", "/setup.exe"],
  ] as const) {
    test(`a ${name} link is not clickable`, async ({ page }) => {
      const anchor = link(page, name);

      // The text stays — the reader can still see what was linked.
      await expect(anchor).toBeVisible();
      await expect(anchor).not.toHaveAttribute("href", /./);
      // …and what it pointed at, without it being live.
      await expect(anchor).toHaveAttribute("data-unreachable", target);
    });
  }

  test("absolute links still work", async ({ page }) => {
    await expect(link(page, "external")).toHaveAttribute(
      "href",
      "https://example.com/x",
    );
    await expect(link(page, "mail")).toHaveAttribute(
      "href",
      "mailto:someone@example.com",
    );
  });

  test("same-document anchors are left alone", async ({ page }) => {
    // They go nowhere useful yet, but they neither navigate away from the
    // preview nor borrow this site's hostname.
    await expect(link(page, "anchor")).toHaveAttribute("href", "#links");
  });

  test("a relative image is not requested from our origin", async ({
    page,
  }) => {
    const requested: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "image") requested.push(request.url());
    });

    // Not an <img> any more: one with no src draws as a broken-image icon,
    // which reads as a failure rather than something deliberately withheld.
    await expect(page.locator(".rendered-doc img")).toHaveCount(0);

    const placeholder = page.locator(".rendered-doc span[data-unreachable]");
    await expect(placeholder).toHaveAttribute("data-unreachable", "diagram.png");
    // The alt text is what remains, and nothing 404s against this domain.
    await expect(placeholder).toHaveText("local picture");
    expect(requested).toEqual([]);
  });

  test("clicking one does not leave the preview", async ({ page }) => {
    const before = page.url();
    await link(page, "sibling").click();

    // The whole point: the file stays open instead of being lost to a 404.
    expect(page.url()).toBe(before);
    await expect(
      page.getByRole("heading", { name: "Links", exact: true }),
    ).toBeVisible();
  });
});

test("Word documents get the same treatment", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', fixture("doc-links.docx"));
  await expect(page.getByText("local file")).toBeVisible();

  // Word stores hyperlinks as relationships, a different path from Markdown's
  // inline syntax, so the rule has to hold on both or it holds on neither.
  await expect(link(page, "local file")).toHaveAttribute(
    "data-unreachable",
    "attachment.xlsx",
  );
  await expect(link(page, "local file")).not.toHaveAttribute("href", /./);
  await expect(link(page, "real site")).toHaveAttribute(
    "href",
    "https://example.com/x",
  );
});
