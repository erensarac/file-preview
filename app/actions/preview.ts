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
    const bytes = new Uint8Array(await file.arrayBuffer());
    const document = await parseOnServer(
      { name: file.name, size: file.size, bytes },
      spec.id,
    );
    return { ok: true, document };
  } catch (error) {
    // Parser errors can quote file contents, so log the detail and return a
    // short message instead of forwarding it to the browser verbatim.
    console.error(`Failed to preview ${spec.id} file`, error);
    return {
      ok: false,
      error: `We couldn't read this ${spec.label} file. It may be corrupt or password-protected.`,
    };
  }
}
