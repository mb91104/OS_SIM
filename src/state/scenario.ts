import { APPS } from "../kernel/catalog";
import { DEFAULT_QUANTUM, QUANTUM_MAX, QUANTUM_MIN } from "../kernel/machine";
import { DEFAULT_FRAMES, FRAMES_MAX, FRAMES_MIN, type Replacement } from "../kernel/memory";
import type { MachineState, Policy } from "../kernel/types";
import { DEFAULT_SEED, useMachine } from "./useMachine";
import { useUi } from "./useUi";

/**
 * Shareable scenario links (milestone M7).
 *
 * A scenario is just the machine's *setup*: the seed, the scheduler settings,
 * how much memory and disk policy, and which apps were opened. Because every
 * random burst comes from the seeded RNG, replaying the same app list against
 * the same seed reproduces the same machine exactly — no serialisation of the
 * whole state needed.
 */

export interface Scenario {
  seed: number;
  policy: Policy;
  quantum: number;
  frames: number;
  replacement: Replacement;
  /** App ids, in launch order (duplicates allowed). */
  apps: string[];
  /** Whether the printer/camera/speaker contention is on. */
  devices: boolean;
  /** Simulated milliseconds to fast-forward after launching. */
  ff: number;
}

const POLICIES: Policy[] = ["rr", "fcfs", "sjf", "srtf", "priority"];
const REPLACEMENTS: Replacement[] = ["fifo", "lru", "optimal", "clock"];
const MAX_APPS = 14;

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function oneOf<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

/** Describe the live machine as a replayable scenario. */
export function scenarioFromState(state: MachineState): Scenario {
  return {
    seed: state.seed,
    policy: state.policy,
    quantum: state.quantum,
    frames: state.memory.frames.length,
    replacement: state.memory.replacement,
    apps: state.processes.map((p) => p.appId),
    devices: state.devicesEnabled,
    ff: 0,
  };
}

export function scenarioToParams(scenario: Scenario): URLSearchParams {
  const params = new URLSearchParams();
  params.set("s", String(scenario.seed));
  params.set("p", scenario.policy);
  params.set("q", String(scenario.quantum));
  params.set("f", String(scenario.frames));
  params.set("r", scenario.replacement);
  params.set("apps", scenario.apps.join(","));
  if (!scenario.devices) params.set("d", "0");
  if (scenario.ff > 0) params.set("ff", String(scenario.ff));
  return params;
}

/** A relative URL that rebuilds this machine when opened. */
export function scenarioUrl(state: MachineState): string {
  const path = typeof window === "undefined" ? "/" : window.location.pathname;
  return `${path}?${scenarioToParams(scenarioFromState(state)).toString()}`;
}

/** Parse a scenario out of a query string, or null when there isn't one. */
export function scenarioFromUrl(search: string): Scenario | null {
  const params = new URLSearchParams(search);
  const rawApps = params.get("apps");
  if (!params.has("s") && rawApps === null) return null;

  const known = new Set(APPS.map((a) => a.id));
  const apps = (rawApps ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => known.has(id))
    .slice(0, MAX_APPS);

  return {
    seed: clampInt(params.get("s"), 1, 2_147_483_647, DEFAULT_SEED),
    policy: oneOf(params.get("p"), POLICIES, "rr"),
    quantum: clampInt(params.get("q"), QUANTUM_MIN, QUANTUM_MAX, DEFAULT_QUANTUM),
    frames: clampInt(params.get("f"), FRAMES_MIN, FRAMES_MAX, DEFAULT_FRAMES),
    replacement: oneOf(params.get("r"), REPLACEMENTS, "lru"),
    apps,
    devices: params.get("d") !== "0",
    ff: clampInt(params.get("ff"), 0, 5000, 0),
  };
}

/** Rebuild the machine in the stores. Safe to call before React renders. */
export function applyScenario(scenario: Scenario): void {
  const machine = useMachine.getState();
  machine.reset(scenario.seed);

  if (scenario.policy !== "rr") machine.setPolicy(scenario.policy);
  machine.setQuantum(scenario.quantum);
  machine.setFrames(scenario.frames);
  machine.setReplacement(scenario.replacement);
  if (!scenario.devices) machine.setDevicesEnabled(false);

  for (const appId of scenario.apps) {
    const pid = useMachine.getState().launch(appId);
    useUi.getState().openApp(pid, appId);
  }

  if (scenario.ff > 0) useMachine.getState().advanceTicks(scenario.ff);
}

/** Copy the current setup to the clipboard. Returns the URL and whether it worked. */
export async function copyScenarioLink(
  state: MachineState,
): Promise<{ url: string; copied: boolean }> {
  const url = `${typeof window === "undefined" ? "" : window.location.origin}${scenarioUrl(state)}`;
  try {
    await navigator.clipboard.writeText(url);
    return { url, copied: true };
  } catch {
    // Clipboard access can be blocked (or missing in tests); the caller can still show the link.
    return { url, copied: false };
  }
}
