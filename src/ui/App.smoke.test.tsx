import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { useMachine } from "../state/useMachine";
import { useUi } from "../state/useUi";

/**
 * Integration smoke tests: mount the whole shell in jsdom against the real
 * stores. These catch the wiring mistakes kernel unit tests cannot see —
 * and they are the reason we render for real rather than with renderToString,
 * which would only ever show the stores' initial state.
 */

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function html(): string {
  return container.innerHTML;
}

/** Run a store change and let React re-render. */
function interact(fn: () => void): string {
  act(() => {
    fn();
  });
  return html();
}

beforeEach(() => {
  useMachine.getState().reset();
  useUi.getState().closeAll();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<App />);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("ToyOS shell", () => {
  it("renders the desktop, dock, timeline and X-ray panel", () => {
    const markup = html();
    expect(markup).toContain("ToyOS");
    expect(markup).toContain("An empty desktop");
    expect(markup).toContain("CPU timeline");
    expect(markup).toContain("Click an app to launch it.");
    expect(markup).toContain("Task Manager");
    expect(markup).toContain("CPU core");
    expect(markup).toContain("ToyOS booted");
    expect(markup).toContain("Nothing is running yet");
  });

  it("launching an app shows it in the dock, the Task Manager and the kernel's records", () => {
    let pid = 0;
    const markup = interact(() => {
      pid = useMachine.getState().launch("browser");
      useUi.getState().openApp(pid, "browser");
      useMachine.getState().advanceTicks(3);
    });

    const state = useMachine.getState().live;
    expect(state.processes).toHaveLength(1);
    expect(state.runningPid).toBe(pid);

    // User-facing vocabulary, on the CPU tab by default.
    expect(markup).toContain("Browser");
    expect(markup).toContain("ms ·");
    expect(markup).toContain("CPU core");
    expect(markup).toContain("Running");
    expect(markup).toContain(`P${pid}`);
    expect(markup).not.toContain("An empty desktop");

    // The kernel's raw records live on their own tab.
    const processes = interact(() => useUi.getState().setXrayTab("processes"));
    expect(processes).toContain("PCB records");
    expect(processes).toContain("Context switches");

    // Clicking a process jumps to the Inspector and explains it in words.
    const inspector = interact(() => useUi.getState().select(pid));
    expect(useUi.getState().xrayTab).toBe("inspector");
    expect(inspector).toContain("Bursty work");
    expect(inspector).toContain("On the CPU right now");
  });

  it("the scrubber replays New → Ready → Running", () => {
    interact(() => {
      const pid = useMachine.getState().launch("music");
      useUi.getState().openApp(pid, "music");
      useMachine.getState().advanceTicks(20);
    });

    // History is: [boot, launch, tick1, tick2, ...]
    const at = (index: number) => {
      act(() => useMachine.getState().seek(index));
      const past = useMachine.getState().history[index];
      return { markup: html(), state: past };
    };

    expect(at(1).state.processes[0].state).toBe("new");
    expect(at(2).state.processes[0].state).toBe("ready");
    expect(at(3).state.processes[0].state).toBe("running");
    expect(at(3).state.now).toBe(2);

    const rewound = at(1).markup;
    expect(rewound).toContain("Viewing the past");
    expect(rewound).not.toContain("badge--live");

    act(() => useMachine.getState().goLive());
    expect(html()).toContain("badge--live");
    expect(useMachine.getState().live.now).toBe(20);
  });

  it("keeps one history snapshot per simulated millisecond", () => {
    interact(() => {
      useMachine.getState().launch("files");
      useMachine.getState().advanceTicks(30);
    });

    const store = useMachine.getState();
    // boot + launch + 30 ticks
    expect(store.history).toHaveLength(32);
    expect(store.viewIndex).toBe(31);
    expect(store.history[store.viewIndex].now).toBe(30);
    expect(store.history[store.viewIndex].processes[0].burstTotal).toBeGreaterThan(0);
  });

  it("killing a process frees the PID, shows Exited, and empties the Task Manager", () => {
    const markup = interact(() => {
      const pid = useMachine.getState().launch("camera");
      useUi.getState().openApp(pid, "camera");
      useMachine.getState().advanceTicks(5);
    });
    expect(markup).toContain("Records video in real time");

    const after = interact(() => useMachine.getState().kill(1));
    const state = useMachine.getState().live;

    expect(state.runningPid).toBeNull();
    expect(state.processes[0].state).toBe("terminated");
    expect(state.stats.killed).toBe(1);
    // The app window is gone, the kernel's record of P1 remains.
    expect(after).not.toContain('aria-label="Camera window"');
    expect(after).not.toContain("window__progress");
    expect(after).toContain("Exited");
    expect(after).toContain("Nothing is running yet");
  });

  it("changing the time slice is a visible kernel decision", () => {
    const markup = interact(() => {
      useMachine.getState().launch("code");
      useMachine.getState().setQuantum(30);
      useMachine.getState().advanceTicks(2);
    });
    expect(markup).toContain("30 ms");
    expect(markup).toContain("Time slice set to 30 ms");
  });

  it("drives the disk head and reports the seek total", () => {
    interact(() => {
      useMachine.getState().setDiskPolicy("sstf");
      for (const c of [98, 183, 37, 122, 14, 124, 65, 67]) {
        useMachine.getState().requestCylinder(c);
      }
      useUi.getState().setXrayTab("disk");
    });

    const queued = html();
    expect(queued).toContain("Disk head");
    expect(queued).toContain("Seek accounting");
    expect(queued).toContain("8 waiting");
    expect(queued).toContain("Textbook queue");
    expect(queued).toContain("Filesystem");

    const drained = interact(() => useMachine.getState().drainDisk());
    expect(useMachine.getState().live.disk.totalSeekTime).toBe(236);
    expect(useMachine.getState().live.disk.queue).toHaveLength(0);
    expect(drained).toContain("236");
  });

  it("shows the frame table, paging stats and live memory controls", () => {
    interact(() => {
      const pid = useMachine.getState().launch("photos");
      useUi.getState().openApp(pid, "photos");
      useMachine.getState().advanceTicks(5); // four cold page faults
      useUi.getState().setXrayTab("memory");
    });

    const markup = html();
    expect(markup).toContain("Physical memory");
    expect(markup).toContain("4/8 frames");
    expect(markup).toContain("Page faults");
    expect(markup).toContain("Frame 0");
    expect(useMachine.getState().live.memory.pageFaults).toBe(4);

    const after = interact(() => {
      useMachine.getState().setFrames(4);
      useMachine.getState().setReplacement("fifo");
    });
    expect(useMachine.getState().live.memory.frames).toHaveLength(4);
    expect(useMachine.getState().live.memory.replacement).toBe("fifo");
    expect(after).toContain("4/4 frames");
    expect(after).toContain("Memory resized to 4 frames");
  });

  it("queues a second printer and shows the device wait", () => {
    interact(() => {
      useMachine.getState().launch("printer");
      useMachine.getState().launch("printer");
      useMachine.getState().advanceTicks(2);
      useUi.getState().setXrayTab("devices");
    });

    const state = useMachine.getState().live;
    expect(state.processes[1].state).toBe("waiting");
    expect(state.processes[1].waitingFor).toBe("printer");

    const markup = html();
    expect(markup).toContain("Devices");
    expect(markup).toContain("1/1 in use");
    expect(markup).toContain("Deadlock sandbox");
    expect(markup).toContain("Printer");
  });

  it("surfaces a deadlock and lets the user break it", () => {
    interact(() => {
      useMachine.getState().launch("printer");
      useMachine.getState().launch("camera");
      useMachine.getState().advanceTicks(2);
      useMachine.getState().requestDevice(1, "camera");
      useMachine.getState().requestDevice(2, "printer");
      useUi.getState().setXrayTab("devices");
    });

    expect(useMachine.getState().live.deadlock?.sort()).toEqual([1, 2]);
    expect(html()).toContain("Deadlock.");

    const after = interact(() => useMachine.getState().kill(1));
    expect(useMachine.getState().live.deadlock).toBeNull();
    expect(after).not.toContain("Deadlock.");
  });

  it("creates, reads and deletes a real file from the Files app", () => {
    interact(() => {
      const pid = useMachine.getState().launch("files");
      useUi.getState().openApp(pid, "files");
      useMachine.getState().advanceTicks(2);
    });
    expect(html()).toContain("blocks used");

    const created = interact(() => useMachine.getState().createFile("notes.txt", 2));
    expect(created).toContain("notes.txt");
    expect(created).toContain("2 blocks");

    const read = interact(() => useMachine.getState().readFile("notes.txt"));
    expect(useMachine.getState().live.disk.queue).toHaveLength(2);
    expect(read).toContain("queued 2 block requests");

    const deleted = interact(() => useMachine.getState().deleteFile("notes.txt"));
    expect(deleted).not.toContain("📄 notes.txt");
    expect(deleted).toContain("The disk is empty. Create a file below.");
  });
});
