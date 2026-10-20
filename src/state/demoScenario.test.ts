import { beforeEach, describe, expect, it } from "vitest";
import { listFiles } from "../kernel/fs";
import { applyDeadlockDemo, applyDeviceDemo, applyFilesDemo } from "./demoScenario";
import { useMachine } from "./useMachine";
import { useUi } from "./useUi";

beforeEach(() => {
  useMachine.getState().reset();
  useUi.getState().closeAll();
});

describe("demo links", () => {
  it("?demo=devices leaves one printer waiting", () => {
    applyDeviceDemo();
    const state = useMachine.getState().live;
    expect(state.processes).toHaveLength(2);
    expect(state.processes[1].state).toBe("waiting");
    expect(useUi.getState().xrayTab).toBe("devices");
  });

  it("?demo=deadlock opens on a detected cycle", () => {
    applyDeadlockDemo();
    const state = useMachine.getState().live;
    expect(state.deadlock?.sort()).toEqual([1, 2]);
    expect(state.runningPid).toBeNull();
    expect(useMachine.getState().running).toBe(false);
    expect(useUi.getState().xrayTab).toBe("devices");
  });

  it("?demo=files creates readable files and queues disk requests", () => {
    applyFilesDemo();
    const state = useMachine.getState().live;
    expect(listFiles(state.fs).map((f) => f.name)).toEqual(["holiday.jpg", "notes.txt"]);
    expect(state.disk.queue).toHaveLength(3);
    expect(useUi.getState().xrayTab).toBe("disk");
  });
});
