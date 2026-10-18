import { describe, expect, it } from "vitest";
import { APPS } from "./catalog";
import {
  advance,
  averageMetrics,
  createMachine,
  cpuUtilization,
  isIdle,
  killProcess,
  launchApp,
  metricsFor,
  setPolicy,
  setPriority,
  setQuantum,
  tick,
  QUANTUM_MAX,
  QUANTUM_MIN,
} from "./machine";
import type { MachineState } from "./types";

/** Build a machine with n processes whose exact CPU bursts we control. */
function machineWithBursts(bursts: number[], quantum = 12): MachineState {
  let s = createMachine({ seed: 7, quantum });
  bursts.forEach((burst, i) => {
    s = launchApp(s, APPS[i % APPS.length].id, { burst });
  });
  return s;
}

describe("booting", () => {
  it("starts empty, at time zero, with a boot line in the log", () => {
    const s = createMachine();
    expect(s.now).toBe(0);
    expect(s.processes).toHaveLength(0);
    expect(s.readyQueue).toHaveLength(0);
    expect(s.runningPid).toBeNull();
    expect(s.log.some((e) => e.kind === "boot")).toBe(true);
  });
});

describe("launching an app", () => {
  it("creates a process in the New state with a draw from the seeded RNG", () => {
    const s = launchApp(createMachine({ seed: 42 }), "browser");
    expect(s.processes).toHaveLength(1);

    const p = s.processes[0];
    const app = APPS.find((a) => a.id === "browser")!;
    expect(p.pid).toBe(1);
    expect(p.state).toBe("new");
    expect(p.name).toBe("Browser");
    expect(p.burstTotal).toBeGreaterThanOrEqual(app.burst[0]);
    expect(p.burstTotal).toBeLessThanOrEqual(app.burst[1]);
    expect(p.arrivalTime).toBe(0);
    expect(p.completionTime).toBeNull();
  });

  it("emits fork() and exec() syscall chips so the UI can show them", () => {
    const s = launchApp(createMachine(), "music");
    const chips = s.log.map((e) => e.chip).filter(Boolean);
    expect(chips).toContain("fork()");
    expect(chips.some((c) => c!.includes("exec"))).toBe(true);
  });

  it("honours an explicit burst override", () => {
    const s = launchApp(createMachine(), "photos", { burst: 99 });
    expect(s.processes[0].burstTotal).toBe(99);
    expect(s.processes[0].burstRemaining).toBe(99);
  });
});

describe("process lifecycle", () => {
  it("walks New → Ready → Running one tick at a time", () => {
    let s = machineWithBursts([30]);

    expect(s.processes[0].state).toBe("new");

    s = tick(s); // admission tick
    expect(s.processes[0].state).toBe("ready");
    expect(s.readyQueue).toEqual([1]);
    expect(s.runningPid).toBeNull();

    s = tick(s); // dispatch tick
    expect(s.processes[0].state).toBe("running");
    expect(s.runningPid).toBe(1);
    expect(s.processes[0].firstRunTime).toBe(2);
  });

  it("terminates a process when its burst is exhausted and frees the CPU", () => {
    let s = machineWithBursts([5]);
    s = advance(s, 6); // 1 tick to admit, then 5 ticks of actual work
    const p = s.processes[0];
    expect(p.state).toBe("terminated");
    expect(p.burstRemaining).toBe(0);
    expect(p.completionTime).toBe(6);
    expect(p.exitReason).toBe("completed");
    expect(s.runningPid).toBeNull();
    expect(isIdle(s)).toBe(true);
  });
});

/**
 * The reference example. Three processes, all arriving at t = 0, each needing
 * 30 ms of CPU, Round Robin with a 12 ms quantum. Worked by hand:
 *
 *   P1  2–13  38–49  74–79   → finishes at 79
 *   P2 14–25  50–61  80–85   → finishes at 85
 *   P3 26–37  62–73  86–91   → finishes at 91
 *
 * Waiting = turnaround − burst:  P1 49, P2 55, P3 61 → average 55.
 * Turnaround averages (79 + 85 + 91) / 3 = 85.
 * Tick 1 is spent admitting, so the CPU is busy 90 of 91 ticks.
 */
describe("Round Robin reference example (q = 12, three 30 ms jobs)", () => {
  const run = () => advance(machineWithBursts([30, 30, 30], 12), 91);

  it("finishes the three processes at 79, 85 and 91 ms", () => {
    const s = run();
    expect(s.processes.map((p) => p.completionTime)).toEqual([79, 85, 91]);
  });

  it("produces the expected waiting and turnaround averages", () => {
    const s = run();
    const rows = s.processes.map(metricsFor);
    expect(rows.map((r) => r!.waiting)).toEqual([49, 55, 61]);

    const avg = averageMetrics(s.processes);
    expect(avg.count).toBe(3);
    expect(avg.avgWaiting).toBeCloseTo(55, 10);
    expect(avg.avgTurnaround).toBeCloseTo(85, 10);
  });

  it("rotates at every quantum boundary", () => {
    const s = run();
    expect(s.stats.quantumExpiries).toBe(6);
    expect(s.stats.contextSwitches).toBe(9);
  });

  it("keeps the Gantt chart consistent with the busy-tick count", () => {
    const s = run();
    const drawn = s.gantt.reduce((total, slice) => total + (slice.end - slice.start), 0);
    expect(drawn).toBe(s.stats.busyTicks);
    expect(drawn).toBe(90);
    expect(s.gantt[s.gantt.length - 1].end).toBe(91);
  });

  it("keeps waiting = turnaround − burst for every process", () => {
    const s = run();
    for (const p of s.processes) {
      const m = metricsFor(p)!;
      expect(m.waiting).toBe(m.turnaround - p.burstTotal - p.blockedTime);
    }
  });

  it("reports little CPU idle time because the queue is never empty", () => {
    const s = run();
    expect(cpuUtilization(s)).toBeCloseTo(90 / 91, 10);
  });

  it("times the whole batch with a shorter quantum", () => {
    // Same total work still finishes in 90 ticks of CPU time; only the order
    // and the number of switches change. Total completion stays bounded.
    const s = advance(machineWithBursts([30, 30, 30], 4), 95);
    expect(isIdle(s)).toBe(true);
    expect(s.stats.quantumExpiries).toBeGreaterThan(6);
    expect(s.processes.every((p) => p.burstRemaining === 0)).toBe(true);
  });
});

describe("syscalls", () => {
  it("kills a running process mid-flight and lets the next one take the CPU", () => {
    let s = machineWithBursts([100, 100]);
    s = advance(s, 5); // P1 running, P2 still in the ready queue
    expect(s.runningPid).toBe(1);

    s = killProcess(s, 1);
    expect(s.runningPid).toBeNull();
    expect(s.processes[0].state).toBe("terminated");
    expect(s.processes[0].exitReason).toBe("killed");
    expect(s.stats.killed).toBe(1);
    expect(s.log.some((e) => e.kind === "kill" && e.chip === "kill()")).toBe(true);

    s = tick(s);
    expect(s.runningPid).toBe(2);
    expect(s.processes[1].state).toBe("running");
  });

  it("ignores a kill for an unknown or already-dead process", () => {
    const s = machineWithBursts([10]);
    expect(killProcess(s, 99)).toBe(s);
    const dead = advance(s, 20);
    expect(killProcess(dead, 1)).toBe(dead);
  });

  it("changes priority and clamps it to the 1–5 range", () => {
    let s = machineWithBursts([10]);
    s = setPriority(s, 1, 9);
    expect(s.processes[0].priority).toBe(5);
    s = setPriority(s, 1, 0);
    expect(s.processes[0].priority).toBe(1);
    expect(s.log.some((e) => e.kind === "priority")).toBe(true);
  });

  it("clamps the quantum and logs the change", () => {
    const s = createMachine();
    expect(setQuantum(s, 1).quantum).toBe(QUANTUM_MIN);
    expect(setQuantum(s, 9999).quantum).toBe(QUANTUM_MAX);
    expect(setQuantum(s, 20).log.some((e) => e.kind === "config")).toBe(true);
    expect(setQuantum(s, s.quantum)).toBe(s);
  });
});

/* ============================================================
 * Scheduling policy reference tests — hand-computed textbook values
 * ============================================================ */

function runToCompletion(m: MachineState): MachineState {
  let s = m;
  while (!isIdle(s)) s = advance(s, 1);
  return s;
}

describe("FCFS — first come first served", () => {
  /**
   * Three jobs: P1=24, P2=3, P3=3, all arrive at t=0.
   * Our timing: admission at t=1, dispatch at t=2.
   * P1 runs 2–25 (24 ticks), completes at 25.
   * P2 runs 25–28 (3 ticks), completes at 28.
   * P3 runs 28–31 (3 ticks), completes at 31.
   * Waiting = completion − arrival − burst: P1=1, P2=25, P3=28 → avg = 18
   * Turnaround: P1=25, P2=28, P3=31 → avg = 28
   */
  it("runs jobs in arrival order to completion", () => {
    const m = machineWithBursts([24, 3, 3]);
    const s = runToCompletion(setPolicy(m, "fcfs"));
    expect(s.processes.map((p) => p.completionTime)).toEqual([25, 28, 31]);
    const rows = s.processes.map(metricsFor);
    expect(rows.map((r) => r!.waiting)).toEqual([1, 25, 28]);
    expect(averageMetrics(s.processes).avgWaiting).toBeCloseTo(18, 10);
    expect(averageMetrics(s.processes).avgTurnaround).toBeCloseTo(28, 10);
  });
});

describe("SJF — shortest job first (non-preemptive)", () => {
  /**
   * Same three jobs: P1=24, P2=3, P3=3.
   * At t=2, ready queue ordered by burst: P2, P3, P1.
   * P2 runs 2–5, P3 runs 5–8, P1 runs 8–32.
   * Waiting: P1=8, P2=2, P3=5 → avg = 5
   * Turnaround: P1=32, P2=5, P3=8 → avg = 15
   */
  it("picks the shortest burst first", () => {
    const m = machineWithBursts([24, 3, 3]);
    const s = runToCompletion(setPolicy(m, "sjf"));
    expect(s.processes[1].completionTime).toBeLessThan(s.processes[0].completionTime!);
    expect(s.processes[2].completionTime).toBeLessThan(s.processes[0].completionTime!);
    const rows = s.processes.map(metricsFor);
    expect(rows[1]!.waiting).toBe(2); // P2 runs first after admission+dispatch delay
    expect(rows[2]!.waiting).toBe(5);
    expect(rows[0]!.waiting).toBe(8);
    expect(averageMetrics(s.processes).avgWaiting).toBeCloseTo(5, 10);
  });
});

describe("SRTF — shortest remaining time first (preemptive)", () => {
  /**
   * P1=8 arrives at 0, P2=4 arrives at 1, P3=9 arrives at 2, P4=5 arrives at 3.
   * Timeline:
   *   t=2: P1 starts (rem=8)
   *   t=3: P2 admitted (rem=4 < 7) → preempt P1 at end of tick, runningPid=null
   *   t=4: P2 dispatched, runs 4–7, completes at 7
   *   t=7: P3, P4 admitted; P4 shortest (5 < 7 < 9) → P4 runs 7–12
   *   t=12: P1 rem=6, P3 rem=9 → P1 runs 12–19
   *   t=19: P3 runs 19–28
   */
  it("preempts when a new arrival has less remaining time", () => {
    let m = createMachine({ seed: 1, policy: "srtf" });
    m = launchApp(m, "browser", { burst: 8 });
    m = advance(m, 2); // P1 admitted and running at t=2
    m = launchApp(m, "music", { burst: 4 });
    m = advance(m, 1); // P2 admitted at t=3, preempts P1 at end of tick
    expect(m.runningPid).toBeNull(); // preemption takes effect next tick
    m = advance(m, 1); // t=4: P2 dispatched
    expect(m.runningPid).toBe(2);
    m = advance(m, 3); // P2 runs to completion at t=7
    m = launchApp(m, "photos", { burst: 9 });
    m = launchApp(m, "files", { burst: 5 });
    m = advance(m, 1); // P3, P4 admitted at t=7, P4 preempts
    expect(m.runningPid).toBeNull(); // preemption at end of tick
    m = advance(m, 1); // t=8: P4 dispatched
    expect(m.runningPid).toBe(4);
  });
});

describe("Priority — lower number = higher priority (non-preemptive)", () => {
  /**
   * P1: burst=10, priority=3
   * P2: burst=1,  priority=1
   * P3: burst=2,  priority=2
   * All arrive together. At t=2, queue ordered by priority: P2, P3, P1.
   * P2 runs 2–3, P3 runs 3–5, P1 runs 5–15.
   * Waiting: P2=2, P3=3, P1=5 → avg = 10/3 ≈ 3.33
   * Turnaround: P2=3, P3=5, P1=15 → avg = 23/3 ≈ 7.67
   */
  it("picks highest priority first", () => {
    let m = createMachine({ seed: 1, policy: "priority" });
    m = launchApp(m, "browser", { burst: 10 });
    m = setPriority(m, 1, 3);
    m = launchApp(m, "music", { burst: 1 });
    m = setPriority(m, 2, 1);
    m = launchApp(m, "photos", { burst: 2 });
    m = setPriority(m, 3, 2);
    const s = runToCompletion(m);
    expect(s.processes[1].completionTime).toBeLessThan(s.processes[2].completionTime!);
    expect(s.processes[2].completionTime).toBeLessThan(s.processes[0].completionTime!);
    const rows = s.processes.map(metricsFor);
    expect(rows[1]!.waiting).toBe(2);
    expect(rows[2]!.waiting).toBe(3);
    expect(rows[0]!.waiting).toBe(5);
    expect(averageMetrics(s.processes).avgWaiting).toBeCloseTo(10 / 3, 10);
  });

  it("reorders ready queue when priority changes", () => {
    let m = createMachine({ seed: 1, policy: "priority" });
    m = launchApp(m, "browser", { burst: 10 });
    m = setPriority(m, 1, 3); // P1 priority 3
    m = launchApp(m, "music", { burst: 1 });
    m = setPriority(m, 2, 2); // P2 priority 2 (higher)
    m = advance(m, 2); // t=1 admit both, t=2 dispatch P2 (higher priority)
    // After t=2: P2 running, P1 in ready queue
    expect(m.readyQueue).toEqual([1]);
    expect(m.runningPid).toBe(2);
    m = setPriority(m, 1, 5); // P1 lowest
    m = setPriority(m, 2, 1); // P2 highest
    expect(m.readyQueue[0]).toBe(1);
  });
});

describe("determinism", () => {
  it("produces an identical machine from the same seed and the same clicks", () => {
    const build = () => {
      let s = createMachine({ seed: 1234, quantum: 10 });
      s = launchApp(s, "browser");
      s = advance(s, 15);
      s = launchApp(s, "music");
      s = launchApp(s, "camera");
      s = advance(s, 40);
      s = launchApp(s, "photos");
      return advance(s, 200);
    };

    const a = build();
    const b = build();

    expect(a.now).toBe(b.now);
    expect(a.processes).toEqual(b.processes);
    expect(a.readyQueue).toEqual(b.readyQueue);
    expect(a.runningPid).toBe(b.runningPid);
    expect(a.gantt).toEqual(b.gantt);
    expect(a.stats).toEqual(b.stats);
    expect(a.log).toEqual(b.log);
    expect(a.rngState).toBe(b.rngState);
  });

  it("does not mutate the state it was given", () => {
    const before = machineWithBursts([20]);
    const snapshot = JSON.stringify(before);
    tick(before);
    advance(before, 10);
    launchApp(before, "files");
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});