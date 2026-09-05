import type { ArchiveEntry } from "./preview";

/**
 * An archive's index, read as the shape it actually has.
 *
 * A zip stores a flat list of names with slashes in them; the folders are an
 * agreement about how to read that list, not a structure the format keeps. So
 * this derives one on demand rather than holding a second copy of the archive
 * in memory — at the two thousand entries the guard allows, walking the list
 * per navigation costs less than the tree would.
 *
 * ── Segments are labels, never path components ───────────────────────────
 *
 * `../../etc/passwd` is a legal entry name. Nothing here resolves it: the name
 * is split on slashes and each piece is used as a label, so an archive
 * claiming that name shows a folder called `..` containing a folder called
 * `..`. That is what it says, displayed as what it is. Resolving it — even to
 * decide what to *show* — is the step that turns a listing into a
 * vulnerability, and there is no reason to take it.
 */

export interface ArchiveNode {
  /** The segment at this level, which is what the row shows. */
  name: string;
  /** Everything above it, joined — used to navigate, never to resolve. */
  path: string;
  directory: boolean;
  /** Files beneath a directory, counted recursively. Zero for a file. */
  files: number;
  uncompressedBytes: number;
  compressedBytes: number;
  encrypted: boolean;
}

export interface ArchiveListing {
  nodes: ArchiveNode[];
  /** How many entries the macOS filter took out of the whole archive. */
  hiddenMetadata: number;
}

/**
 * The bookkeeping macOS adds to a zip, which is not what anyone opened it for.
 *
 * Compressing a folder in Finder writes a parallel `__MACOSX/` tree holding an
 * AppleDouble file per real one — `__MACOSX/docs/._guide.md` beside
 * `docs/guide.md` — so an unfiltered listing shows every file twice, once real
 * and once as a few hundred bytes of resource fork. `.DS_Store` is the same
 * kind of noise.
 *
 * Hidden rather than dropped: the count is shown, because a listing that
 * quietly disagrees with the file's own entry count is its own small mystery.
 */
export function isMacMetadata(name: string): boolean {
  const segments = name.split("/");
  if (segments.includes("__MACOSX")) return true;

  const base = segments[segments.length - 1] ?? "";
  return base === ".DS_Store" || base.startsWith("._");
}

/** Folders first, then files, each alphabetically — the order a file manager uses. */
function inReadingOrder(left: ArchiveNode, right: ArchiveNode): number {
  if (left.directory !== right.directory) return left.directory ? -1 : 1;
  return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
}

/**
 * What sits directly inside `path`, with directories summed from what is under
 * them.
 *
 * `path` is "" for the root, and otherwise exactly the `path` of a node
 * returned earlier — never something assembled by a caller, which is what
 * keeps navigation inside names the archive itself provided.
 */
export function listArchive(
  entries: readonly ArchiveEntry[],
  path: string,
): ArchiveListing {
  const prefix = path === "" ? "" : `${path}/`;
  const directories = new Map<string, ArchiveNode>();
  const files: ArchiveNode[] = [];
  let hiddenMetadata = 0;

  for (const entry of entries) {
    if (isMacMetadata(entry.name)) {
      // Counted once for the archive, not once per directory looked at.
      if (!entry.directory) hiddenMetadata += 1;
      continue;
    }
    if (!entry.name.startsWith(prefix)) continue;

    const rest = entry.name.slice(prefix.length);
    // The directory's own entry, and the reason a trailing slash is stripped
    // before splitting: "docs/" is this folder, not a nameless child of it.
    if (rest === "" || rest === "/") continue;

    const segments = rest.replace(/\/$/, "").split("/");
    const first = segments[0]!;

    if (segments.length === 1 && !entry.directory) {
      files.push({
        name: first,
        path: prefix + first,
        directory: false,
        files: 0,
        uncompressedBytes: entry.uncompressedBytes,
        compressedBytes: entry.compressedBytes,
        encrypted: entry.encrypted,
      });
      continue;
    }

    const existing = directories.get(first) ?? {
      name: first,
      path: prefix + first,
      directory: true,
      files: 0,
      uncompressedBytes: 0,
      compressedBytes: 0,
      encrypted: false,
    };
    // A directory entry contributes its existence; only files contribute size,
    // so a folder's total is what is actually inside it.
    if (!entry.directory) {
      existing.files += 1;
      existing.uncompressedBytes += entry.uncompressedBytes;
      existing.compressedBytes += entry.compressedBytes;
      existing.encrypted ||= entry.encrypted;
    }
    directories.set(first, existing);
  }

  return {
    nodes: [...directories.values(), ...files].sort(inReadingOrder),
    hiddenMetadata,
  };
}

/**
 * The trail back up, as segments paired with the path each one leads to.
 *
 * Derived from the current path rather than remembered, so arriving at a
 * folder by any route gives the same trail and there is no history to get out
 * of step with what is on screen.
 */
export function breadcrumbs(path: string): { name: string; path: string }[] {
  if (path === "") return [];
  const segments = path.split("/");
  return segments.map((name, index) => ({
    name,
    path: segments.slice(0, index + 1).join("/"),
  }));
}

/** Every file in the archive, for a filter that should reach the whole of it. */
export function allFiles(entries: readonly ArchiveEntry[]): ArchiveNode[] {
  return entries
    .filter((entry) => !entry.directory && !isMacMetadata(entry.name))
    .map((entry) => ({
      name: entry.name,
      path: entry.name,
      directory: false,
      files: 0,
      uncompressedBytes: entry.uncompressedBytes,
      compressedBytes: entry.compressedBytes,
      encrypted: entry.encrypted,
    }));
}
