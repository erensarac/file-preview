import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import ExcelJS from "exceljs";
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
function buildPdf(pageTexts: string[]): Buffer {
  const objects: string[] = [];
  const pageIds = pageTexts.map((_, index) => 4 + index * 2);

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}]` +
    ` /Count ${pageTexts.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  pageTexts.forEach((text, index) => {
    const pageId = pageIds[index]!;
    const contentId = pageId + 1;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842]` +
      ` /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    const stream = `BT /F1 32 Tf 60 740 Td (${text}) Tj ET`;
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
      Array.from({ length: 12 }, (_, index) => `Page ${index + 1} of 12`),
    ),
  );

  // Right extension, wrong contents — must be rejected on the signature
  // rather than reaching pdf.js and failing as an opaque worker error.
  writeFileSync(at("not-really.pdf"), "just some text, not a PDF\n");

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
