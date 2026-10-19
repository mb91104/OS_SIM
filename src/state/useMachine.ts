import { create } from "zustand";
import {
  tick as advanceNext,
  createMachine,
  isIdle,
  killProcess,
  launchApp,
  setPolicy as setPolicyFn,
  setPriority,
  setQuantum as setQuantumFn,
  setFrames as setFramesFn,
  setReplacement as setReplacementFn,
  diskRequest as diskRequestFn,
  diskStep as diskStepFn,
  diskDrain as diskDrainFn,
  diskClear as diskClearFn,
  diskReset as diskResetFn,
  setDiskPolicy as setDiskPolicyFn,
} from "../kernel/machine";
import type { MachineState, Pid } from "../kernel/types";

/** Simulated milliseconds per real second at speed 1×. */
export const BASE_TICKS_PER_SECOND = 8;

/** How many ticks of history we keep for rewinding. */
export const HISTORY_LIMIT = 2400;

export const DEFAULT_SEED = 20261018;

interface MachineStore {
  /** The newest state — the machine as it is right now. */
  live: MachineState;
  /** Snapshots, every single tick, newest last. `history.length - 1` is live. */
  history: MachineState[];
  /** Which snapshot the UI is currently rendering. */
  viewIndex: number;

  running: boolean;
  speed: number;

  /* clock */
  advanceTicks: (n: number) => void;
  tickOnce: () => void;
  step: () => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  setSpeed: (speed: number) => void;
  seek: (index: number) => void;
  goLive: () => void;

  /* syscalls */
  launch: (appId: string) => Pid;
  kill: (pid: Pid) => void;
  prioritise: (pid: Pid, priority: number) => void;
  setQuantum: (quantum: number) => void;
  setPolicy: (policy: import("../kernel/types").Policy) => void;
  setFrames: (frames: number) => void;
  setReplacement: (replacement: import("../kernel/memory").Replacement) => void;

  /* disk */
  setDiskPolicy: (policy: import("../kernel/disk").DiskPolicy) => void;
  requestCylinder: (cylinder: number) => void;
  stepDisk: () => void;
  drainDisk: () => void;
  clearDisk: () => void;
  resetDisk: () => void;

  reset: (seed?: number) => void;
}

function appendHistory(history: MachineState[], states: MachineState[]): MachineState[] {
  const merged = [...history, ...states];
  return merged.length > HISTORY_LIMIT ? merged.slice(merged.length - HISTORY_LIMIT) : merged;
}

const booted = createMachine({ seed: DEFAULT_SEED });

export const useMachine = create<MachineStore>()((set, get) => {
  /** Apply a state change and make it the new head of history. */
  const commit = (next: MachineState) => {
    const history = appendHistory(get().history, [next]);
    set({ live: next, history, viewIndex: history.length - 1 });
  };

  return {
    live: booted,
    history: [booted],
    viewIndex: 0,
    running: false,
    speed: 1,

    tickOnce: () => {
      get().advanceTicks(1);
    },

    advanceTicks: (n) => {
      if (n <= 0) return;
      const { live, history, running } = get();

      const frames: MachineState[] = [];
      let next = live;
      for (let i = 0; i < n; i++) {
        next = advanceNext(next);
        frames.push(next);
      }

      const nextHistory = appendHistory(history, frames);
      const finished = next.processes.length > 0 && isIdle(next);
      set({
        live: next,
        history: nextHistory,
        viewIndex: nextHistory.length - 1,
        running: finished ? false : running,
      });
    },

    step: () => {
      set({ running: false });
      get().tickOnce();
    },

    play: () => {
      const { live, history } = get();
      if (isIdle(live) && live.processes.length > 0) return;
      set({ running: true, viewIndex: history.length - 1 });
    },

    pause: () => set({ running: false }),

    togglePlay: () => {
      const { running } = get();
      if (running) get().pause();
      else get().play();
    },

    setSpeed: (speed) => set({ speed }),

    /** Scrub the timeline. Reviewing pauses the clock — the past is read-only. */
    seek: (index) => {
      const { history } = get();
      const clamped = Math.max(0, Math.min(history.length - 1, Math.round(index)));
      set({ viewIndex: clamped, running: false });
    },

    goLive: () => set({ viewIndex: get().history.length - 1, running: false }),

    launch: (appId) => {
      const state = get().live;
      const pid = state.nextPid;
      commit(launchApp(state, appId));
      return pid;
    },

    kill: (pid) => commit(killProcess(get().live, pid)),

    prioritise: (pid, priority) => commit(setPriority(get().live, pid, priority)),

    setQuantum: (quantum) => commit(setQuantumFn(get().live, quantum)),

    setPolicy: (policy) => commit(setPolicyFn(get().live, policy)),

    setFrames: (frames) => commit(setFramesFn(get().live, frames)),

    setReplacement: (replacement) => commit(setReplacementFn(get().live, replacement)),

    setDiskPolicy: (policy) => commit(setDiskPolicyFn(get().live, policy)),

    requestCylinder: (cylinder) => commit(diskRequestFn(get().live, cylinder)),

    stepDisk: () => commit(diskStepFn(get().live)),

    drainDisk: () => commit(diskDrainFn(get().live)),

    clearDisk: () => commit(diskClearFn(get().live)),

    resetDisk: () => commit(diskResetFn(get().live)),

    reset: (seed) => {
      const fresh = createMachine({ seed: seed ?? DEFAULT_SEED });
      set({ live: fresh, history: [fresh], viewIndex: 0, running: false });
    },
  };
});

/** The state currently on screen — live, or whatever the scrubber points at. */
export function useKernelState(): MachineState {
  return useMachine((s) => s.history[s.viewIndex]);
}

export function useIsLive(): boolean {
  return useMachine((s) => s.viewIndex === s.history.length - 1);
}
