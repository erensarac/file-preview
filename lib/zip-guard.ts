/**
 * Decompression-bomb guard for the zip-based Office formats.
 *
 * The registry's `maxBytes` bounds the *compressed* upload, and the adapters
 * bound what a parse is allowed to *produce* — but between those two sits the
 * parsing library, which happily expands an archive into memory before either
 * limit gets a say. A few hundred KB of well-crafted zip can become gigabytes.
 *
 * So this reads the archive's own bookkeeping instead of its contents. A zip
 * central directory records the compressed and uncompressed size of every
 * entry, which is exactly what's needed to spot an implausible expansion —
 * and reading it decompresses nothing.
 *
 * A hostile archive can of course lie in those headers. That's fine: the
 * declared sizes are what the parser trusts when it allocates, so a lie that
 * gets past this check is a lie that also makes the parser behave. The check
 * is about refusing work, not about establishing truth.
 */

/** Entry count beyond what any real spreadsheet or document needs. */
const MAX_ENTRIES = 2_000;
/** Absolute ceiling on the expanded archive. */
const MAX_UNCOMPRESSED_BYTES = 250 * 1024 * 1024;
/**
 * Expansion ratio ceiling. Office XML is repetitive and compresses well: the
 * worst case across this project's fixtures is 9x (a 2.95 MB workbook
 * declaring 26.6 MB expanded). This leaves more than an order of magnitude of
 * headroom, so it should only ever trip on something built to trip it.
 */
const MAX_RATIO = 200;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;
const EOCD_MIN_SIZE = 22;
const CENTRAL_FILE_HEADER_SIZE = 46;
/** A zip comment can be up to 64 KiB, so the EOCD isn't always at the very end. */
const MAX_COMMENT_SIZE = 0xffff;
/** Sentinel meaning "the real value lives in a zip64 extra field". */
const ZIP64_SENTINEL = 0xffffffff;

export interface ZipReport {
  entries: number;
  compressedBytes: number;
  uncompressedBytes: number;
  /** Expanded ÷ stored. `Infinity` when the archive claims to store nothing. */
  ratio: number;
}

export class NotAZipError extends Error {}
export class ZipBombError extends Error {}

function findEndOfCentralDirectory(view: DataView): number {
  const from = Math.max(0, view.byteLength - EOCD_MIN_SIZE - MAX_COMMENT_SIZE);
  // The signature can legitimately appear inside the comment, so scan backwards
  // and take the last plausible one.
  for (let at = view.byteLength - EOCD_MIN_SIZE; at >= from; at -= 1) {
    if (view.getUint32(at, true) === EOCD_SIGNATURE) return at;
  }
  throw new NotAZipError("No end-of-central-directory record found");
}

/**
 * Sums the sizes every entry declares, without inflating any of them.
 */
export function inspectZip(bytes: Uint8Array): ZipReport {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < EOCD_MIN_SIZE) {
    throw new NotAZipError("Too small to be a zip archive");
  }

  const eocd = findEndOfCentralDirectory(view);
  const entries = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);

  if (entries === 0xffff || at === ZIP64_SENTINEL) {
    // zip64. No legitimate .xlsx or .docx we accept comes close to needing it.
    throw new ZipBombError("Zip64 archives are not supported");
  }

  let compressedBytes = 0;
  let uncompressedBytes = 0;

  for (let index = 0; index < entries; index += 1) {
    if (at + CENTRAL_FILE_HEADER_SIZE > view.byteLength) {
      throw new NotAZipError("Central directory runs past the end of the file");
    }
    if (view.getUint32(at, true) !== CENTRAL_FILE_SIGNATURE) {
      throw new NotAZipError("Malformed central directory entry");
    }

    const compressed = view.getUint32(at + 20, true);
    const uncompressed = view.getUint32(at + 24, true);
    if (compressed === ZIP64_SENTINEL || uncompressed === ZIP64_SENTINEL) {
      throw new ZipBombError("Zip64 archives are not supported");
    }

    compressedBytes += compressed;
    uncompressedBytes += uncompressed;

    at +=
      CENTRAL_FILE_HEADER_SIZE +
      view.getUint16(at + 28, true) + // file name
      view.getUint16(at + 30, true) + // extra field
      view.getUint16(at + 32, true); // comment
  }

  return {
    entries,
    compressedBytes,
    uncompressedBytes,
    ratio: compressedBytes === 0 ? Infinity : uncompressedBytes / compressedBytes,
  };
}

/**
 * Throws `ZipBombError` when an archive declares an expansion we refuse to
 * perform. Returns the report so callers can log or surface the numbers.
 */
export function assertSafeArchive(bytes: Uint8Array): ZipReport {
  const report = inspectZip(bytes);

  if (report.entries > MAX_ENTRIES) {
    throw new ZipBombError(
      `Archive declares ${report.entries} entries (limit ${MAX_ENTRIES})`,
    );
  }
  if (report.uncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
    throw new ZipBombError(
      `Archive expands to ${report.uncompressedBytes} bytes (limit ${MAX_UNCOMPRESSED_BYTES})`,
    );
  }
  if (report.ratio > MAX_RATIO) {
    throw new ZipBombError(
      `Archive expands ${report.ratio.toFixed(0)}x (limit ${MAX_RATIO}x)`,
    );
  }

  return report;
}
