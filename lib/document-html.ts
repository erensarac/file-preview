/**
 * Everything that happens to a parsed document's HTML before it is rendered.
 *
 * Markdown and Word both end up here, and both are untrusted input about to be
 * put into our own origin — so sanitizing, neutralising unreachable targets and
 * slugging headings are one pass rather than three. Doing it at sanitize time
 * also means the page never briefly holds live links to nowhere.
 *
 * The hooks are registered around a single call rather than once at module
 * load, because heading ids need document-wide state: two headings called
 * "Notes" have to end up with different ids, which a stateless per-node hook
 * cannot arrange.
 */

/** The DOMPurify surface this module uses, structurally typed. */
interface Purifier {
  addHook: (
    entryPoint: "afterSanitizeAttributes",
    hook: (node: Element) => void,
  ) => void;
  removeHook: (entryPoint: "afterSanitizeAttributes") => unknown;
  sanitize: (html: string) => string;
}

/** Anything DOMPurify has already let through that genuinely resolves elsewhere. */
function pointsSomewhereReal(url: string): boolean {
  return /^(https?:|mailto:|tel:)/i.test(url.trim());
}

function isSameDocumentAnchor(url: string): boolean {
  return url.trim().startsWith("#");
}

/**
 * The slug an author would expect.
 *
 * Deliberately GitHub's rule — lowercase, drop punctuation, spaces to hyphens
 * — because that is what a table of contents in a README was written against.
 * A different rule would be defensible in isolation and would break every link
 * already out there.
 *
 * Letters are matched by Unicode property rather than `a-z`, so "Şubat Özeti"
 * becomes `şubat-özeti` instead of collapsing to nothing.
 */
export function slugify(text: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");

  // A heading of only punctuation still needs something to link to.
  return slug || "section";
}

/**
 * Hands out ids, keeping them unique within one document.
 *
 * Repeats get a numeric suffix in document order, which is both what GitHub
 * does and the only scheme where a link written against the rendered output
 * keeps working.
 */
function createSlugger(): (text: string) => string {
  const seen = new Map<string, number>();

  return (text) => {
    const base = slugify(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}

const HEADINGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);

/**
 * Sanitizes a parsed document and applies this project's document policy.
 *
 * - Untrusted markup is removed by DOMPurify, which is what makes the result
 *   safe to hand to `dangerouslySetInnerHTML`.
 * - Link and image targets that only existed next to the original file are
 *   stripped. A previewed document is not hosted anywhere, so a relative href
 *   resolves against *our* origin: it navigates away from the preview, loses
 *   the open file, and lets a document make this site appear to offer whatever
 *   it names. Absolute and same-document targets are left alone.
 * - Headings get ids, so a document's own table of contents works.
 */
export function sanitizeDocumentHtml(purifier: Purifier, html: string): string {
  const nextId = createSlugger();

  purifier.addHook("afterSanitizeAttributes", (node) => {
    if (HEADINGS.has(node.tagName) && !node.hasAttribute("id")) {
      node.setAttribute("id", nextId(node.textContent ?? ""));
    }

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

  try {
    return purifier.sanitize(html);
  } finally {
    // The hook closes over this document's slugger, so it must not outlive the
    // call — the next document would inherit its used-id list.
    purifier.removeHook("afterSanitizeAttributes");
  }
}
