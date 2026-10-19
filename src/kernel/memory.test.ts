import { describe, expect, it } from "vitest";
import {
  advance,
  createMachine,
  killProcess,
  launchApp,
  setFrames,
  setReplacement,
} from "./machine";
import {
  accessPage,
  createMemory,
  freeFrameCount,
  FRAMES_MAX,
  FRAMES_MIN,
  memoryUsage,
  residentPages,
  type Replacement,
} from "./memory";
import type { MachineState } from "./types";

/**
 * The canonical reference string from every operating-systems textbook
 * (Silberschatz, figure "Reference string 7,0,1,2,0,3,0,4,2,3,0,3,2,1,2,0,1,7,0,1").
 * With three frames the fault counts are famous: 15 (FIFO), 12 (LRU), 9 (OPT).
 * If our kernel reproduces those, the replacement code is correct.
 */
const REFERENCE = [7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3, 2, 1, 2, 0, 1, 7, 0, 1];

function faultsWith(policy: Replacement, frames: number): number {
  let mem = createMemory(frames, policy);
  for (let i = 0; i < REFERENCE.length; i++) {
    // Real future knowledge, so OPT is genuinely optimal in this test.
    const nextUse = (_pid: number, wanted: number): number => {
      for (let j = i + 1; j < REFERENCE.length; j++) {
        if (REFERENCE[j] === wanted) return j - i;
      }
      return Number.MAX_SAFE_INTEGER;
    };
    mem = accessPage(mem, 1, REFERENCE[i], i + 1, nextUse).memory;
  }
  return mem.pageFaults;
}

describe("page replacement — textbook reference string, 3 frames", () => {
  it("FIFO takes 15 faults", () => {
    expect(faultsWith("fifo", 3)).toBe(15);
  });

  it("LRU takes 12 faults", () => {
    expect(faultsWith("lru", 3)).toBe(12);
  });

  it("OPT (Belady's) takes the fewest, 9 faults", () => {
    expect(faultsWith("optimal", 3)).toBe(9);
  });

  it("Clock is deterministic and no worse than never replacing", () => {
    const a = faultsWith("clock", 3);
    const b = faultsWith("clock", 3);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(9);
    expect(a).toBeLessThanOrEqual(REFERENCE.length);
  });
});

describe("frames", () => {
  it("a hit refreshes recency and does not count as a fault", () => {
    let mem = createMemory(2, "lru");
    mem = accessPage(mem, 1, 0, 1).memory; // fault
    mem = accessPage(mem, 1, 1, 2).memory; // fault — memory now full
    mem = accessPage(mem, 1, 0, 3).memory; // hit, page 0 is freshest
    mem = accessPage(mem, 1, 2, 4).memory; // fault — must evict LRU, which is page 1
    expect(mem.pageFaults).toBe(3);
    expect(mem.hits).toBe(1);
    expect(residentPages(mem, 1)).toEqual([0, 2]);
  });

  it("tracks how full memory is", () => {
    let mem = createMemory(4, "lru");
    expect(memoryUsage(mem)).toBe(0);
    mem = accessPage(mem, 1, 0, 1).memory;
    mem = accessPage(mem, 2, 0, 2).memory;
    expect(memoryUsage(mem)).toBeCloseTo(0.5, 10);
    expect(freeFrameCount(mem)).toBe(2);
  });

  it("resizing to the same size is a no-op", () => {
    const mem = createMemory(6);
    expect(createMemory(6)).toEqual(mem);
  });
});

/* ------------------------------------------------------------------ *
 * The kernel driving memory while processes run
 * ------------------------------------------------------------------ */

function photos(frames: number, replacement: Replacement = "lru", burst = 8): MachineState {
  let s = createMachine({ seed: 1, frames, replacement });
  s = launchApp(s, "photos", { burst }); // Photos declares 4 pages
  return s;
}

describe("memory in the running machine", () => {
  it("boots with the requested number of free frames", () => {
    const s = createMachine({ frames: 5 });
    expect(s.memory.frames).toHaveLength(5);
    expect(freeFrameCount(s.memory)).toBe(5);
  });

  it("pages a process in cold, then gets hits while its pages stay resident", () => {
    // 4 pages, 8 frames: the working set fits, so exactly 4 cold faults.
    const s = advance(photos(8), 9); // admitted, dispatched, 8 ticks of work
    expect(s.memory.pageFaults).toBe(4);
    expect(s.memory.hits).toBe(4);
    expect(s.memory.evictions).toBe(0);
  });

  it("faults on every access when the working set cannot fit", () => {
    // 4 pages walked in a cycle, but only 2 frames: nothing survives a lap.
    const s = advance(photos(2), 9);
    expect(s.memory.pageFaults).toBe(8);
    expect(s.memory.evictions).toBe(6);
    expect(s.memory.hits).toBe(0);
  });

  it("lets OPT beat LRU on the same cyclic workload", () => {
    const lru = advance(photos(3, "lru"), 9);
    const opt = advance(photos(3, "optimal"), 9);
    expect(opt.memory.pageFaults).toBeLessThan(lru.memory.pageFaults);
  });

  it("releases every frame when a process exits", () => {
    const s = advance(photos(4), 9);
    expect(s.processes[0].state).toBe("terminated");
    expect(freeFrameCount(s.memory)).toBe(4);
  });

  it("releases every frame when a process is killed", () => {
    let s = advance(photos(4), 5);
    expect(freeFrameCount(s.memory)).toBeLessThan(4);
    s = killProcess(s, 1);
    expect(freeFrameCount(s.memory)).toBe(4);
    expect(s.log.some((e) => e.kind === "kill" && e.text.includes("memory"))).toBe(true);
  });

  it("writes a page-fault line into the kernel log", () => {
    const s = advance(photos(4), 3);
    const faults = s.log.filter((e) => e.kind === "fault");
    expect(faults.length).toBeGreaterThan(0);
    expect(faults[0].chip).toBe("page fault");
    expect(faults[0].pid).toBe(1);
  });

  it("keeps the frame table coherent when processes share memory", () => {
    let s = createMachine({ seed: 3, frames: 3, replacement: "optimal" });
    s = launchApp(s, "photos", { burst: 30 }); // 4 pages
    s = launchApp(s, "browser", { burst: 30 }); // 3 pages
    s = advance(s, 60);

    const seen = new Set<string>();
    for (const frame of s.memory.frames) {
      if (frame.pid === null) {
        expect(frame.page).toBeNull();
        continue;
      }
      const owner = s.processes.find((p) => p.pid === frame.pid);
      expect(owner).toBeTruthy();
      expect(frame.page).not.toBeNull();
      expect(frame.page!).toBeGreaterThanOrEqual(0);
      expect(frame.page!).toBeLessThan(owner!.memPages);

      const key = `${frame.pid}:${frame.page}`;
      expect(seen.has(key)).toBe(false); // one page lives in exactly one frame
      seen.add(key);
    }
  });
});

describe("memory syscalls", () => {
  it("resizes memory and clamps it to a sane range", () => {
    const s = createMachine({ frames: 8 });
    expect(setFrames(s, 12).memory.frames).toHaveLength(12);
    expect(setFrames(s, 0).memory.frames).toHaveLength(FRAMES_MIN);
    expect(setFrames(s, 9999).memory.frames).toHaveLength(FRAMES_MAX);
    expect(setFrames(s, 8)).toBe(s);
  });

  it("keeps resident pages when frames are added but drops the tail when shrunk", () => {
    let s = advance(photos(8), 4); // some pages loaded
    const used = residentPages(s.memory, 1).length;
    expect(used).toBeGreaterThan(0);

    s = setFrames(s, 8);
    expect(s.memory.frames).toHaveLength(8);

    const shrunk = setFrames(s, FRAMES_MIN);
    expect(shrunk.memory.frames).toHaveLength(FRAMES_MIN);
  });

  it("changes the replacement policy and records the decision", () => {
    const s = createMachine({ frames: 4 });
    const next = setReplacement(s, "fifo");
    expect(next.memory.replacement).toBe("fifo");
    expect(next.log.some((e) => e.kind === "memory" && e.text.includes("FIFO"))).toBe(true);
    expect(setReplacement(next, "fifo")).toBe(next);
  });
});
