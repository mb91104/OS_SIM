import { QUANTUM_MAX, QUANTUM_MIN } from "../kernel/machine";
import { formatClockPadded } from "../lib/format";
import { copyScenarioLink } from "../state/scenario";
import { useIsLive, useKernelState, useMachine } from "../state/useMachine";
import { useUi } from "../state/useUi";

const POLICY_LABELS: Record<string, string> = {
  rr: "Round Robin",
  fcfs: "FCFS",
  sjf: "SJF",
  srtf: "SRTF",
  priority: "Priority",
};

const POLICY_HINTS: Record<string, string> = {
  rr: "Each process gets a time slice, then rotates to the back",
  fcfs: "First come, first served — runs to completion in arrival order",
  sjf: "Shortest job first — non-preemptive, picks smallest total burst",
  srtf: "Shortest remaining time — preemptive, picks smallest remaining burst",
  priority: "Lower number = higher priority — non-preemptive",
};

export function Toolbar() {
  const state = useKernelState();
  const running = useMachine((s) => s.running);
  const speed = useMachine((s) => s.speed);
  const live = useIsLive();

  const togglePlay = useMachine((s) => s.togglePlay);
  const step = useMachine((s) => s.step);
  const setSpeed = useMachine((s) => s.setSpeed);
  const setQuantum = useMachine((s) => s.setQuantum);
  const setPolicy = useMachine((s) => s.setPolicy);
  const reset = useMachine((s) => s.reset);
  const closeAll = useUi((s) => s.closeAll);
  const xrayOpen = useUi((s) => s.xrayOpen);
  const setXrayOpen = useUi((s) => s.setXrayOpen);
  const toast = useUi((s) => s.toast);

  const started = state.processes.length > 0;
  const isRR = state.policy === "rr";

  const share = async () => {
    const { url, copied } = await copyScenarioLink(useMachine.getState().live);
    toast(
      copied
        ? "Scenario link copied — open it to replay this exact setup."
        : `Copy blocked by the browser. Link: ${url}`,
      "info",
    );
  };

  return (
    <header className="toolbar">
      <div className="toolbar__brand">
        ToyOS
        <span>a fake computer with a real kernel</span>
      </div>

      <div className="toolbar__group">
        <span className="toolbar__label">Clock</span>
        <span className={`clock ${live ? "" : "clock--replay"}`}>{formatClockPadded(state.now)}</span>
        <button
          className={`btn ${running ? "" : "btn--primary"}`}
          onClick={togglePlay}
          disabled={!running && !started}
          title="Spacebar"
        >
          <span className="btn__icon">{running ? "||" : ">"}</span>
          {running ? "Pause" : "Run"}
        </button>
        <button className="btn" onClick={step} disabled={running} title="Advance one millisecond">
          <span className="btn__icon">&gt;&gt;</span>
          Step
        </button>
      </div>

      <div className="toolbar__group">
        <span className="toolbar__label">Speed</span>
        <input
          className="slider"
          type="range"
          min={0.25}
          max={4}
          step={0.25}
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
        />
        <span className="value">{speed}×</span>
      </div>

      <div className="toolbar__group">
        <span className="toolbar__label">Scheduler</span>
        <select
          className="policy-select"
          value={state.policy}
          onChange={(e) => setPolicy(e.target.value as import("../kernel/types").Policy)}
          title={POLICY_HINTS[state.policy]}
        >
          {Object.entries(POLICY_LABELS).map(([val, label]) => (
            <option key={val} value={val}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {isRR && (
        <div className="toolbar__group">
          <span className="toolbar__label" title="How long each process runs before it is rotated out">
            Time slice
          </span>
          <input
            className="slider"
            type="range"
            min={QUANTUM_MIN}
            max={QUANTUM_MAX}
            step={1}
            value={state.quantum}
            onChange={(e) => setQuantum(Number(e.target.value))}
          />
          <span className="value">{state.quantum} ms</span>
        </div>
      )}

      <div className="toolbar__spacer" />

      <button
        className="btn"
        onClick={() => void share()}
        title="Copy a link that rebuilds this exact setup — same seed, same settings, same apps"
      >
        <span className="btn__icon">ln</span>
        Share
      </button>
      <button
        className={`btn ${xrayOpen ? "btn--primary" : ""}`}
        onClick={() => setXrayOpen(!xrayOpen)}
        title="Show the kernel's inside view (X)"
      >
        <span className="btn__icon">#</span>
        X-ray
      </button>
      <button
        className="btn"
        onClick={() => {
          reset();
          closeAll();
        }}
      >
        <span className="btn__icon">..</span>
        Reboot
      </button>
    </header>
  );
}
