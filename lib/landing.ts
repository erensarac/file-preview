/**
 * The per-format landing pages.
 *
 * People do not search for "file preview" — they search for "open xlsx online"
 * or "view a docx without Word". A page per format *named in a search* is how
 * those find this, and each needs its own title, description and copy to be
 * worth indexing separately rather than reading as the same page repeated.
 *
 * Not every format earns one. TSV shares the CSV viewer and is looked for as a
 * spreadsheet rather than by name, and nobody searches for a plain-text
 * viewer — a page for either would compete with the ones here while answering
 * nothing new.
 *
 * Kept apart from `lib/formats.ts` on purpose: that registry describes how
 * files are parsed and is imported by both runtimes, and prose has no business
 * riding along with it. A spec asserts every landing page names a format the
 * registry actually knows, so the two cannot drift.
 */

import type { FormatId } from "./formats";

export interface LandingPage {
  /** URL segment. Chosen to match how the format is searched for. */
  slug: string;
  formatId: FormatId;
  /** Browser and search-result title. */
  title: string;
  /** Meta description. One sentence, written for a search result. */
  description: string;
  headline: string;
  /** Two or three short paragraphs. Plain claims, no marketing. */
  body: string[];
}

export const LANDING_PAGES: readonly LandingPage[] = [
  {
    slug: "excel-viewer",
    formatId: "xlsx",
    title: "Excel viewer — open XLSX files online",
    description:
      "Open an .xlsx or .xlsm spreadsheet in your browser. Formulas show their computed values, every sheet is available, and nothing is stored.",
    headline: "Open an Excel file without Excel",
    body: [
      "Drop an .xlsx or .xlsm file below and it opens straight away. Each sheet gets its own tab, formula cells show the value Excel last computed, and columns can be resized or double-clicked to fit.",
      "The file is converted on the server because the spreadsheet parser is far too heavy to send to your browser. It is held in memory for the length of that one request and then discarded — nothing is written to disk and nothing is kept.",
    ],
  },
  {
    slug: "word-viewer",
    formatId: "docx",
    title: "Word viewer — open DOCX files online",
    description:
      "Open a .docx document in your browser. Headings, lists and tables come through; nothing is stored.",
    headline: "Open a Word document without Word",
    body: [
      "Drop a .docx file below to read it. Headings, lists, tables and links come through as text you can select and search with your browser.",
      "What does not come through is exact page layout — columns, text boxes and page geometry are not reproduced. This shows you what a document says, not what it would look like printed.",
      "The file is converted on the server, held in memory for that request, and discarded.",
    ],
  },
  {
    slug: "pdf-viewer",
    formatId: "pdf",
    title: "PDF viewer — open PDF files in your browser",
    description:
      "Open a PDF without uploading it. Pages are rendered in your browser, so the file never leaves your device.",
    headline: "Read a PDF without uploading it",
    body: [
      "Drop a PDF below to read it, page by page, with zoom. Pages are drawn only as you reach them, so a long document opens as quickly as a short one.",
      "This one runs entirely in your browser. The file is never sent anywhere — not to us, not to anyone — which matters more for PDFs than for most formats, because they are so often contracts, statements and scans.",
    ],
  },
  {
    slug: "csv-viewer",
    formatId: "csv",
    title: "CSV viewer — open CSV files online",
    description:
      "Open a CSV in your browser as a proper table. Quoted commas stay in one cell, and the file is never uploaded.",
    headline: "Read a CSV as a table, not as text",
    body: [
      "Drop a .csv or .tsv file below to see it as a grid with row numbers and resizable columns. Quoted fields are parsed properly, so a comma inside a value stays in its cell instead of splitting the row.",
      "The file is read in your browser and never uploaded. You can check that yourself: open your browser's network tab and watch nothing happen.",
    ],
  },
  {
    slug: "markdown-preview",
    formatId: "markdown",
    title: "Markdown preview — render .md files online",
    description:
      "Render a Markdown file in your browser, with syntax-highlighted code blocks. The file is never uploaded.",
    headline: "See what your Markdown looks like",
    body: [
      "Drop a .md file below to see it rendered — headings, lists, tables, links, and code blocks coloured by language.",
      "The file is read in your browser and never uploaded. Anything it contains that would run as script is removed before rendering.",
    ],
  },
  {
    slug: "json-viewer",
    formatId: "json",
    title: "JSON viewer — format and read JSON online",
    description:
      "Open a JSON file in your browser, pretty-printed with syntax colouring. Never uploaded.",
    headline: "Read JSON that arrived on one line",
    body: [
      "Drop a .json file below and it comes back indented, coloured and numbered, whatever shape it arrived in. A file that is not valid JSON still opens — it shows you the raw text and says what went wrong.",
      "The file is read in your browser and never uploaded, which is worth knowing when the JSON is an API response with credentials in it.",
    ],
  },
  {
    slug: "image-viewer",
    formatId: "image",
    title: "Image viewer — open WebP, AVIF and SVG files online",
    description:
      "Open a PNG, JPG, WebP, AVIF, GIF, BMP or SVG in your browser. Zoom and fit, real dimensions, and the file never leaves your device.",
    headline: "Open an image your photo app won't",
    body: [
      "Drop a PNG, JPG, WebP, AVIF, GIF, BMP or SVG below. It opens at the size that fits the window, zooms in steps, and shows its real dimensions. Nothing is uploaded — your browser decodes it here, on your device.",
      "That the browser does the decoding is also the honest limit of this page: an image your browser cannot read, this cannot read either. It helps when the thing that failed is your system's photo viewer rather than your browser, which is how most people meet WebP and AVIF for the first time.",
      "An SVG is rendered as a picture rather than placed into the page. That is a safety boundary rather than a styling choice — an SVG is a document, and it can carry script and pull in remote files. Opening it this way means the browser runs neither.",
      "HEIC is not supported, and that is deliberate. No browser can decode it, so supporting it would mean shipping a decoder just to open a holiday photo — the weight this site exists to avoid.",
    ],
  },
] as const;

export function landingPageBySlug(slug: string): LandingPage | undefined {
  return LANDING_PAGES.find((page) => page.slug === slug);
}
