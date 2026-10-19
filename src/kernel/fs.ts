import type { FsBlock } from "./types";

/**
 * A tiny filesystem (milestone M6).
 *
 * The disk in M5 was a standalone toy: a queue of cylinder numbers. This makes
 * the blocks real. A file owns one contiguous run of blocks; the first block is
 * its index node and the rest hold data. Reading a file turns its blocks into
 * disk requests on cylinders, which is how the Files app ends up driving the
 * disk scheduler.
 *
 * Everything is plain data, so the whole filesystem lives inside `MachineState`
 * and is copied on write like the rest of the kernel.
 */

export const FS_BLOCKS = 24;
/** Bytes per block. Small enough that a "photo" is a handful of blocks. */
export const BLOCK_SIZE_KB = 4;

export function createFs(): FsBlock[] {
  return Array.from({ length: FS_BLOCKS }, (_, index) =>
    index === 0
      ? { index, kind: "dir" as const, label: "/" }
      : { index, kind: "free" as const },
  );
}

export interface FileEntry {
  name: string;
  start: number;
  blocks: number;
}

/** All files, in block order. Directories are not listed as files. */
export function listFiles(fs: FsBlock[]): FileEntry[] {
  const out: FileEntry[] = [];
  for (let i = 0; i < fs.length; i++) {
    const block = fs[i];
    if (block.kind !== "index" || !block.label) continue;
    let blocks = 1;
    while (i + blocks < fs.length && fs[i + blocks].kind === "file" && fs[i + blocks].label === block.label) {
      blocks++;
    }
    out.push({ name: block.label, start: block.index, blocks });
  }
  return out;
}

/** First-fit contiguous allocation. Returns null when the file does not fit. */
export function allocateFile(
  fs: FsBlock[],
  name: string,
  blocksWanted: number,
): { fs: FsBlock[]; entry: FileEntry } | null {
  const clean = name.trim();
  if (!clean) return null;
  if (listFiles(fs).some((f) => f.name === clean)) return null;

  const need = Math.max(1, Math.min(FS_BLOCKS - 1, Math.ceil(blocksWanted)));
  let start = -1;
  let run = 0;
  for (let i = 0; i < fs.length; i++) {
    if (fs[i].kind === "free") {
      if (run === 0) start = i;
      run++;
      if (run === need) break;
    } else {
      run = 0;
      start = -1;
    }
  }
  if (run < need || start < 0) return null;

  const next = fs.slice();
  for (let i = 0; i < need; i++) {
    next[start + i] = {
      index: start + i,
      kind: i === 0 ? "index" : "file",
      label: clean,
    };
  }
  return { fs: next, entry: { name: clean, start, blocks: need } };
}

/** Free every block that belongs to `name`. */
export function deleteFile(fs: FsBlock[], name: string): FsBlock[] {
  if (!listFiles(fs).some((f) => f.name === name)) return fs;
  return fs.map((block) =>
    block.label === name && (block.kind === "index" || block.kind === "file")
      ? { index: block.index, kind: "free" as const }
      : block,
  );
}

/**
 * Simulated cylinder for a block. Fixed mapping so the same file always issues
 * the same requests and a shared scenario replays identically.
 */
export function cylinderForBlock(index: number): number {
  return (index * 13 + 7) % 200;
}

export function readCylinders(fs: FsBlock[], name: string): number[] {
  return fs
    .filter((b) => b.label === name && (b.kind === "index" || b.kind === "file"))
    .map((b) => cylinderForBlock(b.index));
}

export function fileEntry(fs: FsBlock[], name: string): FileEntry | undefined {
  return listFiles(fs).find((f) => f.name === name);
}

export function usedBlocks(fs: FsBlock[]): number {
  return fs.filter((b) => b.kind !== "free").length;
}
