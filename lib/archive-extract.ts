import type { ArchiveEntry } from "./preview";

/**
 * Reading one file out of an archive.
 *
 * Everything about the listing was built on not decompressing anything: the
 * bomb guard reads an archive's own bookkeeping precisely so that a hostile
 * file is refused before a parser allocates. Opening an entry gives that up on
 * purpose, for one entry, at a person's explicit request — so the bound moves
 * from *what the archive claims* to *what actually arrives*.
 *
 * That distinction is the whole of the safety argument here. A zip may declare
 * ten kilobytes and expand to ten gigabytes; the declared size is a claim by
 * the same file that would benefit from lying. So the declared size is used
 * only to refuse early, and the real ceiling is counted from the bytes coming
 * out of the decompressor, which stops the moment it is passed.
 *
 * No new dependency: `DecompressionStream("deflate-raw")` is the browser's own
 * inflate, and "deflate-raw" rather than "deflate" because a zip stores the
 * compressed data without a zlib wrapper.
 */

/** Local file header: "PK\x03\x04". */
const LOCAL_SIGNATURE = 0x04034b50;
const LOCAL_HEADER_SIZE = 30;

/** Stored, and deflated. Everything else is a format we do not read. */
const STORED = 0;
const DEFLATED = 8;

export class EntryTooLargeError extends Error {}
export class EntryUnreadableError extends Error {}

/**
 * The most any single entry may expand to.
 *
 * Above the largest client-side format cap, so the format's own limit is what
 * a legitimate file meets, and far below anything that would trouble a tab.
 * This is the backstop for the case where no format has claimed the bytes yet.
 */
export const MAX_ENTRY_BYTES = 32 * 1024 * 1024;

async function readAtMost(
  stream: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        // Cancelled rather than drained: the point of a ceiling is not
        // finishing the work and then complaining about its size.
        await reader.cancel();
        throw new EntryTooLargeError(
          `This file expands to more than ${Math.round(limit / (1024 * 1024))} MB.`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/**
 * The bytes of one entry, read from the archive it came from.
 *
 * `file` is the archive; `entry` is a row the listing produced. Nothing here
 * takes a path or a name to look up — the caller passes back an entry that was
 * read out of the central directory, so there is no lookup to confuse and no
 * name to resolve.
 */
export async function readArchiveEntry(
  file: File,
  entry: ArchiveEntry,
  limit: number = MAX_ENTRY_BYTES,
): Promise<Uint8Array> {
  if (entry.encrypted) {
    throw new EntryUnreadableError(
      "This file is encrypted. Its name and size are listed, but reading it would need the password.",
    );
  }
  if (entry.method !== STORED && entry.method !== DEFLATED) {
    throw new EntryUnreadableError(
      "This file uses a compression this preview doesn't read.",
    );
  }
  // The archive's own claim, used only to refuse early. It is not trusted for
  // anything else — see the ceiling counted below.
  if (entry.uncompressedBytes > limit) {
    throw new EntryTooLargeError(
      `This file expands to more than ${Math.round(limit / (1024 * 1024))} MB.`,
    );
  }

  /*
   * The local header, read rather than assumed. The central directory records
   * where it starts, but only the local copy says how long *its* name and
   * extra field are — they routinely differ from the index's, and computing
   * the data offset from the wrong one lands mid-file.
   */
  const header = new Uint8Array(
    await file
      .slice(entry.localHeaderOffset, entry.localHeaderOffset + LOCAL_HEADER_SIZE)
      .arrayBuffer(),
  );
  if (header.byteLength < LOCAL_HEADER_SIZE) {
    throw new EntryUnreadableError("This archive ends before the file does.");
  }

  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (view.getUint32(0, true) !== LOCAL_SIGNATURE) {
    throw new EntryUnreadableError("This archive's index points at nothing.");
  }

  const start =
    entry.localHeaderOffset +
    LOCAL_HEADER_SIZE +
    view.getUint16(26, true) + // file name
    view.getUint16(28, true); // extra field
  const compressed = file.slice(start, start + entry.compressedBytes);

  if (entry.method === STORED) {
    const bytes = new Uint8Array(await compressed.arrayBuffer());
    if (bytes.byteLength > limit) {
      throw new EntryTooLargeError(
        `This file expands to more than ${Math.round(limit / (1024 * 1024))} MB.`,
      );
    }
    return bytes;
  }

  return readAtMost(
    compressed.stream().pipeThrough(new DecompressionStream("deflate-raw")),
    limit,
  );
}
