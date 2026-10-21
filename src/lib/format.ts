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

/**
 * Terminal glyph for each state. Monochrome means shape carries the meaning:
 * `running` is reverse-video, `waiting` is drawn dim, the rest read as marks.
 */
export const STATE_GLYPH: Record<ProcessState, string> = {
  new: "·",
  ready: "→",
  running: "▶",
  waiting: "⏸",
  terminated: "✓",
};

export const STATE_ORDER: ProcessState[] = ["new", "ready", "running", "waiting", "terminated"];

interface StateTint {
  /** Fill for a pill/chip. */
  bg: string;
  /** Text drawn on top of `bg`. */
  fg: string;
  /** Standalone text colour on the dark ground (counters, table cells). */
  ink: string;
  glyph: string;
}

/**
 * Background/foreground sets for state pills, so all views agree. There are no
 * hues here on purpose — running is the only filled state, which is exactly the
 * terminal idiom for "has the CPU".
 */
export const STATE_TINT: Record<ProcessState, StateTint> = {
  new: { bg: "transparent", fg: "#8a8a8a", ink: "#8a8a8a", glyph: "·" },
  ready: { bg: "transparent", fg: "#e6e6e6", ink: "#e6e6e6", glyph: "→" },
  running: { bg: "#e6e6e6", fg: "#000000", ink: "#ffffff", glyph: "▶" },
  waiting: { bg: "transparent", fg: "#b8b8b8", ink: "#b8b8b8", glyph: "⏸" },
  terminated: { bg: "transparent", fg: "#5c5c5c", ink: "#5c5c5c", glyph: "✓" },
};

/**
 * Seven-step grey ramp. Process identity used to be a hue; in a monochrome UI
 * it becomes a brightness plus the always-visible PID label. The steps stay
 * light enough to be legible as text on the #050505 ground.
 */
export const PROC_RAMP = [
  "#ffffff",
  "#e0e0e0",
  "#c4c4c4",
  "#a8a8a8",
  "#949494",
  "#808080",
  "#6e6e6e",
] as const;

export function formatMs(t: number): string {
  return `${t} ms`;
}

export function formatClock(t: number): string {
  return `T+${t} ms`;
}

/** Zero-padded variant used by the status bar and console. */
export function formatClockPadded(t: number): string {
  return `T+${String(t).padStart(4, "0")}`;
}

export function formatPercent(x: number): string {
  return `${Math.round(x * 100)}%`;
}

export function formatAverage(x: number): string {
  return Number.isInteger(x) ? `${x}` : x.toFixed(1);
}

/** Fallback grey when a process has already left the process table. */
export function pidColor(pid: number): string {
  return PROC_RAMP[(pid - 1) % PROC_RAMP.length];
}

/**
 * Black or off-white ink for text drawn on top of a fill. Keeps Gantt labels
 * readable whichever step of the grey ramp a process drew.
 */
export function inkFor(hex: string): string {
  const v = Number.parseInt(hex.replace("#", ""), 16);
  if (!Number.isFinite(v)) return "#e6e6e6";
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? "#000000" : "#e6e6e6";
}
