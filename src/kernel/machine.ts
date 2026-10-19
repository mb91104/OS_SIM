import { getApp } from "./catalog";
import {
  acquire,
  createDevices,
  deviceName,
  dropFromQueues,
  findDeadlock,
  release,
  releaseAll,
} from "./devices";
import {
  allocateFile,
  createFs,
  deleteFile as deleteFileFn,
  listFiles,
  readCylinders,
} from "./fs";
import {
  clearQueue as clearDiskQueue,
  createDisk,
  drainDisk,
  requestCylinder,
  resetDisk,
  setDiskPolicy as setDiskPolicyFn,
  stepDisk,
  type DiskPolicy,
} from "./disk";
import {
  accessPage,
  createMemory,
  DEFAULT_FRAMES,
  freeFramesFor,
  resizeFrames as resizeFramesFn,
  setReplacement as setReplacementFn,
} from "./memory";
import { randomInt } from "./rng";
import type { Replacement } from "./memory";
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
  /** Physical memory size, in frames. Defaults to 8. */
  frames?: number;
  replacement?: import("./memory").Replacement;
  /** Turn on printers/cameras/speakers. Off by default so scheduler tests stay exact. */
  devices?: boolean;
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
  const frames = opts.frames ?? DEFAULT_FRAMES;
  const boot: KernelEvent = {
    id: 0,
    t: 0,
    kind: "boot",
    text: `ToyOS booted. One CPU core, Round Robin scheduling, quantum ${
      opts.quantum ?? DEFAULT_QUANTUM
    } ms, ${frames} frames of memory. Click an app to start a process.`,
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
    memory: createMemory(frames, opts.replacement),
    disk: createDisk(),
    devices: createDevices(),
    devicesEnabled: opts.devices ?? false,
    deadlock: null,
    fs: createFs(),
    filesRead: 0,
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

/**
 * Move processes that were just handed a device from Waiting back to Ready.
 * Kept as a pure helper because both the clock and the device syscalls need it.
 */
function wakeWaiters(
  processes: Pcb[],
  readyQueue: Pid[],
  grants: { pid: Pid; deviceId: string }[],
): { processes: Pcb[]; readyQueue: Pid[] } {
  let nextProcesses = processes;
  let nextQueue = readyQueue;
  for (const grant of grants) {
    const waiting = nextProcesses.find((p) => p.pid === grant.pid);
    const held = waiting?.heldDevices ?? [];
    nextProcesses = patchProcess(nextProcesses, grant.pid, {
      state: "ready",
      waitingFor: null,
      heldDevices: held.includes(grant.deviceId) ? held : [...held, grant.deviceId],
    });
    if (!nextQueue.includes(grant.pid)) nextQueue = [...nextQueue, grant.pid];
  }
  return { processes: nextProcesses, readyQueue: nextQueue };
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
    heldDevices: [],
    waitingFor: null,
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
  const released = releaseAll(state.devices, pid);
  const devices = dropFromQueues(released.devices, pid);
  const woken = wakeWaiters(
    patchProcess(state.processes, pid, {
      state: "terminated",
      exitReason: "killed",
      completionTime: state.now,
      quantumUsed: 0,
      waitingFor: null,
      heldDevices: [],
    }),
    state.readyQueue.filter((q) => q !== pid),
    released.granted,
  );

  const next: MachineState = {
    ...state,
    processes: woken.processes,
    readyQueue: woken.readyQueue,
    runningPid: wasRunning ? null : state.runningPid,
    memory: freeFramesFor(state.memory, pid),
    devices,
    deadlock: state.devicesEnabled ? findDeadlock(devices) : null,
    stats: { ...state.stats, killed: state.stats.killed + 1 },
  };

  const handed = released.granted.length
    ? ` The freed device is handed to P${released.granted.map((g) => g.pid).join(", P")}.`
    : "";
  return withLog(next, {
    kind: "kill",
    pid,
    chip: "kill()",
    text: wasRunning
      ? `You closed ${p.name}. The kernel kills P${pid} mid-run, frees the CPU, takes back its ${p.memPages} pages of memory and releases its devices.${handed}`
      : `You closed ${p.name}. P${pid} is terminated, removed from the ready queue and its memory is freed.${handed}`,
  });
}

/* ------------------------------------------------------------------ *
 * Device syscalls
 * ------------------------------------------------------------------ */

/** Switch printers/cameras/speakers on or off. Off is the default. */
export function setDevicesEnabled(state: MachineState, enabled: boolean): MachineState {
  if (enabled === state.devicesEnabled) return state;

  if (enabled) {
    return withLog(
      { ...state, devicesEnabled: true, devices: createDevices(), deadlock: null },
      {
        kind: "config",
        text: "Devices switched on. Printer, Camera and Music Player now need their hardware before they can run.",
      },
    );
  }

  // Switching off is a reset: free every device and wake anyone who was queued.
  let processes: Pcb[] = state.processes.map((p) => ({
    ...p,
    heldDevices: [] as string[],
    waitingFor: null,
  }));
  let readyQueue = state.readyQueue;
  for (const p of state.processes) {
    if (p.state !== "waiting") continue;
    processes = patchProcess(processes, p.pid, { state: "ready" });
    if (!readyQueue.includes(p.pid)) readyQueue = [...readyQueue, p.pid];
  }

  return withLog(
    {
      ...state,
      devicesEnabled: false,
      devices: createDevices(),
      deadlock: null,
      processes,
      readyQueue,
    },
    {
      kind: "config",
      text: "Devices switched off. All hardware is freed and any blocked process goes back to Ready.",
    },
  );
}

/**
 * Ask for a device after a process is already running. This is the control the
 * Deadlock demo uses: a process can hold its own device and request another,
 * which makes a wait-for cycle possible.
 */
export function requestDevice(state: MachineState, pid: Pid, deviceId: string): MachineState {
  const p = findProcess(state, pid);
  if (!p || p.state === "terminated" || p.state === "new" || p.state === "waiting") return state;
  if (!state.devicesEnabled) return state;
  if (p.heldDevices.includes(deviceId)) return state;

  const taken = acquire(state.devices, deviceId, pid);
  let next: MachineState = { ...state, devices: taken.devices };

  if (taken.granted) {
    next = {
      ...next,
      processes: patchProcess(next.processes, pid, {
        heldDevices: [...p.heldDevices, deviceId],
      }),
    };
  } else {
    next = {
      ...next,
      processes: patchProcess(next.processes, pid, {
        state: "waiting",
        waitingFor: deviceId,
        quantumUsed: 0,
      }),
      readyQueue: next.readyQueue.filter((q) => q !== pid),
      runningPid: next.runningPid === pid ? null : next.runningPid,
    };
  }

  next = {
    ...next,
    deadlock: findDeadlock(next.devices),
  };

  const entries: Omit<KernelEvent, "id" | "t">[] = [
    taken.granted
      ? {
          kind: "device" as const,
          pid,
          chip: `open("${deviceId}")`,
          text: `P${pid} (${p.name}) acquired the ${deviceName(state.devices, deviceId)}.`,
        }
      : {
          kind: "device" as const,
          pid,
          chip: `open("${deviceId}")`,
          text: `P${pid} (${p.name}) wants the ${deviceName(state.devices, deviceId)}, but P${taken.holder} has it. P${pid} is now waiting.`,
        },
  ];
  if (next.deadlock && !state.deadlock) {
    entries.push({
      kind: "deadlock",
      chip: "deadlock",
      text: `Deadlock detected: ${next.deadlock.map((id) => `P${id}`).join(" and ")} are waiting for each other. Kill one of them to break the cycle.`,
    });
  }

  return withLog(next, ...entries);
}

/** Give a device back early (it will be handed to the next waiter). */
export function releaseDevice(state: MachineState, pid: Pid, deviceId: string): MachineState {
  const p = findProcess(state, pid);
  if (!p || !p.heldDevices.includes(deviceId)) return state;

  const outcome = release(state.devices, deviceId, pid);
  let next: MachineState = {
    ...state,
    devices: outcome.devices,
    processes: patchProcess(state.processes, pid, {
      heldDevices: p.heldDevices.filter((d) => d !== deviceId),
    }),
  };
  if (outcome.grantedTo !== null) {
    const woken = wakeWaiters(next.processes, next.readyQueue, [
      { pid: outcome.grantedTo, deviceId },
    ]);
    next = { ...next, processes: woken.processes, readyQueue: woken.readyQueue };
  }
  next = { ...next, deadlock: findDeadlock(next.devices) };

  return withLog(next, {
    kind: "device",
    pid,
    chip: `close("${deviceId}")`,
    text:
      outcome.grantedTo !== null
        ? `P${pid} released the ${deviceName(state.devices, deviceId)}. P${outcome.grantedTo} was next in line and is ready to run.`
        : `P${pid} released the ${deviceName(state.devices, deviceId)}.`,
  });
}

/* ------------------------------------------------------------------ *
 * Filesystem syscalls
 * ------------------------------------------------------------------ */

export function fsCreate(state: MachineState, name: string, blocks = 1): MachineState {
  const allocation = allocateFile(state.fs, name, blocks);
  if (!allocation) {
    return withLog(state, {
      kind: "fs",
      chip: `create("${name}")`,
      text: `Could not create "${name}". The name may already exist, or there is no contiguous free space left.`,
    });
  }
  return withLog(
    { ...state, fs: allocation.fs },
    {
      kind: "fs",
      chip: `create("${name}")`,
      text: `Created "${allocation.entry.name}" in blocks ${allocation.entry.start}–${
        allocation.entry.start + allocation.entry.blocks - 1
      } (${allocation.entry.blocks * 4} KB).`,
    },
  );
}

export function fsDelete(state: MachineState, name: string): MachineState {
  const nextFs = deleteFileFn(state.fs, name);
  if (nextFs === state.fs) return state;
  return withLog(
    { ...state, fs: nextFs },
    {
      kind: "fs",
      chip: `unlink("${name}")`,
      text: `Deleted "${name}". Its blocks are free again.`,
    },
  );
}

/** Reading a file turns each of its blocks into a disk request. */
export function fsRead(state: MachineState, name: string): MachineState {
  if (!listFiles(state.fs).some((f) => f.name === name)) {
    return withLog(state, {
      kind: "fs",
      chip: `read("${name}")`,
      text: `There is no file called "${name}".`,
    });
  }
  const cylinders = readCylinders(state.fs, name);
  let disk = state.disk;
  for (const cylinder of cylinders) disk = requestCylinder(disk, cylinder);
  return withLog(
    { ...state, disk, filesRead: state.filesRead + 1 },
    {
      kind: "fs",
      chip: `read("${name}")`,
      text: `Reading "${name}" queued ${cylinders.length} block request${
        cylinders.length === 1 ? "" : "s"
      } at cylinder${cylinders.length === 1 ? "" : "s"} ${cylinders.join(", ")}. Open the Disk tab to service them.`,
    },
  );
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
    next = { ...next, readyQueue: reorderReadyQueue(next.policy, next.readyQueue, byId) };
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
    next = { ...next, readyQueue: reorderReadyQueue(next.policy, next.readyQueue, byId) };
  }

  return withLog(next, {
    kind: "config",
    text: `Scheduling policy set to ${policy.toUpperCase()}.`,
  });
}

/** Change how many physical frames (4 KB each) the machine has. */
export function setFrames(state: MachineState, frames: number): MachineState {
  const next: MachineState = { ...state, memory: resizeFramesFn(state.memory, frames) };
  if (next.memory === state.memory) return state;
  return withLog(next, {
    kind: "memory",
    text: `Memory resized to ${next.memory.frames.length} frames — ${
      next.memory.frames.length * next.memory.pageSizeKb
    } KB of RAM.`,
  });
}

/** Choose the page replacement algorithm used when memory is full. */
export function setReplacement(state: MachineState, replacement: Replacement): MachineState {
  const next: MachineState = { ...state, memory: setReplacementFn(state.memory, replacement) };
  if (next.memory === state.memory) return state;
  return withLog(next, {
    kind: "memory",
    text: `Page replacement policy set to ${replacement.toUpperCase()}. When memory is full, the kernel will evict a page this way.`,
  });
}

/* ------------------------------------------------------------------ *
 * Disk syscalls — the Files app asking for blocks by cylinder
 * ------------------------------------------------------------------ */

export function diskRequest(state: MachineState, cylinder: number): MachineState {
  const next: MachineState = { ...state, disk: requestCylinder(state.disk, cylinder) };
  const c = next.disk.queue[next.disk.queue.length - 1];
  const waiting = next.disk.queue.length;
  return withLog(next, {
    kind: "disk",
    chip: `seek(${c})`,
    text: `A read request arrived for cylinder ${c}. The disk queue now holds ${waiting} request${
      waiting === 1 ? "" : "s"
    }.`,
  });
}

export function setDiskPolicy(state: MachineState, policy: DiskPolicy): MachineState {
  const next: MachineState = { ...state, disk: setDiskPolicyFn(state.disk, policy) };
  if (next.disk === state.disk) return state;
  return withLog(next, {
    kind: "config",
    text: `Disk scheduling policy set to ${policy.toUpperCase()}. Seek totals are reset so the policies compare fairly.`,
  });
}

/** Move the head to the next cylinder the policy chose. */
export function diskStep(state: MachineState): MachineState {
  const before = state.disk;
  const after = stepDisk(before);
  if (after === before) return state;
  const move = after.lastMove!;
  return withLog(
    { ...state, disk: after },
    {
      kind: "disk",
      text:
        move.kind === "sweep"
          ? `Disk head swept ${move.from} → ${move.to} (${move.seek} cylinders) and is turning around.`
          : `Disk head moved ${move.from} → ${move.to} (${move.seek} cylinders). ${after.queue.length} request${
              after.queue.length === 1 ? "" : "s"
            } still waiting.`,
    },
  );
}

/** Service the whole queue at once and report the total seek time. */
export function diskDrain(state: MachineState): MachineState {
  const after = drainDisk(state.disk);
  if (after.queue.length === state.disk.queue.length) return state;
  return withLog(
    { ...state, disk: after },
    {
      kind: "disk",
      text: `Disk queue drained in ${after.serviced.length} moves. Total seek time: ${after.totalSeekTime} cylinders.`,
    },
  );
}

export function diskClear(state: MachineState): MachineState {
  const next: MachineState = { ...state, disk: clearDiskQueue(state.disk) };
  if (next.disk === state.disk) return state;
  return withLog(next, { kind: "disk", text: "The pending disk requests were cleared." });
}

export function diskReset(state: MachineState): MachineState {
  return withLog(
    { ...state, disk: resetDisk(state.disk) },
    { kind: "disk", text: "Disk head parked and its request history forgotten." },
  );
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
  processes: Pcb[],
  running: Pcb,
  readyQueue: Pid[],
): Pid[] | null {
  if (policy !== "srtf" || readyQueue.length === 0) return null;

  const byId = new Map(processes.map((p) => [p.pid, p]));
  const bestProc = byId.get(readyQueue[0]);
  if (!bestProc) return null;

  if (bestProc.burstRemaining < running.burstRemaining) {
    // Preempt running: put it back in ready queue, re-order, dispatch will pick new head next tick
    const newQueue = [...readyQueue, running.pid];
    return reorderReadyQueue(policy, newQueue, byId);
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
 * How many ticks of a process's own CPU time will pass before it wants `page`
 * again. ToyOS gives every process a fixed, repeating page walk (0, 1, 2, …
 * back to 0), so this is exact for the running process — which is all Belady's
 * OPT needs to be correct in the classic single-process exercise, and a
 * reasonable forward estimate when several processes share memory.
 */
function nextUseDistance(p: Pcb, page: number): number {
  if (p.memPages <= 0) return Number.MAX_SAFE_INTEGER;
  const spent = p.burstTotal - p.burstRemaining;
  const current = spent % p.memPages;
  const d = (page - current + p.memPages) % p.memPages;
  return d === 0 ? p.memPages : d;
}

/**
 * Re-order the ready queue according to the active policy. Called after any
 * change that affects scheduling order: new admission, quantum expiry,
 * SRTF preemption check, priority change.
 */
function reorderReadyQueue(policy: Policy, queue: Pid[], byId: Map<Pid, Pcb>): Pid[] {
  const procs = queue.map((pid) => byId.get(pid)!).filter((p): p is Pcb => !!p);

  switch (policy) {
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
  let memory = prev.memory;
  let devices = prev.devices;
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
  /** Best-effort future knowledge, only consulted by the OPT policy. */
  const nextUse = (pid: Pid, page: number): number => {
    const proc = get(pid);
    return proc ? nextUseDistance(proc, page) : Number.MAX_SAFE_INTEGER;
  };

  /* 1. Admission — a brand new process joins the ready queue.
   *    When devices are on, an app that needs hardware must own it first.
   *    If somebody else has it, the process is admitted straight into Waiting
   *    instead of Ready — that is the state the student sees on the timeline. */
  const byId = new Map(processes.map((p) => [p.pid, p]));
  for (const p of processes) {
    if (p.state === "new" && p.admitAt <= now) {
      const app = getApp(p.appId);
      if (prev.devicesEnabled && app.device) {
        const taken = acquire(devices, app.device, p.pid);
        devices = taken.devices;
        if (!taken.granted) {
          patch(p.pid, { state: "waiting", waitingFor: app.device });
          emit({
            kind: "device",
            pid: p.pid,
            chip: `open("${app.device}")`,
            text: `${p.name} (P${p.pid}) needs the ${deviceName(devices, app.device)}, but P${taken.holder} has it. P${p.pid} is Waiting instead of Ready.`,
          });
          continue;
        }
        patch(p.pid, {
          heldDevices: [...p.heldDevices, app.device],
          waitingFor: null,
        });
        emit({
          kind: "device",
          pid: p.pid,
          chip: `open("${app.device}")`,
          text: `${p.name} (P${p.pid}) acquired the ${deviceName(devices, app.device)} and moved New → Ready.`,
        });
      }

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

  /* Blocked time is real time spent in the Waiting state. Accumulating it here
   * keeps `waiting = turnaround − burst − blockedTime` exact. */
  if (prev.devicesEnabled) {
    for (const p of processes) {
      if (p.state === "waiting") patch(p.pid, { blockedTime: p.blockedTime + 1 });
    }
  }

  // Re-order the queue after all admissions for this tick
  readyQueue = reorderReadyQueue(prev.policy, readyQueue, byId);

  /* 2. Dispatch — give the CPU to the head of the ready queue.
   *    A process admitted on this same tick is not eligible yet, and neither is
   *    anything behind it: the scheduler always obeys the head of the queue.
   *    That is what makes the New → Ready → Running chain visible instead of
   *    instantaneous, and it keeps the policy order honest under SRTF. */
  if (runningPid === null) {
    const head = readyQueue[0];
    const next = head !== undefined && !admittedThisTick.has(head) ? chooseNext(readyQueue) : undefined;
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

      /* The process works on the next page of its working set. It walks its
       * pages 0, 1, 2, … and back to 0 as it receives CPU time, so a page it
       * has not touched in a while may well have been paged out by now. */
      if (p.memPages > 0) {
        const page = (p.burstTotal - p.burstRemaining) % p.memPages;
        const access = accessPage(memory, p.pid, page, now, nextUse);
        memory = access.memory;
        if (!access.hit) {
          emit({
            kind: "fault",
            pid: p.pid,
            chip: "page fault",
            text: access.evicted
              ? `${p.name} (P${p.pid}) needed page ${page}, which was not in memory. Frame ${access.frameIndex} was reused: P${access.evicted.pid}'s page ${access.evicted.page} was evicted (${memory.replacement.toUpperCase()}).`
              : `${p.name} (P${p.pid}) needed page ${page}, which was not in memory. The kernel loaded it into free frame ${access.frameIndex}.`,
          });
        }
      }

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
        memory = freeFramesFor(memory, p.pid);
        const released = releaseAll(devices, p.pid);
        devices = released.devices;
        if (released.granted.length > 0) {
          const woken = wakeWaiters(processes, readyQueue, released.granted);
          processes = woken.processes;
          readyQueue = woken.readyQueue;
          emit({
            kind: "device",
            text: `P${p.pid} exited and released its devices. P${released.granted
              .map((g) => g.pid)
              .join(", P")} moved Waiting → Ready.`,
          });
        }
        emit({
          kind: "exit",
          pid: p.pid,
          chip: "exit()",
          text: `${p.name} (P${p.pid}) finished all its work and exited. Its memory and PID are released.`,
        });
      } else {
        // Persist this tick's work first, so the SRTF check compares the
        // running process's *current* remaining time against the queue head.
        patch(p.pid, { burstRemaining: remaining, quantumUsed: used });
        const updated = get(p.pid);
        const newQueue = updated
          ? checkPreemption(prev.policy, processes, updated, readyQueue)
          : null;
        if (newQueue) {
          // SRTF preemption
          patch(p.pid, { state: "ready", quantumUsed: 0 });
          readyQueue = newQueue;
          runningPid = null;
          stats = { ...stats, contextSwitches: stats.contextSwitches + 1 };
          emit({
            kind: "preempt",
            pid: p.pid,
            text: `P${p.pid} preempted — P${newQueue[0]} now has less remaining time (SRTF).`,
          });
        } else if (prev.policy === "rr" && used >= prev.quantum) {
          patch(p.pid, { state: "ready", quantumUsed: 0 });
          readyQueue = [...readyQueue, p.pid];
          runningPid = null;
          stats = { ...stats, quantumExpiries: stats.quantumExpiries + 1 };
          emit({
            kind: "preempt",
            pid: p.pid,
            text: `P${p.pid} used its full ${prev.quantum} ms quantum — preempted and sent to the back of the queue.`,
          });
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
    memory,
    devices,
    deadlock: prev.devicesEnabled ? findDeadlock(devices) : null,
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
