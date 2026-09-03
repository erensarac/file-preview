/**
 * Telling "we can't read this" apart from "this is locked".
 *
 * Those are different problems wearing the same message. A corrupt file is
 * nothing the user can do anything about; an encrypted one is *fine*, and they
 * very likely know the password. Telling someone their working file might be
 * corrupt sends them away from a problem they could have solved in seconds.
 */

export class EncryptedFileError extends Error {}

/**
 * An encrypted OOXML file is not a zip at all.
 *
 * Word and Excel wrap the whole package in an OLE compound file — the old
 * pre-2007 container — with the real document living in a stream called
 * `EncryptedPackage`. So the signature is the compound file's, and by the time
 * a zip parser has failed on it the reason is gone.
 */
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/**
 * Stream names live in the compound file's directory as UTF-16LE, so the name
 * is searched for in that encoding rather than as ASCII.
 */
const ENCRYPTED_PACKAGE = "EncryptedPackage";

function indexOfUtf16(bytes: Uint8Array, text: string): number {
  const needle = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i += 1) {
    needle[i * 2] = text.charCodeAt(i) & 0xff;
    needle[i * 2 + 1] = text.charCodeAt(i) >> 8;
  }

  outer: for (let start = 0; start + needle.length <= bytes.length; start += 1) {
    for (let i = 0; i < needle.length; i += 1) {
      if (bytes[start + i] !== needle[i]) continue outer;
    }
    return start;
  }
  return -1;
}

/**
 * Whether this looks like a password-protected Word or Excel file.
 *
 * Both markers are required. The OLE signature alone would also match a
 * genuine pre-2007 `.xls` renamed to `.xlsx`, which is a different problem
 * with a different answer — that case falls through to the existing "we
 * couldn't read this" rather than being mislabelled as locked.
 */
export function looksEncryptedOffice(bytes: Uint8Array): boolean {
  if (bytes.length < OLE_SIGNATURE.length) return false;
  if (!OLE_SIGNATURE.every((byte, index) => bytes[index] === byte)) return false;
  return indexOfUtf16(bytes, ENCRYPTED_PACKAGE) !== -1;
}

/**
 * What to tell someone holding a locked file.
 *
 * It says why there is no password box rather than leaving that as a puzzle.
 * For a server-parsed format the honest reason is that the password would have
 * to travel to our server alongside the file, which is a trade this project
 * has not made — and would be a different decision from any made so far.
 */
export function encryptedMessage(label: string): string {
  return (
    `This ${label} file is password-protected. We don't ask for the password, ` +
    `because it would have to be sent to our server along with the file — ` +
    `re-save it without protection and it will open.`
  );
}
