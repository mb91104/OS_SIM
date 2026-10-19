import { create } from "zustand";
import type { Pid } from "../kernel/types";

export interface Win {
  id: string;
  kind: "app" | "taskmanager";
  appId: string;
  /** App windows belong to a process; the Task Manager does not. */
  pid?: Pid;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  minimized: boolean;
}

export interface Toast {
  id: number;
  text: string;
  tone: "info" | "done" | "killed";
}

export type XrayTab = "cpu" | "processes" | "memory" | "disk" | "devices" | "inspector";

/** Approximate width of the Desktop area, used to place windows sensibly. */
function desktopWidth(xrayOpen: boolean): number {
  const viewport = typeof window === "undefined" ? 1440 : window.innerWidth;
  return Math.max(320, viewport - (xrayOpen ? 462 : 26) - 24);
}

function viewportHeight(): number {
  return typeof window === "undefined" ? 900 : window.innerHeight;
}

const GAP = 12;
const TILE_COLS = 2;
/** How many windows get a tidy grid slot before they start stacking instead. */
const TILE_SLOTS = 4;

interface UiStore {
  windows: Win[];
  xrayOpen: boolean;
  xrayTab: XrayTab;
  selectedPid: Pid | null;
  toasts: Toast[];
  topZ: number;
  cascade: number;

  openApp: (pid: Pid, appId: string) => void;
  openTaskManager: () => void;
  closeWindow: (id: string) => void;
  closeWindowsForPid: (pid: Pid) => void;
  closeAll: () => void;
  focusWindow: (id: string) => void;
  moveWindow: (id: string, x: number, y: number) => void;
  toggleMinimize: (id: string) => void;
  setXrayOpen: (open: boolean) => void;
  setXrayTab: (tab: XrayTab) => void;
  select: (pid: Pid | null) => void;
  toast: (text: string, tone?: Toast["tone"]) => void;
  dismissToast: (id: number) => void;
}

const TASK_MANAGER: Win = {
  id: "taskmanager",
  kind: "taskmanager",
  appId: "taskmanager",
  x: 22,
  y: 22,
  w: 400,
  h: 390,
  z: 1,
  minimized: false,
};

let toastCounter = 1;

export const useUi = create<UiStore>()((set, get) => ({
  windows: [TASK_MANAGER],
  xrayOpen: true,
  xrayTab: "cpu",
  selectedPid: null,
  toasts: [],
  topZ: 1,
  cascade: 0,

  openApp: (pid, appId) => {
    const { topZ, xrayOpen, windows } = get();
    const desktop = desktopWidth(xrayOpen);

    /*
     * App windows are *tiled*, not cascaded. Seeing three progress bars fill in
     * rotation is the fastest way to feel Round Robin, and a pile of overlapping
     * windows hides exactly that.
     */
    const areaX = Math.max(0, Math.min(436, desktop * 0.42));
    const areaW = Math.max(250, desktop - areaX - GAP);
    const w = Math.max(240, Math.floor((areaW - GAP * (TILE_COLS - 1)) / TILE_COLS));
    const h = Math.max(212, Math.min(268, Math.floor((viewportHeight() - 500) / 2)));

    const index = windows.filter((win) => win.kind === "app").length;
    const tiled = index < TILE_SLOTS;
    const col = index % TILE_COLS;
    const row = Math.floor(index / TILE_COLS);
    const overflow = index - TILE_SLOTS;

    const win: Win = {
      id: `app-${pid}`,
      kind: "app",
      appId,
      pid,
      x: tiled ? areaX + col * (w + GAP) : Math.max(0, Math.min(areaX + (overflow % 3) * 28, desktop - w - 6)),
      y: tiled ? 18 + row * (h + GAP) : 18 + (overflow % 3) * 26,
      w,
      h,
      z: topZ + 1,
      minimized: false,
    };

    set({
      windows: [...windows, win],
      topZ: topZ + 1,
      cascade: index + 1,
      selectedPid: pid,
    });
  },

  openTaskManager: () => {
    const exists = get().windows.find((w) => w.id === "taskmanager");
    if (exists) {
      get().focusWindow("taskmanager");
      return;
    }
    const w = Math.min(TASK_MANAGER.w, desktopWidth(get().xrayOpen) - 12);
    set({
      windows: [...get().windows, { ...TASK_MANAGER, w, z: get().topZ + 1 }],
      topZ: get().topZ + 1,
    });
  },

  closeWindow: (id) => set({ windows: get().windows.filter((w) => w.id !== id) }),

  closeWindowsForPid: (pid) => set({ windows: get().windows.filter((w) => w.pid !== pid) }),

  /** Reboot returns the shell to its starting layout, not just an empty desktop. */
  closeAll: () =>
    set({
      windows: [{ ...TASK_MANAGER, z: 1 }],
      topZ: 1,
      cascade: 0,
      selectedPid: null,
      toasts: [],
      xrayTab: "cpu",
      xrayOpen: true,
    }),

  focusWindow: (id) => {
    const topZ = get().topZ + 1;
    set({
      topZ,
      windows: get().windows.map((w) => (w.id === id ? { ...w, z: topZ, minimized: false } : w)),
    });
  },

  moveWindow: (id, x, y) =>
    set({
      windows: get().windows.map((w) =>
        w.id === id ? { ...w, x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)) } : w,
      ),
    }),

  toggleMinimize: (id) =>
    set({
      windows: get().windows.map((w) => (w.id === id ? { ...w, minimized: !w.minimized } : w)),
    }),

  setXrayOpen: (open) => set({ xrayOpen: open }),

  setXrayTab: (tab) => set({ xrayTab: tab }),

  /** Selecting a process also brings its details to the front of the panel. */
  select: (pid) => set({ selectedPid: pid, ...(pid !== null ? { xrayTab: "inspector" as XrayTab } : {}) }),

  toast: (text, tone = "info") => {
    const id = toastCounter++;
    set({ toasts: [...get().toasts, { id, text, tone }] });
    setTimeout(() => get().dismissToast(id), 3400);
  },

  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));
