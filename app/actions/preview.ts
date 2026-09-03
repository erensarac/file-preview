"use server";

/**
 * The upload API, as a server action.
 *
 * Only formats whose adapter declares `runtime: "server"` are allowed through
 * here — the client-side formats are parsed in the browser and must never be
 * uploaded, so a request for one is rejected rather than quietly handled.
 *
 * Everything the client sends is treated as untrusted: the filename and MIME
 * type are re-detected server-side and the size is re-checked against the
 * format's own limit before a single byte is parsed.
 */

import { detectFormat } from "@/lib/formats";
import { hasServerParser, parseOnServer } from "@/lib/adapters/server";
import type { PreviewResult } from "@/lib/preview";
import { createBulkhead, TooBusyError } from "@/lib/concurrency";
import {
  encryptedMessage,
  EncryptedFileError,
  looksEncryptedOffice,
} from "@/lib/encrypted";
import {
  formatFailure,
  safeErrorName,
  sizeBucket,
  type FailurePhase,
} from "@/lib/telemetry";
import { assertSafeArchive, ZipBombError } from "@/lib/zip-guard";

/**
 * Parsing is the memory-hungry part of this endpoint, and several large
 * workbooks landing on one instance at once is how it runs out of memory.
 */
const runParse = createBulkhead(4);

export async function previewFile(formData: FormData): Promise<PreviewResult> {
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return { ok: false, error: "No file was received." };
  }

  const spec = detectFormat(file.name, file.type);
  if (!spec) {
    return { ok: false, error: `We can't open ${file.name} yet.` };
  }

  if (spec.runtime !== "server" || !hasServerParser(spec.id)) {
    return {
      ok: false,
      error: `${spec.label} files are previewed in your browser and don't need uploading.`,
    };
  }

  if (file.size === 0) {
    return { ok: false, error: "That file is empty." };
  }

  if (file.size > spec.maxBytes) {
    const limit = Math.round(spec.maxBytes / (1024 * 1024));
    return {
      ok: false,
      error: `${spec.label} files are limited to ${limit} MB.`,
    };
  }

  try {
    const document = await runParse(async () => {
      const bytes = new Uint8Array(await file.arrayBuffer());

      // Before the parser is allowed to allocate anything, check what the
      // archive claims it will expand to.
      /*
       * Checked before the archive guard, because a locked Office file is not
       * an archive: it is an OLE compound file wrapping the real package. The
       * zip reader would reject it as malformed and the reason would be lost.
       */
      if (looksEncryptedOffice(bytes)) {
        throw new EncryptedFileError();
      }

      assertSafeArchive(bytes);

      return parseOnServer(
        { name: file.name, size: file.size, bytes },
        spec.id,
      );
    });
    return { ok: true, document };
  } catch (error) {
    if (error instanceof TooBusyError) {
      return {
        ok: false,
        error:
          "Too many files are being converted right now. Try again shortly.",
      };
    }

    /*
     * One structured line per failure, on a stable prefix so it can be
     * searched and counted. It carries the format, the phase and the error's
     * class — never the filename, the message, or the exact size. See
     * `lib/telemetry.ts` for why each of those is excluded.
     */
    const record = (phase: FailurePhase) =>
      console.error(
        formatFailure({
          formatId: spec.id,
          runtime: spec.runtime,
          phase,
          errorName: safeErrorName(error),
          sizeBucket: sizeBucket(file.size),
        }),
      );

    if (error instanceof EncryptedFileError) {
      // Recorded, not because it is our failure — it is not — but because a
      // rise in locked files is worth being able to see.
      record("guard");
      return { ok: false, error: encryptedMessage(spec.label) };
    }

    if (error instanceof ZipBombError) {
      // The numbers go to the warning; the countable line goes to `record`.
      console.warn(`Rejected ${spec.id} archive: ${error.message}`);
      record("guard");
      return {
        ok: false,
        error: `This ${spec.label} file expands to far more than its size suggests, so we didn't open it.`,
      };
    }

    // Parser errors can quote file contents, so the detail is logged for a
    // developer and never forwarded to the browser.
    record("parse");
    console.error(`Failed to preview ${spec.id} file`, error);
    return {
      ok: false,
      // No longer hedges about passwords: an encrypted file is now identified
      // before this point, so a file reaching here really is unreadable.
      error: `We couldn't read this ${spec.label} file. It may be corrupt, or saved in a format we don't recognise.`,
    };
  }
}
