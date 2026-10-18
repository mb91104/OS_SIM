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
});
