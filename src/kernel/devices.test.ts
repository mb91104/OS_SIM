import { describe, expect, it } from "vitest";
import {
  createMachine,
  killProcess,
  launchApp,
  requestDevice,
  setDevicesEnabled,
  tick,
  metricsFor,
} from "./machine";

function bootTwoPrinters() {
  let state = createMachine({ seed: 7, devices: true });
  state = launchApp(state, "printer", { burst: 3 });
  state = launchApp(state, "printer", { burst: 3 });
  return tick(state);
}

describe("devices", () => {
  it("keeps devices off by default so scheduling stays device-free", () => {
    let state = createMachine({ seed: 1 });
    state = launchApp(state, "printer", { burst: 3 });
    state = launchApp(state, "printer", { burst: 3 });
    state = tick(state);

    expect(state.processes.map((p) => p.state)).toEqual(["ready", "ready"]);
    expect(state.devicesEnabled).toBe(false);
  });

  it("admits a second owner of a single-instance device into Waiting", () => {
    const state = bootTwoPrinters();

    expect(state.processes[0].heldDevices).toEqual(["printer"]);
    expect(state.processes[1].state).toBe("waiting");
    expect(state.processes[1].waitingFor).toBe("printer");
    expect(state.devices[0].heldBy).toEqual([1]);
    expect(state.devices[0].waitQueue).toEqual([2]);
    expect(state.processes[1].blockedTime).toBe(1);
  });

  it("runs the waiting process after the holder exits", () => {
    let state = bootTwoPrinters();
    state = tick(state); // P1 dispatched and runs 1 ms
    expect(state.runningPid).toBe(1);

    state = tick(state); // 2 ms
    state = tick(state); // P1 finishes, printer handed to P2
    expect(state.processes[0].state).toBe("terminated");
    expect(state.processes[1].state).toBe("ready");
    expect(state.devices[0].heldBy).toEqual([2]);
    expect(state.devices[0].waitQueue).toEqual([]);

    state = tick(state); // P2 dispatched
    state = tick(state);
    state = tick(state);
    const p2 = state.processes[1];
    expect(p2.state).toBe("terminated");
    expect(p2.completionTime).toBe(7);
    expect(p2.blockedTime).toBe(4);

    const metrics = metricsFor(p2)!;
    expect(metrics.waiting).toBe(metrics.turnaround - metrics.burst - p2.blockedTime);
  });

  it("hands the device to the next waiter when the holder is killed", () => {
    let state = bootTwoPrinters();
    state = launchApp(state, "printer", { burst: 3 });
    state = tick(state); // P3 joins the printer queue
    expect(state.devices[0].waitQueue).toEqual([2, 3]);

    state = killProcess(state, 1);
    expect(state.devices[0].heldBy).toEqual([2]);
    expect(state.devices[0].waitQueue).toEqual([3]);
    expect(state.processes[1].state).toBe("ready");
    expect(state.processes[2].state).toBe("waiting");
  });

  it("detects a wait-for cycle and clears it when one holder is killed", () => {
    let state = createMachine({ seed: 3, devices: true });
    state = launchApp(state, "printer", { burst: 20 });
    state = launchApp(state, "camera", { burst: 20 });
    state = tick(state); // both acquire their own device
    state = tick(state); // P1 dispatched and running
    expect(state.runningPid).toBe(1);

    // Each process asks for the device the other one owns.
    state = requestDevice(state, 1, "camera");
    expect(state.processes[0].state).toBe("waiting");
    expect(state.processes[0].waitingFor).toBe("camera");

    state = requestDevice(state, 2, "printer");
    expect(state.processes[1].state).toBe("waiting");
    expect(state.deadlock?.sort()).toEqual([1, 2]);
    expect(state.log.at(-1)?.kind).toBe("deadlock");

    state = killProcess(state, 1);
    expect(state.deadlock).toBeNull();
    expect(state.processes[1].state).toBe("ready");
    expect(state.processes[1].heldDevices.sort()).toEqual(["camera", "printer"]);
    expect(state.devices[0].heldBy).toEqual([2]);
  });

  it("wakes blocked processes when devices are switched off", () => {
    let state = bootTwoPrinters();
    expect(state.processes[1].state).toBe("waiting");
    expect(state.processes[0].state).toBe("ready");

    // Switch off mid-flight: the waiter must go back to Ready.
    state = setDevicesEnabled(state, false);
    expect(state.devicesEnabled).toBe(false);
    expect(state.processes[0].state).toBe("ready");
    expect(state.processes[1].state).toBe("ready");
    expect(state.processes[1].waitingFor).toBeNull();
    expect(state.processes[1].heldDevices).toEqual([]);
    expect(state.devices[0].heldBy).toEqual([]);
    expect(state.devices[0].waitQueue).toEqual([]);
  });
});
