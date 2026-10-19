import type { DiskState } from "./types";

/**
 * Disk scheduling (milestone M5).
 *
 * A hard disk is a stack of concentric tracks ("cylinders"), numbered 0–199,
 * with a single read/write head that slides across them. Moving the head is
 * the slow part, so the kernel's job is to *order* the waiting requests to
 * move the head as little as possible. Students compare five classic orders:
 *
 *   FCFS   — do them in the order they arrived (fair, but the head zig-zags)
 *   SSTF   — nearest request first (greedy; can starve far-away requests)
 *   SCAN   — the elevator: sweep to the end, then reverse
 *   C-SCAN — one-way elevator: sweep to the end, jump back, sweep again
 *   LOOK   — like SCAN, but reverse at the last request instead of the rim
 *
 * All distances ("seek time") are counted in cylinders, which is exactly the
 * textbook unit.
 */

export const DISK_MIN = 0;
export const DISK_MAX = 199;
export const DEFAULT_HEAD = 53;

export type DiskPolicy = DiskState["policy"];

export function createDisk(): DiskState {
  return {
    headPosition: DEFAULT_HEAD,
    direction: -1,
    queue: [],
    policy: "fcfs",
    totalSeekTime: 0,
    lastMove: null,
    serviced: [],
  };
}

export function clampCylinder(cylinder: number): number {
  const n = Math.round(cylinder);
  if (Number.isNaN(n)) return DISK_MIN;
  return Math.max(DISK_MIN, Math.min(DISK_MAX, n));
}

/** The Files app asked for a block on this cylinder. It joins the back of the queue. */
export function requestCylinder(disk: DiskState, cylinder: number): DiskState {
  return { ...disk, queue: [...disk.queue, clampCylinder(cylinder)] };
}

export function setDiskPolicy(disk: DiskState, policy: DiskPolicy): DiskState {
  if (policy === disk.policy) return disk;
  // Keep the pending requests, but restart the measurement so totals compare fairly.
  return { ...disk, policy, totalSeekTime: 0, serviced: [], lastMove: null };
}

/** Forget the pending requests but keep the head where it is. */
export function clearQueue(disk: DiskState): DiskState {
  if (disk.queue.length === 0) return disk;
  return { ...disk, queue: [], lastMove: null };
}

/** Back to a fresh, empty disk. */
export function resetDisk(disk: DiskState): DiskState {
  return { ...createDisk(), policy: disk.policy, headPosition: disk.headPosition };
}

interface Choice {
  kind: "service" | "sweep";
  index?: number;
  target: number;
}

function pickNearest(candidates: { c: number; i: number }[], head: number): { c: number; i: number } {
  let best = candidates[0];
  for (const cand of candidates) {
    if (Math.abs(cand.c - head) < Math.abs(best.c - head)) best = cand;
  }
  return best;
}

/** Decide which cylinder the head visits next, without moving it. */
export function chooseNext(disk: DiskState): Choice | null {
  const { queue, headPosition: head, direction, policy } = disk;
  if (queue.length === 0) return null;

  const indexed = queue.map((c, i) => ({ c, i }));
  const inDirection = indexed.filter(({ c }) => (direction === 1 ? c > head : c < head));

  switch (policy) {
    case "fcfs":
      return { kind: "service", index: 0, target: queue[0] };

    case "sstf": {
      const pick = pickNearest(indexed, head);
      return { kind: "service", index: pick.i, target: pick.c };
    }

    case "scan": {
      if (inDirection.length > 0) {
        const pick = pickNearest(inDirection, head);
        return { kind: "service", index: pick.i, target: pick.c };
      }
      // Nothing left this way: run to the rim, then turn around.
      return { kind: "sweep", target: direction === 1 ? DISK_MAX : DISK_MIN };
    }

    case "cscan": {
      if (inDirection.length > 0) {
        const pick = pickNearest(inDirection, head);
        return { kind: "service", index: pick.i, target: pick.c };
      }
      // One-way: to the rim, then all the way back to the far rim.
      return { kind: "sweep", target: direction === 1 ? DISK_MIN : DISK_MAX };
    }

    case "look": {
      if (inDirection.length > 0) {
        const pick = pickNearest(inDirection, head);
        return { kind: "service", index: pick.i, target: pick.c };
      }
      // Reverse at the last request rather than at the rim.
      const pick = pickNearest(indexed, head);
      return { kind: "service", index: pick.i, target: pick.c };
    }

    case "clook":
    default: {
      if (inDirection.length > 0) {
        const pick = pickNearest(inDirection, head);
        return { kind: "service", index: pick.i, target: pick.c };
      }
      // Jump straight to the request at the far end, then keep going the same way.
      const far = direction === 1 ? Math.min(...queue) : Math.max(...queue);
      return { kind: "service", index: queue.indexOf(far), target: far };
    }
  }
}

/** Service exactly one request (or perform one end-of-travel sweep). */
export function stepDisk(disk: DiskState): DiskState {
  const choice = chooseNext(disk);
  if (!choice) return disk;

  const head = disk.headPosition;
  const { direction, policy } = disk;

  if (choice.kind === "sweep") {
    let seek: number;
    let to = choice.target;
    let newDirection = direction;

    if (policy === "cscan") {
      const end = direction === 1 ? DISK_MAX : DISK_MIN;
      const far = direction === 1 ? DISK_MIN : DISK_MAX;
      seek = Math.abs(end - head) + (DISK_MAX - DISK_MIN);
      to = far;
      newDirection = direction; // one-way travel: keep going the same way
    } else {
      const end = direction === 1 ? DISK_MAX : DISK_MIN;
      seek = Math.abs(end - head);
      to = end;
      newDirection = direction === 1 ? -1 : 1; // SCAN turns around
    }

    return {
      ...disk,
      headPosition: to,
      direction: newDirection,
      totalSeekTime: disk.totalSeekTime + seek,
      lastMove: { from: head, to, seek, kind: "sweep" },
    };
  }

  const to = choice.target;
  const seek = Math.abs(to - head);
  const queue = disk.queue.filter((_, i) => i !== choice.index);

  let newDirection = direction;
  if (policy === "fcfs" || policy === "sstf" || policy === "look") {
    if (to > head) newDirection = 1;
    else if (to < head) newDirection = -1;
  }

  return {
    ...disk,
    headPosition: to,
    direction: newDirection,
    queue,
    totalSeekTime: disk.totalSeekTime + seek,
    lastMove: { from: head, to, seek, kind: "service" },
    serviced: [...disk.serviced, to],
  };
}

/** Run the head until the queue is empty. */
export function drainDisk(disk: DiskState): DiskState {
  let next = disk;
  let guard = 0;
  while (next.queue.length > 0 && guard++ < 10_000) next = stepDisk(next);
  return next;
}

/** Total seek time a policy would produce for the current queue, from here. */
export function projectedSeek(disk: DiskState): number {
  const before = disk.totalSeekTime;
  const after = drainDisk(disk).totalSeekTime;
  return after - before;
}
