import type { Frame, MemoryState, Pid } from "./types";

/**
 * Physical memory, modelled as a fixed table of frames.
 *
 * This is the M3/M4 milestone. Every frame holds exactly one page of one
 * process, and the whole machine shares the table. When a process touches a
 * page the kernel looks it up:
 *
 *   - if the page is already in a frame, that is a **hit** (cheap);
 *   - if it is not, that is a **page fault**: the kernel loads the page from
 *     "disk", taking a free frame, or — when memory is full — evicting a page
 *     according to the replacement policy the student picked.
 *
 * Everything here is a pure function over an immutable `MemoryState`, so the
 * frame table can be rewound and replayed alongside the rest of the kernel.
 */

/** One page is 4 KB, the classic textbook size. */
export const PAGE_SIZE_KB = 4;
export const DEFAULT_FRAMES = 8;
export const FRAMES_MIN = 2;
export const FRAMES_MAX = 32;
export const DEFAULT_REPLACEMENT: MemoryState["replacement"] = "lru";

export type Replacement = MemoryState["replacement"];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function emptyFrame(index: number): Frame {
  return {
    index,
    pid: null,
    page: null,
    loadedAt: 0,
    lastAccess: 0,
    referenced: false,
    dirty: false,
  };
}

export function createMemory(
  frames: number = DEFAULT_FRAMES,
  replacement: Replacement = DEFAULT_REPLACEMENT,
): MemoryState {
  const count = clamp(Math.round(frames), FRAMES_MIN, FRAMES_MAX);
  return {
    frames: Array.from({ length: count }, (_, index) => emptyFrame(index)),
    pageSizeKb: PAGE_SIZE_KB,
    pageFaults: 0,
    hits: 0,
    evictions: 0,
    replacement,
    clockHand: 0,
  };
}

/** Add or remove frames. Shrinking simply drops the tail; stats are kept. */
export function resizeFrames(mem: MemoryState, frames: number): MemoryState {
  const want = clamp(Math.round(frames), FRAMES_MIN, FRAMES_MAX);
  if (want === mem.frames.length) return mem;
  const next = mem.frames.slice(0, want).map((f) => ({ ...f }));
  for (let i = next.length; i < want; i++) next.push(emptyFrame(i));
  return { ...mem, frames: next, clockHand: mem.clockHand % want };
}

export function setReplacement(mem: MemoryState, replacement: Replacement): MemoryState {
  if (replacement === mem.replacement) return mem;
  return { ...mem, replacement, clockHand: 0 };
}

/** Give every frame a process was using back to the free pool. */
export function freeFramesFor(mem: MemoryState, pid: Pid): MemoryState {
  if (!mem.frames.some((f) => f.pid === pid)) return mem;
  return {
    ...mem,
    frames: mem.frames.map((f) => (f.pid === pid ? emptyFrame(f.index) : f)),
  };
}

export function freeFrameCount(mem: MemoryState): number {
  let n = 0;
  for (const f of mem.frames) if (f.pid === null) n++;
  return n;
}

/** The page numbers a process currently has resident, in ascending order. */
export function residentPages(mem: MemoryState, pid: Pid): number[] {
  return mem.frames
    .filter((f) => f.pid === pid)
    .map((f) => f.page!)
    .sort((a, b) => a - b);
}

/** Fraction of frames that are in use, 0–1. */
export function memoryUsage(mem: MemoryState): number {
  if (mem.frames.length === 0) return 0;
  return (mem.frames.length - freeFrameCount(mem)) / mem.frames.length;
}

/** Share of accesses that were faults, 0–1. The headline number for M4. */
export function faultRate(mem: MemoryState): number {
  const total = mem.hits + mem.pageFaults;
  return total === 0 ? 0 : mem.pageFaults / total;
}

/* ------------------------------------------------------------------ *
 * Replacement policies
 * ------------------------------------------------------------------ */

function argBest(frames: Frame[], score: (f: Frame) => number, mode: "min" | "max"): number {
  let best = 0;
  let bestScore = score(frames[0]);
  for (let i = 1; i < frames.length; i++) {
    const s = score(frames[i]);
    if ((mode === "min" && s < bestScore) || (mode === "max" && s > bestScore)) {
      best = i;
      bestScore = s;
    }
  }
  return best;
}

function policyPick(
  frames: Frame[],
  policy: Replacement,
  nextUse?: (pid: Pid, page: number) => number,
): number {
  switch (policy) {
    case "fifo":
      // Oldest arrival in memory goes first.
      return argBest(frames, (f) => f.loadedAt, "min");
    case "optimal":
      // Belady's OPT: throw out the page that will be needed farthest in the
      // future. It needs to know the future, so it falls back to LRU when the
      // kernel cannot supply a next-use estimate.
      if (!nextUse) return argBest(frames, (f) => f.lastAccess, "min");
      return argBest(frames, (f) => (f.pid === null ? 0 : nextUse(f.pid, f.page!)), "max");
    case "lru":
    default:
      // Least recently used.
      return argBest(frames, (f) => f.lastAccess, "min");
  }
}

/** The Clock ("second chance") sweep: give referenced pages one more lap. */
function clockPick(frames: Frame[], hand: number): { frames: Frame[]; index: number; clockHand: number } {
  const working = frames.slice();
  let h = hand % frames.length;
  for (let guard = 0; guard <= frames.length * 2; guard++) {
    const f = working[h];
    if (!f.referenced) {
      return { frames: working, index: h, clockHand: (h + 1) % frames.length };
    }
    working[h] = { ...f, referenced: false };
    h = (h + 1) % frames.length;
  }
  return { frames: working, index: h, clockHand: (h + 1) % frames.length };
}

export interface AccessResult {
  memory: MemoryState;
  hit: boolean;
  /** The page thrown out to make room, when memory was already full. */
  evicted?: { pid: Pid; page: number };
  /** Which frame now holds the page. */
  frameIndex: number;
}

/**
 * Touch one page on behalf of a process. Returns the new memory state plus
 * whether it was a hit — the caller turns that into a log line and a stat.
 *
 * `nextUse(pid, page)` is only consulted by the OPT policy; it should return
 * how many ticks of CPU time will pass before that page is wanted again.
 */
export function accessPage(
  mem: MemoryState,
  pid: Pid,
  page: number,
  now: number,
  nextUse?: (pid: Pid, page: number) => number,
): AccessResult {
  const frames = mem.frames;
  const hitIdx = frames.findIndex((f) => f.pid === pid && f.page === page);

  if (hitIdx >= 0) {
    const next = frames.slice();
    next[hitIdx] = { ...next[hitIdx], lastAccess: now, referenced: true, dirty: true };
    return {
      memory: { ...mem, frames: next, hits: mem.hits + 1 },
      hit: true,
      frameIndex: hitIdx,
    };
  }

  // Page fault: the page is not resident anywhere.
  let working = frames.slice();
  let evicted: AccessResult["evicted"];
  let clockHand = mem.clockHand;
  let target = working.findIndex((f) => f.pid === null);

  if (target === -1) {
    if (mem.replacement === "clock") {
      const picked = clockPick(working, clockHand);
      working = picked.frames;
      target = picked.index;
      clockHand = picked.clockHand;
    } else {
      target = policyPick(working, mem.replacement, nextUse);
    }
    evicted = { pid: working[target].pid!, page: working[target].page! };
  }

  working[target] = {
    index: target,
    pid,
    page,
    loadedAt: now,
    lastAccess: now,
    referenced: true,
    dirty: true,
  };

  return {
    memory: {
      ...mem,
      frames: working,
      pageFaults: mem.pageFaults + 1,
      evictions: mem.evictions + (evicted ? 1 : 0),
      clockHand,
    },
    hit: false,
    evicted,
    frameIndex: target,
  };
}
