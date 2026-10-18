/**
 * ToyOS kernel types.
 *
 * Design rule for the whole project: the kernel is a *pure reducer*. Every
 * mutation goes through a syscall dispatch, and `tick()` advances simulated
 * time by exactly one millisecond. No timers, no randomness outside the seeded
 * RNG, no DOM. That is what makes the simulator deterministic, replayable and
 * safe to rewind — and what lets us unit-test textbook answers.
 */

export type Pid = number;

/** The five classic process states taught in class 11/12. */
export type ProcessState = "new" | "ready" | "running" | "waiting" | "terminated";

/**
 * Scheduling policies. M1 ships Round Robin; the rest are wired in M2, which is
 * why `chooseNext` is written as a strategy from the start.
 */
export type Policy = "rr" | "fcfs" | "sjf" | "srtf" | "priority";

export type ExitReason = "completed" | "killed" | null;

/** Process Control Block — everything the kernel knows about one process. */
export interface Pcb {
  pid: Pid;
  /** Catalogue id of the app this process was launched from. */
  appId: string;
  /** Human label shown in the UI, e.g. "Browser". */
  name: string;
  state: ProcessState;

  /** 1 = highest priority (matches the "smaller number wins" convention). */
  priority: number;
  /** Total CPU time this process needs, in simulated ms. */
  burstTotal: number;
  /** CPU time still outstanding. */
  burstRemaining: number;

  /** Simulated ms at which the app was clicked. */
  arrivalTime: number;
  /** Simulated ms at which "new" becomes "ready". */
  admitAt: number;
  firstRunTime: number | null;
  completionTime: number | null;
  /** Simulated ms spent blocked on a device (always 0 until M6). */
  blockedTime: number;
  /** CPU time consumed inside the current quantum (RR only). */
  quantumUsed: number;

  exitReason: ExitReason;
  /** Pages of memory this process declares it needs (used from M3 onward). */
  memPages: number;
  /** Accent colour, chosen deterministically from the app catalogue. */
  color: string;

  /** Remaining burst at the moment the process entered the ready queue —
   *  used by SRTF for preemption decisions. */
  burstAtReady: number;
}

/** One contiguous stretch of CPU time given to a single process. */
export interface GanttSlice {
  pid: Pid;
  start: number;
  end: number;
}

export type KernelEventKind =
  | "boot"
  | "syscall"
  | "admit"
  | "dispatch"
  | "preempt"
  | "exit"
  | "kill"
  | "priority"
  | "config";

/**
 * A single line in the kernel log. `text` is written for a 16-year-old reader —
 * plain English, no jargon that has not been introduced.
 */
export interface KernelEvent {
  id: number;
  /** Simulated timestamp in ms. */
  t: number;
  kind: KernelEventKind;
  pid?: Pid;
  text: string;
  /** Short syscall-style label rendered as a chip, e.g. "fork()". */
  chip?: string;
}

export interface MachineStats {
  contextSwitches: number;
  busyTicks: number;
  quantumExpiries: number;
  completed: number;
  killed: number;
}

export interface MachineState {
  /** Simulated clock, in ms. One tick is one ms. */
  now: number;
  /** Monotonic simulator uptime is `now`; this is the seed for reproducibility. */
  seed: number;
  rngState: number;

  processes: Pcb[];
  /** Ready queue as a list of PIDs; index 0 is the next to run. */
  readyQueue: Pid[];
  runningPid: Pid | null;

  policy: Policy;
  quantum: number;
  nextPid: number;

  gantt: GanttSlice[];
  stats: MachineStats;

  log: KernelEvent[];
  nextEventId: number;
}

/* ------------------------------------------------------------------ *
 * Reserved for later milestones (M3 memory, M5 disk, M6 devices/files).
 * Declared here so the root state shape is agreed up front rather than
 * retrofitted — see the plan's "biggest risk" note.
 * ------------------------------------------------------------------ */

export interface Frame {
  index: number;
  pid: Pid | null;
  page: number | null;
  /** Simulated ms when this frame was last filled — used by FIFO/LRU. */
  loadedAt: number;
  lastAccess: number;
  referenced: boolean;
  dirty: boolean;
}

export interface MemoryState {
  frames: Frame[];
  pageSizeKb: number;
  pageFaults: number;
  hits: number;
  replacement: "fifo" | "lru" | "optimal" | "clock";
}

export interface DiskState {
  headPosition: number;
  direction: 1 | -1;
  queue: number[];
  policy: "fcfs" | "sstf" | "scan" | "cscan" | "look";
  totalSeekTime: number;
}

export interface DeviceState {
  id: string;
  name: string;
  instances: number;
  heldBy: Pid[];
  waitQueue: Pid[];
}

export interface FsBlock {
  index: number;
  kind: "free" | "file" | "index" | "dir";
  label?: string;
  ownerPid?: Pid;
}
