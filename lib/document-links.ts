/**
 * Neutralises links and images that point at nothing.
 *
 * A previewed document is not hosted anywhere. A relative href in it — `test.js`,
 * `./docs/readme.md`, `/admin` — refers to a file that sat next to the original
 * on someone's disk, which we have no access to and never will. Rendered as a
 * live link, the browser resolves it against *our* origin, so it navigates away
 * from the preview to a 404 on this domain.
 *
 * That is worse than a dead link. Nothing is stored here, so following one
 * loses the file the reader had open, and a document can make this site appear
 * to offer whatever it likes: `[Download the installer](/setup.exe)` renders as
 * a link to our own hostname.
 *
 * So relative targets are stripped and marked, rather than left to mislead.
 * Absolute `http(s)` links are real and left alone, and same-document anchors
 * are left alone too: they go nowhere useful today, but they neither leave the
 * page nor borrow the domain.
 */

/** Anything DOMPurify has already let through that genuinely resolves elsewhere. */
function pointsSomewhereReal(url: string): boolean {
  return /^(https?:|mailto:|tel:)/i.test(url.trim());
}

function isSameDocumentAnchor(url: string): boolean {
  return url.trim().startsWith("#");
}

/**
 * Registers the pass on a DOMPurify instance.
 *
 * Done as a sanitizer hook rather than a separate DOM walk because both
 * adapters already sanitize, and this is the same job — deciding what the
 * document is allowed to claim. It also means the neutralising happens before
 * the HTML ever reaches the page, rather than after a moment of live links.
 */
export function neutraliseUnreachableTargets(purifier: {
  addHook: (
    entryPoint: "afterSanitizeAttributes",
    hook: (node: Element) => void,
  ) => void;
}): void {
  purifier.addHook("afterSanitizeAttributes", (node) => {
    const href = node.getAttribute?.("href");
    if (
      href !== null &&
      href !== undefined &&
      !pointsSomewhereReal(href) &&
      !isSameDocumentAnchor(href)
    ) {
      node.removeAttribute("href");
      // Kept so the reader can see what the author meant to link to.
      node.setAttribute("data-unreachable", href);
      node.setAttribute("title", `Not available in a preview: ${href}`);
    }

    const src = node.getAttribute?.("src");
    if (src !== null && src !== undefined && !pointsSomewhereReal(src)) {
      // Stripping the src alone would leave an <img> the browser draws as a
      // broken-image icon, which reads as a failure rather than a deliberate
      // omission. Replacing it with a span leaves the alt text in a plain box.
      const replacement = node.ownerDocument.createElement("span");
      replacement.setAttribute("data-unreachable", src);
      replacement.setAttribute(
        "title",
        `Image not available in a preview: ${src}`,
      );
      replacement.textContent =
        node.getAttribute("alt")?.trim() || "Image not available";
      node.replaceWith(replacement);
    }
  });
}
