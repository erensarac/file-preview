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

async function writeDocx(path: string, paragraphs: string) {
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
  zip
    .folder("word")!
    .file(
      "document.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
${paragraphs}
</w:body></w:document>`,
    );
  writeFileSync(path, await zip.generateAsync({ type: "nodebuffer" }));
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

  // A dotfile: the whole name after the leading dot is the extension.
  writeFileSync(at(".env"), "TOKEN=not-a-real-secret\nMODE=preview\n");

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

  await writeDocx(
    at("summary.docx"),
    paragraph("Quarterly Summary", "Heading1") +
      paragraph("This paragraph came out of a real .docx file.") +
      paragraph("Bir de Türkçe satır: şığüöç."),
  );
}
