import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import JSZip from "jszip";

/**
 * Fixtures are generated rather than committed.
 *
 * Binary Office files are opaque in review and in diffs; building them here
 * keeps the *shape* being tested — a resolved formula, a second sheet, a
 * quoted delimiter — readable next to the assertions that depend on it.
 */
export const FIXTURE_DIR = join(process.cwd(), "tests", ".fixtures");

const paragraph = (text: string, style?: string) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}` +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

async function writeDocx(
  path: string,
  paragraphs: string,
  hyperlinks: { id: string; target: string }[] = [],
) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip
    .folder("_rels")!
    .file(
      ".rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    );
  if (hyperlinks.length > 0) {
    zip
      .folder("word")!
      .folder("_rels")!
      .file(
        "document.xml.rels",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${hyperlinks
  .map(
    (link) =>
      `<Relationship Id="${link.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${link.target}" TargetMode="External"/>`,
  )
  .join("\n")}
</Relationships>`,
      );
  }
  zip
    .folder("word")!
    .file(
      "document.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>
${paragraphs}
</w:body></w:document>`,
    );
  writeFileSync(path, await zip.generateAsync({ type: "nodebuffer" }));
}

/**
 * A minimal but genuinely valid multi-page PDF.
 *
 * Written by hand rather than with a library: a PDF is a list of numbered
 * objects followed by a cross-reference table of their byte offsets, so
 * building it here keeps the structure under test visible — and the offsets
 * have to be computed from the real bytes, which is the part a hand-written
 * fixture usually gets wrong.
 */
interface PdfPageSpec {
  text: string;
  /** A4 portrait unless a page says otherwise. */
  width?: number;
  height?: number;
}

function buildPdf(pages: PdfPageSpec[]): Buffer {
  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 4 + index * 2);

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}]` +
    ` /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  pages.forEach((page, index) => {
    const width = page.width ?? 595;
    const height = page.height ?? 842;
    const pageId = pageIds[index]!;
    const contentId = pageId + 1;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}]` +
      ` /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    const stream = `BT /F1 32 Tf 60 ${height - 102} Td (${page.text}) Tj ET`;
    objects[contentId] =
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf +=
    `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}

/**
 * A real PNG, built here rather than committed.
 *
 * Same reasoning as the PDF: a binary fixture is opaque in review, and the
 * thing under test — that the browser decodes it and reports its dimensions —
 * is only meaningful if the dimensions are visible in the source.
 *
 * Truecolour, 8 bits per channel, no interlacing. Each scanline carries a
 * leading filter byte of 0, meaning "stored as-is", which is what keeps this
 * short enough to read.
 */
function buildPng(width: number, height: number): Buffer {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buffer: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = table[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  // Two bands, so the image is visibly not a blank rectangle.
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 3);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const pixel = row + 1 + x * 3;
      const upper = y < height / 2;
      raw[pixel] = upper ? 0xb4 : 0x1c;
      raw[pixel + 1] = upper ? 0x53 : 0x1b;
      raw[pixel + 2] = upper ? 0x1f : 0x19;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** The OLE compound file signature, which is what an encrypted OOXML wears. */
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function oleContainer(streamName: string | null): Buffer {
  // A 512-byte header followed by one sector, which is enough to carry the
  // signature and a directory-style name without pretending to be a valid
  // compound file.
  const buffer = Buffer.alloc(1024);
  buffer.set(OLE_SIGNATURE, 0);
  if (streamName) {
    // Stream names live in the directory as UTF-16LE.
    buffer.write(streamName, 512, "utf16le");
  }
  return buffer;
}

const buildLockedOffice = () => oleContainer("EncryptedPackage");
const buildLegacyOle = () => oleContainer("Workbook");

function buildLockedPdf(): Buffer {
  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
  objects[3] =
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>";
  objects[4] = "<< /Length 0 >>\nstream\n\nendstream";
  const filler = "A".repeat(64);
  objects[5] =
    `<< /Filter /Standard /V 1 /R 2 /O <${filler}> /U <${filler}> /P -1 >>`;

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf +=
    `trailer\n<< /Size ${objects.length} /Root 1 0 R /Encrypt 5 0 R ` +
    `/ID [<${"A".repeat(32)}> <${"A".repeat(32)}>] >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}

export async function buildFixtures(): Promise<void> {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const at = (name: string) => join(FIXTURE_DIR, name);

  // The quoted field must survive as a single cell, not split on its comma.
  writeFileSync(
    at("sales.csv"),
    [
      "Region,Rep,Units,Revenue",
      "Marmara,Ayşe,120,45000",
      "Ege,Mehmet,98,31200",
      'Karadeniz,"Ali, Jr.",67,19800',
    ].join("\n"),
  );

  /*
   * Far past the old 2,000-row cap, and past what fits in the DOM: the viewer
   * mounts only the rows in view, so this is the fixture that tells the
   * difference between "all the rows are there" and "the first screenful is".
   *
   * The needle sits deep enough that it can only be reached by finding it —
   * row 41,000 is about 1.3 MB into the file and thousands of screens down.
   */
  const LARGE_ROWS = 50_000;
  const large = ["Id,City,Amount,Note"];
  for (let row = 1; row <= LARGE_ROWS; row += 1) {
    const city = row === 41_000 ? "Trabzon" : `City ${row % 90}`;
    large.push(`${row},${city},${(row * 7) % 5000},row ${row}`);
  }
  writeFileSync(at("large.csv"), large.join("\n"));

  // Carries an inline <script>: the sanitizer must drop it.
  writeFileSync(
    at("notes.md"),
    `# Release notes\n\nA **bold** claim and a [link](https://example.com).\n\n` +
      `- first item\n- second item\n\n` +
      `<script>window.__pwned = true;</script>\n`,
  );

  writeFileSync(at("config.json"), '{"name":"file","nested":{"a":[1,2,3]}}');

  // Link and image targets of every shape, to pin which survive.
  writeFileSync(
    at("links.md"),
    [
      "# Links",
      "",
      "- [sibling](test.js)",
      "- [nested](./docs/readme.md)",
      "- [parent](../other.txt)",
      "- [rooted](/setup.exe)",
      "- [external](https://example.com/x)",
      "- [mail](mailto:someone@example.com)",
      "- [anchor](#links)",
      "",
      "![local picture](diagram.png)",
      "",
    ].join("\n"),
  );

  // A table of contents pointing at headings that repeat, carry punctuation
  // and are not Latin — the three ways slugging goes wrong.
  writeFileSync(
    at("toc.md"),
    [
      "# Contents",
      "",
      "- [Straight to notes](#notes)",
      "- [The second notes](#notes-1)",
      "- [Turkish heading](#şubat-özeti)",
      "- [Punctuation](#whats-new)",
      "",
      "## Notes",
      "",
      "First set of notes.",
      "",
      "## Şubat Özeti",
      "",
      "Aylık rapor.",
      "",
      "## What's new?",
      "",
      "Some news.",
      "",
      "## Notes",
      "",
      "Second set, same heading text.",
      "",
      `${"Filler to make the page scroll.\n\n".repeat(40)}`,
    ].join("\n"),
  );

  // Fenced blocks in four flavours: a language named the way an extension is,
  // one named the way a grammar is, one nobody has a grammar for, and one the
  // author explicitly asked to leave alone.
  writeFileSync(
    at("guide.md"),
    [
      "# Guide",
      "",
      "```ts",
      'const greeting: string = "hello";',
      "```",
      "",
      "```sql",
      "SELECT id FROM users WHERE active = true;",
      "```",
      "",
      "```nosuchlanguage",
      "this should stay plain",
      "```",
      "",
      "```text",
      "so should this",
      "```",
      "",
    ].join("\n"),
  );

  // A dotfile: the whole name after the leading dot is the extension.
  writeFileSync(at(".env"), "TOKEN=not-a-real-secret\nMODE=preview\n");

  // Two languages with distinct grammars, each containing a keyword, a string
  // and a comment — enough for highlighting to be visible rather than assumed.
  writeFileSync(
    at("query.sql"),
    [
      "-- monthly totals",
      "SELECT region, SUM(revenue) AS total",
      "FROM sales",
      "WHERE region = 'Marmara'",
      "GROUP BY region;",
    ].join("\n"),
  );

  writeFileSync(
    at("widget.tsx"),
    [
      "// a small component",
      'import { useState } from "react";',
      "",
      "export function Widget({ label }: { label: string }) {",
      "  const [count, setCount] = useState(0);",
      "  return <button onClick={() => setCount(count + 1)}>{label}</button>;",
      "}",
    ].join("\n"),
  );

  // No grammar is registered for .log, so it must still open — just uncoloured.
  writeFileSync(
    at("server.log"),
    "2026-07-27 09:00:01 INFO started\n2026-07-27 09:00:02 WARN slow query\n",
  );

  const workbook = new ExcelJS.Workbook();
  const first = workbook.addWorksheet("Q1");
  first.addRow(["Month", "Revenue"]);
  first.addRow(["January", 45000]);
  first.addRow(["February", 51200]);
  // A formula cell: the preview shows the cached result, not the expression.
  first.addRow(["Total", { formula: "SUM(B2:B3)", result: 96200 }]);
  workbook.addWorksheet("Notes").addRow(["Second sheet works"]);
  await workbook.xlsx.writeFile(at("report.xlsx"));

  // Sized past both preview caps at once, to pin the render budget.
  const wide = new ExcelJS.Workbook();
  const sheet = wide.addWorksheet("Wide");
  for (let row = 0; row < 2100; row += 1) {
    sheet.addRow(Array.from({ length: 220 }, (_, col) => `r${row}c${col}`));
  }
  await wide.xlsx.writeFile(at("wide.xlsx"));

  /*
   * A plain archive, including the two things a listing has to survive: an
   * entry named like a path traversal, and a folder entry. Neither is exotic —
   * both come out of ordinary zip tools — and the first is only harmless
   * because nothing resolves it.
   */
  const archive = new JSZip();
  archive.file("readme.txt", "just a file\n");
  archive.folder("docs")!.file("guide.md", "# Guide\n\nsome text\n");
  archive.file("docs/img/logo.txt", "pretend this is a picture\n");
  archive.file("../../etc/passwd", "not actually going anywhere\n");
  archive.file("data/big.csv", "col\n" + "1\n".repeat(4000));
  /*
   * What Finder puts in a zip: a parallel tree with an AppleDouble file per
   * real one, plus the usual .DS_Store. Without filtering, a listing shows
   * every file twice — once real, once as a few hundred bytes of resource
   * fork — which is the complaint this fixture exists to reproduce.
   */
  archive.file("__MACOSX/._readme.txt", "resource fork\n");
  archive.file("__MACOSX/docs/._guide.md", "resource fork\n");
  archive.file("docs/.DS_Store", "finder bookkeeping\n");
  writeFileSync(
    at("bundle.zip"),
    await archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
  );

  /*
   * The pre-2007 format, written by the same library that reads it.
   *
   * Nothing else here can produce one — `exceljs` writes only the modern
   * format — and a committed binary would be exactly the opaque fixture
   * CONTRIBUTING argues against. Round-tripping through one library does not
   * prove compatibility with files Excel itself wrote, and that is worth
   * knowing: what it pins is our own handling, not the format's full surface.
   */
  const legacyBook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    legacyBook,
    XLSX.utils.aoa_to_sheet([
      ["Region", "Units", "Revenue"],
      ["Marmara", 120, 45000],
      ["Ege", 98, 31200],
      ["Karadeniz", 67, 19800],
    ]),
    "Q1",
  );
  XLSX.utils.book_append_sheet(
    legacyBook,
    XLSX.utils.aoa_to_sheet([["Second sheet works"]]),
    "Notes",
  );
  writeFileSync(
    at("ledger.xls"),
    XLSX.write(legacyBook, { type: "buffer", bookType: "biff8" }),
  );

  // The same bytes wearing the modern extension: a file people really do have,
  // and which used to fail with a parser error about a perfectly good file.
  writeFileSync(
    at("misnamed.xlsx"),
    XLSX.write(legacyBook, { type: "buffer", bookType: "biff8" }),
  );

  // A decompression bomb wearing an .xlsx extension: 64 MB of zeros stores in
  // a few tens of KB, so it declares an expansion ratio in the thousands. The
  // guard has to refuse it on the declared sizes alone, without inflating it.
  const bomb = new JSZip();
  bomb.file("[Content_Types].xml", "<Types/>");
  bomb.file("xl/bomb.bin", Buffer.alloc(64 * 1024 * 1024));
  writeFileSync(
    at("bomb.xlsx"),
    await bomb.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
    }),
  );

  // Twelve A4 pages, so pages far down the document are genuinely off screen
  // and the viewer's page-at-a-time rendering can be asserted rather than
  // assumed.
  writeFileSync(
    at("report.pdf"),
    buildPdf(
      Array.from({ length: 12 }, (_, index) => ({
        text: `Page ${index + 1} of 12`,
      })),
    ),
  );

  /*
   * Pages of different sizes in one document — a landscape chart between two
   * portrait pages, which is a routine shape for a report and was rendered
   * squashed because every page was assumed to match page 1.
   */
  writeFileSync(
    at("mixed-sizes.pdf"),
    buildPdf([
      { text: "Portrait one" },
      { text: "Landscape two", width: 842, height: 595 },
      { text: "Portrait three" },
    ]),
  );

  // 200x120 so the reported dimensions are something a test can assert
  // against rather than a square that could match by accident.
  writeFileSync(at("picture.png"), buildPng(200, 120));

  /*
   * An SVG carrying a script and a remote image reference.
   *
   * Both must be inert. The viewer loads an SVG through an `<img>`, where the
   * browser renders it in secure static mode — no script, no external fetch —
   * which is the only reason SVG is an accepted format at all.
   */
  writeFileSync(
    at("diagram.svg"),
    [
      '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90">',
      '  <rect width="160" height="90" fill="#b4531f"/>',
      '  <image href="https://example.com/tracker.png" width="10" height="10"/>',
      "  <script>window.__svgPwned = true;</script>",
      "</svg>",
      "",
    ].join("\n"),
  );

  // A .png that is not a PNG. There is no signature check for images, so this
  // has to be caught by the browser failing to decode it.
  writeFileSync(at("not-really.png"), "this is text, not a picture\n");

  // Right extension, wrong contents — must be rejected on the signature
  // rather than reaching pdf.js and failing as an opaque worker error.
  writeFileSync(at("not-really.pdf"), "just some text, not a PDF\n");

  /*
   * A password-protected PDF.
   *
   * The standard security handler with arbitrary /O and /U strings: pdf.js
   * tries the empty user password, fails to authenticate, and raises the same
   * `PasswordException` a genuinely encrypted document raises. Nothing here is
   * really encrypted — the point under test is the state, not the cipher.
   */
  writeFileSync(at("locked.pdf"), buildLockedPdf());

  /*
   * A password-protected Office file.
   *
   * Synthetic, and worth knowing that: `exceljs` cannot write an encrypted
   * workbook, so this carries the two markers a real one carries rather than
   * being one. An encrypted OOXML file is an OLE compound file — not a zip —
   * whose directory holds a stream called `EncryptedPackage`, and those are
   * exactly what the detector keys on.
   */
  writeFileSync(at("locked.xlsx"), buildLockedOffice());

  // An OLE file with no encrypted stream: a genuine pre-2007 .xls wearing the
  // wrong extension. It must NOT be reported as password-protected.
  writeFileSync(at("legacy.xlsx"), buildLegacyOle());

  // Neither a zip nor an OLE file. The plain "we couldn't read it" case, which
  // has to stay distinct from the locked one.
  writeFileSync(at("broken.xlsx"), "this is not a spreadsheet at all\n");

  // Word carries hyperlinks as relationships, so a relative one has to be
  // built through that machinery to exercise the same path a real file would.
  await writeDocx(
    at("doc-links.docx"),
    `<w:p><w:hyperlink r:id="rel1"><w:r><w:t>local file</w:t></w:r></w:hyperlink></w:p>` +
      `<w:p><w:hyperlink r:id="rel2"><w:r><w:t>real site</w:t></w:r></w:hyperlink></w:p>`,
    [
      { id: "rel1", target: "attachment.xlsx" },
      { id: "rel2", target: "https://example.com/x" },
    ],
  );

  await writeDocx(
    at("summary.docx"),
    paragraph("Quarterly Summary", "Heading1") +
      paragraph("This paragraph came out of a real .docx file.") +
      paragraph("Bir de Türkçe satır: şığüöç."),
  );
}
