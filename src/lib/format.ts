import type { ProcessState } from "../kernel/types";

/** Short label used in tables and chips. */
export const STATE_LABEL: Record<ProcessState, string> = {
  new: "New",
  ready: "Ready",
  running: "Running",
  waiting: "Waiting",
  terminated: "Exited",
};

/**
 * The same five states, phrased the way a student would say them out loud.
 * Every piece of jargon in the UI gets one of these.
 */
export const STATE_FRIENDLY: Record<ProcessState, string> = {
  new: "Just created — not admitted yet",
  ready: "Waiting its turn for the CPU",
  running: "On the CPU right now",
  waiting: "Blocked, waiting on a device",
  terminated: "Finished — memory and PID released",
};

export const STATE_ORDER: ProcessState[] = ["new", "ready", "running", "waiting", "terminated"];

/** Background/foreground pair for state pills, so all views agree on the colours. */
export const STATE_TINT: Record<ProcessState, { bg: string; fg: string }> = {
  new: { bg: "rgba(139, 92, 246, 0.18)", fg: "#c4b5fd" },
  ready: { bg: "rgba(91, 140, 255, 0.18)", fg: "#a9bcff" },
  running: { bg: "rgba(52, 211, 153, 0.18)", fg: "#6ee7b7" },
  waiting: { bg: "rgba(251, 191, 36, 0.18)", fg: "#fcd34d" },
  terminated: { bg: "rgba(111, 124, 173, 0.18)", fg: "#97a3cf" },
};

export function formatMs(t: number): string {
  return `${t} ms`;
}

export function formatClock(t: number): string {
  return `T+${t} ms`;
}

export function formatPercent(x: number): string {
  return `${Math.round(x * 100)}%`;
}

export function formatAverage(x: number): string {
  return Number.isInteger(x) ? `${x}` : x.toFixed(1);
}

/** Fallback colour when a process has already left the process table. */
export function pidColor(pid: number): string {
  const palette = [
    "#4aa8ff",
    "#8b5cf6",
    "#f472b6",
    "#fbbf24",
    "#34d399",
    "#22d3ee",
    "#fb7185",
    "#a3e635",
  ];
  return palette[(pid - 1) % palette.length];
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
