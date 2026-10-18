import { getApp } from "./catalog";
import { randomInt } from "./rng";
import type {
  GanttSlice,
  KernelEvent,
  MachineState,
  Pcb,
  Pid,
  Policy,
  ProcessState,
} from "./types";

export const DEFAULT_QUANTUM = 12;
export const QUANTUM_MIN = 2;
export const QUANTUM_MAX = 60;
/** Keep the log bounded so a long session cannot grow without limit. */
export const MAX_LOG = 3000;

export interface MachineOptions {
  seed?: number;
  quantum?: number;
  policy?: Policy;
}

export interface LaunchOptions {
  /**
   * Force an exact CPU burst instead of drawing one from the seed. Used by the
   * unit tests, and by the advanced drawer for students who want to type numbers.
   */
  burst?: number;
}

/** Boot a fresh machine. Nothing is running; the Desktop is empty. */
export function createMachine(opts: MachineOptions = {}): MachineState {
  const seed = opts.seed ?? 1;
  const boot: KernelEvent = {
    id: 0,
    t: 0,
    kind: "boot",
    text: `ToyOS booted. One CPU core, Round Robin scheduling, quantum ${
      opts.quantum ?? DEFAULT_QUANTUM
    } ms. Click an app to start a process.`,
  };

  return {
    now: 0,
    seed,
    rngState: seed,
    processes: [],
    readyQueue: [],
    runningPid: null,
    policy: opts.policy ?? "rr",
    quantum: opts.quantum ?? DEFAULT_QUANTUM,
    nextPid: 1,
    gantt: [],
    stats: {
      contextSwitches: 0,
      busyTicks: 0,
      quantumExpiries: 0,
      completed: 0,
      killed: 0,
    },
    log: [boot],
    nextEventId: 1,
  };
}

/* ------------------------------------------------------------------ *
 * Small immutable helpers
 * ------------------------------------------------------------------ */

function withLog(state: MachineState, ...entries: Omit<KernelEvent, "id" | "t">[]): MachineState {
  const added: KernelEvent[] = entries.map((e, i) => ({
    ...e,
    id: state.nextEventId + i,
    t: state.now,
  }));
  const log = [...state.log, ...added];
  return {
    ...state,
    log: log.length > MAX_LOG ? log.slice(log.length - MAX_LOG) : log,
    nextEventId: state.nextEventId + entries.length,
  };
}

function patchProcess(
  processes: Pcb[],
  pid: Pid,
  changes: Partial<Pcb>,
): Pcb[] {
  return processes.map((p) => (p.pid === pid ? { ...p, ...changes } : p));
}

function findProcess(state: MachineState, pid: Pid): Pcb | undefined {
  return state.processes.find((p) => p.pid === pid);
}

export function isTerminated(state: MachineState, pid: Pid): boolean {
  const p = findProcess(state, pid);
  return !p || p.state === "terminated";
}

/* ------------------------------------------------------------------ *
 * Syscalls — the only way the user can change the machine
 * ------------------------------------------------------------------ */

/**
 * Launch an app: the Dock click that becomes `fork()` + `exec()`.
 * The new process starts in the `new` state and is admitted to the ready queue
 * on the next tick, so students can actually *see* the New → Ready transition.
 */
export function launchApp(
  state: MachineState,
  appId: string,
  opts: LaunchOptions = {},
): MachineState {
  const app = getApp(appId);
  const roll = randomInt(state.rngState, app.burst[0], app.burst[1]);
  const burst = opts.burst ?? roll.int;
  const pid = state.nextPid;

  const pcb: Pcb = {
    pid,
    appId: app.id,
    name: app.name,
    state: "new",
    priority: app.priority,
    burstTotal: burst,
    burstRemaining: burst,
    arrivalTime: state.now,
    admitAt: state.now + 1,
    firstRunTime: null,
    completionTime: null,
    blockedTime: 0,
    quantumUsed: 0,
    exitReason: null,
    memPages: app.memPages,
    color: app.color,
    burstAtReady: burst,
  };

  return withLog(
    {
      ...state,
      rngState: roll.state,
      nextPid: pid + 1,
      processes: [...state.processes, pcb],
    },
    {
      kind: "syscall",
      pid,
      chip: "fork()",
      text: `You clicked ${app.name}. The shell asks the kernel for a new process — fork().`,
    },
    {
      kind: "syscall",
      pid,
      chip: `exec("${app.id}")`,
      text: `${app.name}'s code is loaded into P${pid}. It needs ${pcb.burstTotal} ms of CPU and ${app.memPages} pages of memory.`,
    },
    {
      kind: "admit",
      pid,
      text: `P${pid} is in the New state. The kernel will admit it to the Ready queue on the next tick.`,
    },
  );
}

/** Close an app: terminate the process and free its PID. */
export function killProcess(state: MachineState, pid: Pid): MachineState {
  const p = findProcess(state, pid);
  if (!p || p.state === "terminated") return state;

  const wasRunning = state.runningPid === pid;
  const next: MachineState = {
    ...state,
    processes: patchProcess(state.processes, pid, {
      state: "terminated",
      exitReason: "killed",
      completionTime: state.now,
      quantumUsed: 0,
    }),
    readyQueue: state.readyQueue.filter((q) => q !== pid),
    runningPid: wasRunning ? null : state.runningPid,
    stats: { ...state.stats, killed: state.stats.killed + 1 },
  };

  return withLog(next, {
    kind: "kill",
    pid,
    chip: "kill()",
    text: wasRunning
      ? `You closed ${p.name}. The kernel kills P${pid} mid-run and frees the CPU.`
      : `You closed ${p.name}. P${pid} is terminated and removed from the ready queue.`,
  });
}

/** Change a process's scheduling priority. */
export function setPriority(state: MachineState, pid: Pid, priority: number): MachineState {
  const p = findProcess(state, pid);
  if (!p || p.state === "terminated" || p.priority === priority) return state;
  const clamped = Math.max(1, Math.min(5, Math.round(priority)));

  let next: MachineState = {
    ...state,
    processes: patchProcess(state.processes, pid, { priority: clamped }),
  };

  // If the process is in the ready queue and we're using Priority scheduling, reorder
  if (state.policy === "priority" && p.state === "ready" && state.readyQueue.includes(pid)) {
    const byId = new Map(next.processes.map((x) => [x.pid, x]));
    next = { ...next, readyQueue: reorderReadyQueue(next, next.readyQueue, byId) };
  }

  return withLog(next, {
    kind: "priority",
    pid,
    text: `P${pid} (${p.name}) priority changed ${p.priority} → ${clamped}. Lower number means more important.`,
  });
}

/** Change the Round Robin time slice. Takes effect on the next dispatch. */
export function setQuantum(state: MachineState, quantum: number): MachineState {
  const clamped = Math.max(QUANTUM_MIN, Math.min(QUANTUM_MAX, Math.round(quantum)));
  if (clamped === state.quantum) return state;

  const next: MachineState = { ...state, quantum: clamped };
  return withLog(next, {
    kind: "config",
    text: `Time slice set to ${clamped} ms. Each process now gets ${clamped} ms before being rotated.`,
  });
}

export function setPolicy(state: MachineState, policy: Policy): MachineState {
  if (policy === state.policy) return state;

  let next: MachineState = { ...state, policy };

  // Reorder the ready queue under the new policy
  if (next.readyQueue.length > 0) {
    const byId = new Map(next.processes.map((x) => [x.pid, x]));
    next = { ...next, readyQueue: reorderReadyQueue(next, next.readyQueue, byId) };
  }

  return withLog(next, {
    kind: "config",
    text: `Scheduling policy set to ${policy.toUpperCase()}.`,
  });
}

/* ------------------------------------------------------------------ *
 * The clock
 * ------------------------------------------------------------------ */

/**
 * SRTF preemption check: if a ready process has strictly less remaining time
 * than the currently running process, preempt the running one.
 * Returns the new ready queue if preemption happened, null otherwise.
 */
function checkPreemption(
  policy: Policy,
  prev: MachineState,
  running: Pcb,
  readyQueue: Pid[],
  byId: Map<Pid, Pcb>,
): Pid[] | null {
  if (policy !== "srtf" || readyQueue.length === 0) return null;

  const best = readyQueue[0];
  const bestProc = byId.get(best);
  if (!bestProc) return null;

  if (bestProc.burstRemaining < running.burstRemaining) {
    // Preempt running: put it back in ready queue, re-order, dispatch will pick new head next tick
    const newQueue = [...readyQueue, running.pid];
    return reorderReadyQueue(prev, newQueue, byId);
  }
  return null;
}

/**
 * Which ready process runs next. Implements all five textbook policies.
 * The ready queue is ordered *before* this call so that `chooseNext` can just
 * pick the first element. Ordering is maintained in `admission` and `preemption`.
 */
function chooseNext(readyQueue: Pid[]): Pid | undefined {
  if (readyQueue.length === 0) return undefined;
  return readyQueue[0];
}

/**
 * Re-order the ready queue according to the active policy. Called after any
 * change that affects scheduling order: new admission, quantum expiry,
 * SRTF preemption check, priority change.
 */
function reorderReadyQueue(state: MachineState, queue: Pid[], byId: Map<Pid, Pcb>): Pid[] {
  const procs = queue.map((pid) => byId.get(pid)!).filter((p): p is Pcb => !!p);

  switch (state.policy) {
    case "rr":
    case "fcfs":
      return queue; // FIFO arrival order

    case "sjf": {
      // Shortest Job First — non-preemptive, uses total burst
      const sorted = [...procs].sort((a, b) =>
        a.burstTotal !== b.burstTotal ? a.burstTotal - b.burstTotal : a.arrivalTime - b.arrivalTime
      );
      return sorted.map((p) => p.pid);
    }

    case "srtf": {
      // Shortest Remaining Time First — preemptive, uses remaining burst
      const sorted = [...procs].sort((a, b) =>
        a.burstRemaining !== b.burstRemaining
          ? a.burstRemaining - b.burstRemaining
          : a.arrivalTime - b.arrivalTime
      );
      return sorted.map((p) => p.pid);
    }

    case "priority": {
      // Priority — non-preemptive, lower number = higher priority
      const sorted = [...procs].sort((a, b) =>
        a.priority !== b.priority ? a.priority - b.priority : a.arrivalTime - b.arrivalTime
      );
      return sorted.map((p) => p.pid);
    }

    default:
      return queue;
  }
}

/**
 * Advance simulated time by exactly one millisecond.
 *
 * Order matters and mirrors how a real kernel behaves at a timer interrupt:
 *   1. admit newly created processes (New → Ready)
 *   2. dispatch if the CPU is free (Ready → Running)
 *   3. run for one tick, then either exit, or run out of quantum and rotate
 *
 * A process admitted during this tick is deliberately *not* eligible for
 * dispatch until the next tick. That one-tick gap is what makes the
 * New → Ready → Running chain visible instead of instantaneous.
 */
export function tick(prev: MachineState): MachineState {
  const now = prev.now + 1;
  let processes = prev.processes;
  let readyQueue = prev.readyQueue;
  let runningPid = prev.runningPid;
  let gantt = prev.gantt;
  let stats = prev.stats;
  let log = prev.log;
  let nextEventId = prev.nextEventId;
  const admittedThisTick = new Set<Pid>();

  const emit = (e: Omit<KernelEvent, "id" | "t">) => {
    log = [...log, { ...e, id: nextEventId++, t: now }];
    if (log.length > MAX_LOG) log = log.slice(log.length - MAX_LOG);
  };
  const patch = (pid: Pid, changes: Partial<Pcb>) => {
    processes = patchProcess(processes, pid, changes);
  };
  const get = (pid: Pid) => processes.find((p) => p.pid === pid);

  /* 1. Admission — a brand new process joins the ready queue. */
  const byId = new Map(processes.map((p) => [p.pid, p]));
  for (const p of processes) {
    if (p.state === "new" && p.admitAt <= now) {
      patch(p.pid, { state: "ready", burstAtReady: p.burstRemaining });
      readyQueue = [...readyQueue, p.pid];
      admittedThisTick.add(p.pid);
      emit({
        kind: "admit",
        pid: p.pid,
        text: `${p.name} (P${p.pid}) moved New → Ready. It is now waiting in the ready queue.`,
      });
    }
  }

  // Re-order the queue after all admissions for this tick
  readyQueue = reorderReadyQueue(prev, readyQueue, byId);

  /* 2. Dispatch — give the CPU to the head of the ready queue. */
  if (runningPid === null) {
    const eligible = readyQueue.filter((pid) => !admittedThisTick.has(pid));
    const next = chooseNext(eligible);
    if (next !== undefined) {
      const idx = readyQueue.indexOf(next);
      readyQueue = [...readyQueue.slice(0, idx), ...readyQueue.slice(idx + 1)];
      runningPid = next;
      const p = get(next);
      if (p) {
        patch(next, {
          state: "running",
          quantumUsed: 0,
          firstRunTime: p.firstRunTime ?? now,
        });
        stats = { ...stats, contextSwitches: stats.contextSwitches + 1 };
        const note =
          prev.policy === "rr"
            ? `It runs for up to ${prev.quantum} ms.`
            : prev.policy === "fcfs"
            ? `It runs to completion (FCFS).`
            : prev.policy === "sjf"
            ? `It runs to completion — shortest job first.`
            : prev.policy === "srtf"
            ? `It runs — shortest remaining time first.`
            : `It runs — highest priority first.`;
        emit({
          kind: "dispatch",
          pid: next,
          text: `Dispatcher picks P${next} (${p.name}). ${note}`,
        });
      }
    }
  }

  /* 3. Execute for one tick. */
  if (runningPid !== null) {
    const p = get(runningPid);
    if (!p) {
      runningPid = null;
    } else {
      const remaining = p.burstRemaining - 1;
      const used = p.quantumUsed + 1;
      stats = { ...stats, busyTicks: stats.busyTicks + 1 };

      const last: GanttSlice | undefined = gantt[gantt.length - 1];
      if (last && last.pid === p.pid && last.end === now - 1) {
        gantt = [...gantt.slice(0, -1), { ...last, end: now }];
      } else {
        gantt = [...gantt, { pid: p.pid, start: now - 1, end: now }];
      }

      if (remaining <= 0) {
        patch(p.pid, {
          burstRemaining: 0,
          quantumUsed: 0,
          state: "terminated",
          completionTime: now,
          exitReason: "completed",
        });
        runningPid = null;
        stats = { ...stats, completed: stats.completed + 1 };
        emit({
          kind: "exit",
          pid: p.pid,
          chip: "exit()",
          text: `${p.name} (P${p.pid}) finished all its work and exited. Its memory and PID are released.`,
        });
      } else {
        const newQueue = checkPreemption(prev.policy, prev, p, readyQueue, byId);
        if (newQueue) {
          // SRTF preemption
          patch(p.pid, { burstRemaining: remaining, state: "ready", quantumUsed: 0 });
          readyQueue = newQueue;
          runningPid = null;
          stats = { ...stats, contextSwitches: stats.contextSwitches + 1 };
          emit({
            kind: "preempt",
            pid: p.pid,
            text: `P${p.pid} preempted — P${readyQueue[0]} now has less remaining time (SRTF).`,
          });
        } else if (prev.policy === "rr" && used >= prev.quantum) {
          patch(p.pid, { burstRemaining: remaining, state: "ready", quantumUsed: 0 });
          readyQueue = [...readyQueue, p.pid];
          runningPid = null;
          stats = { ...stats, quantumExpiries: stats.quantumExpiries + 1 };
          emit({
            kind: "preempt",
            pid: p.pid,
            text: `P${p.pid} used its full ${prev.quantum} ms quantum — preempted and sent to the back of the queue.`,
          });
        } else {
          patch(p.pid, { burstRemaining: remaining, quantumUsed: used });
        }
      }
    }
  }

  return {
    ...prev,
    now,
    processes,
    readyQueue,
    runningPid,
    gantt,
    stats,
    log,
    nextEventId,
  };
}

/** Run the clock forward n ticks. */
export function advance(prev: MachineState, ticks: number): MachineState {
  let state = prev;
  for (let i = 0; i < ticks; i++) state = tick(state);
  return state;
}

/* ------------------------------------------------------------------ *
 * Selectors — derived numbers, never stored
 * ------------------------------------------------------------------ */

export interface ProcessMetrics {
  pid: Pid;
  name: string;
  arrival: number;
  burst: number;
  completion: number;
  turnaround: number;
  waiting: number;
}

/**
 * Turnaround = completion − arrival.
 * Waiting    = turnaround − burst − time spent blocked.
 * Deriving waiting instead of accumulating it keeps the identity exact, which
 * matters when a student checks the numbers by hand.
 */
export function metricsFor(p: Pcb): ProcessMetrics | null {
  if (p.completionTime === null) return null;
  const turnaround = p.completionTime - p.arrivalTime;
  const waiting = Math.max(0, turnaround - p.burstTotal - p.blockedTime);
  return {
    pid: p.pid,
    name: p.name,
    arrival: p.arrivalTime,
    burst: p.burstTotal,
    completion: p.completionTime,
    turnaround,
    waiting,
  };
}

export interface LiveMetrics {
  /** CPU time actually received so far. */
  service: number;
  /** Simulated ms still owed. */
  remaining: number;
  /** Time spent finished-with-the-CPU minus CPU time received. */
  waiting: number;
  /** Time since arrival — final value once the process has exited. */
  turnaround: number;
  finished: boolean;
}

/**
 * The same numbers, but available *while the process is still running*, so the
 * waiting-time column in the UI visibly climbs instead of appearing at the end.
 */
export function metricsAt(p: Pcb, now: number): LiveMetrics {
  const service = p.burstTotal - p.burstRemaining;
  const elapsed = (p.completionTime ?? now) - p.arrivalTime;
  return {
    service,
    remaining: p.burstRemaining,
    waiting: Math.max(0, elapsed - service - p.blockedTime),
    turnaround: elapsed,
    finished: p.completionTime !== null,
  };
}

export function averageMetrics(processes: Pcb[]): {
  avgWaiting: number;
  avgTurnaround: number;
  count: number;
} {
  // Only processes that ran to completion give a comparable textbook average;
  // a process you killed halfway never had a fair waiting time.
  const rows = processes
    .filter((p) => p.exitReason === "completed")
    .map(metricsFor)
    .filter((m): m is ProcessMetrics => m !== null);
  if (rows.length === 0) return { avgWaiting: 0, avgTurnaround: 0, count: 0 };
  const sumW = rows.reduce((a, m) => a + m.waiting, 0);
  const sumT = rows.reduce((a, m) => a + m.turnaround, 0);
  return {
    avgWaiting: sumW / rows.length,
    avgTurnaround: sumT / rows.length,
    count: rows.length,
  };
}

export function cpuUtilization(state: MachineState): number {
  if (state.now === 0) return 0;
  return state.stats.busyTicks / state.now;
}

/** True when nothing is left to run — the UI uses this to auto-pause the clock. */
export function isIdle(state: MachineState): boolean {
  return state.processes.every((p) => p.state === "terminated");
}

export function stateCounts(state: MachineState): Record<ProcessState, number> {
  const counts: Record<ProcessState, number> = {
    new: 0,
    ready: 0,
    running: 0,
    waiting: 0,
    terminated: 0,
  };
  for (const p of state.processes) counts[p.state]++;
  return counts;
}
