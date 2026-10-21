import type { Pid } from "./types";

/**
 * The app catalogue. Clicking a launch cell on the Dock starts one of these as
 * a process. Names are deliberately the kind of apps a 16-year-old already uses,
 * so the abstraction lands before the terminology does.
 *
 * `burst` is the range of CPU time (in simulated ms) the app needs — drawn from
 * the seeded RNG so every run is reproducible. `memPages` is the process's
 * working-set size; `device` is the single-instance resource it needs.
 *
 * `tag` replaces a GUI icon and `color` is one step of the monochrome grey ramp.
 */
export interface AppDef {
  id: string;
  name: string;
  /** Three-letter terminal tag shown where a GUI would put an icon. */
  tag: string;
  /**
   * One step of the monochrome grey ramp (see PROC_RAMP in lib/format). The
   * kernel copies this onto the PCB, so identity stays a brightness, not a hue.
   */
  color: string;
  blurb: string;
  burst: [number, number];
  memPages: number;
  /** Default scheduling priority: 1 is the highest. */
  priority: number;
  /** Single-instance device this app needs. */
  device?: "printer" | "camera" | "speakers";
}

export const APPS: AppDef[] = [
  {
    id: "browser",
    name: "Browser",
    tag: "NET",
    color: "#ffffff",
    blurb: "Loads web pages. Bursty work: lots of waiting, then a big crunch.",
    burst: [70, 110],
    memPages: 3,
    priority: 3,
  },
  {
    id: "music",
    name: "Music Player",
    tag: "SND",
    color: "#e0e0e0",
    blurb: "Decodes audio continuously. Needs the CPU regularly or the sound stutters.",
    burst: [40, 60],
    memPages: 1,
    priority: 2,
    device: "speakers",
  },
  {
    id: "photos",
    name: "Photos",
    tag: "IMG",
    color: "#c4c4c4",
    blurb: "Applies filters to images. Heavy on both CPU and memory.",
    burst: [90, 130],
    memPages: 4,
    priority: 4,
  },
  {
    id: "files",
    name: "Files",
    tag: "FS",
    color: "#a8a8a8",
    blurb: "Copies and moves files. Short CPU bursts, but a lot of disk traffic.",
    burst: [30, 50],
    memPages: 2,
    priority: 3,
  },
  {
    id: "printer",
    name: "Printer",
    tag: "PRN",
    color: "#949494",
    blurb: "Prints a document. Must own the printer device while it works.",
    burst: [50, 80],
    memPages: 2,
    priority: 4,
    device: "printer",
  },
  {
    id: "code",
    name: "Code Editor",
    tag: "IDE",
    color: "#808080",
    blurb: "Compiles and re-compiles your project. Long CPU bursts.",
    burst: [100, 140],
    memPages: 3,
    priority: 2,
  },
  {
    id: "camera",
    name: "Camera",
    tag: "CAM",
    color: "#6e6e6e",
    blurb: "Records video in real time. If it waits too long, frames get dropped.",
    burst: [60, 90],
    memPages: 3,
    priority: 1,
    device: "camera",
  },
];

const BY_ID = new Map(APPS.map((a) => [a.id, a]));

export function getApp(appId: string): AppDef {
  const app = BY_ID.get(appId);
  if (!app) throw new Error(`Unknown app: ${appId}`);
  return app;
}

/** The app a running process is an instance of; falls back gracefully. */
export function appForPid(appId: string): AppDef | undefined {
  return BY_ID.get(appId);
}

/** The terminal tag for an app, with a sane fallback for unknown ids. */
export function appTag(appId: string): string {
  return BY_ID.get(appId)?.tag ?? "---";
}

export function shortPid(pid: Pid): string {
  return `P${pid}`;
}
