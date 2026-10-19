import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_QUANTUM } from "../kernel/machine";
import { DEFAULT_FRAMES } from "../kernel/memory";
import {
  applyScenario,
  scenarioFromState,
  scenarioFromUrl,
  scenarioToParams,
  scenarioUrl,
  type Scenario,
} from "./scenario";
import { useMachine } from "./useMachine";
import { useUi } from "./useUi";

beforeEach(() => {
  useMachine.getState().reset();
  useUi.getState().closeAll();
});

const scenario = (over: Partial<Scenario> = {}): Scenario => ({
  seed: 4242,
  policy: "rr",
  quantum: DEFAULT_QUANTUM,
  frames: DEFAULT_FRAMES,
  replacement: "lru",
  apps: ["photos", "browser", "camera"],
  devices: true,
  ff: 0,
  ...over,
});

describe("scenario links", () => {
  it("round-trips the settings and app list", () => {
    useMachine.getState().launch("browser");
    useMachine.getState().launch("camera");
    useMachine.getState().setPolicy("sjf");
    useMachine.getState().setQuantum(20);
    useMachine.getState().setFrames(6);
    useMachine.getState().setReplacement("clock");

    const live = useMachine.getState().live;
    const parsed = scenarioFromUrl(`?${scenarioToParams(scenarioFromState(live))}`);

    expect(parsed).toMatchObject({
      seed: live.seed,
      policy: "sjf",
      quantum: 20,
      frames: 6,
      replacement: "clock",
      apps: ["browser", "camera"],
      devices: true,
    });
  });

  it("carries the device setting through a link", () => {
    const parsed = scenarioFromUrl("?s=5&d=0&apps=printer");
    expect(parsed?.devices).toBe(false);

    applyScenario({ ...scenario(), devices: false });
    expect(useMachine.getState().live.devicesEnabled).toBe(false);
  });

  it("filters unknown apps and clamps silly numbers", () => {
    const parsed = scenarioFromUrl("?s=99&p=nope&q=9999&f=0&r=nope&apps=browser,hax,music");

    expect(parsed).not.toBeNull();
    expect(parsed!.seed).toBe(99);
    expect(parsed!.policy).toBe("rr");
    expect(parsed!.quantum).toBe(60);
    expect(parsed!.frames).toBe(2);
    expect(parsed!.replacement).toBe("lru");
    expect(parsed!.apps).toEqual(["browser", "music"]);
  });

  it("returns null when there is no scenario in the URL", () => {
    expect(scenarioFromUrl("")).toBeNull();
    expect(scenarioFromUrl("?demo=1")).toBeNull();
  });

  it("replays an identical machine from the same scenario", () => {
    applyScenario(scenario());
    const a = useMachine.getState().live;

    applyScenario(scenario());
    const b = useMachine.getState().live;

    expect(a.now).toBe(b.now);
    expect(a.rngState).toBe(b.rngState);
    expect(a.processes).toEqual(b.processes);
    expect(a.memory).toEqual(b.memory);
    expect(a.gantt).toEqual(b.gantt);
  });

  it("fast-forwards the requested number of ticks", () => {
    applyScenario(scenario({ apps: ["files"], ff: 12 }));
    expect(useMachine.getState().live.now).toBe(12);
  });

  it("builds a shareable URL with the scenario in the query string", () => {
    useMachine.getState().launch("music");
    const url = scenarioUrl(useMachine.getState().live);
    expect(url).toContain("apps=music");
    expect(url).toContain("s=");
    expect(url).toContain("p=rr");
  });
});
