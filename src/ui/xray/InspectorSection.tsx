import { appForPid } from "../../kernel/catalog";
import { metricsAt } from "../../kernel/machine";
import { STATE_FRIENDLY, STATE_LABEL, STATE_TINT, formatClock } from "../../lib/format";
import { useKernelState, useMachine } from "../../state/useMachine";
import { useUi } from "../../state/useUi";

/** What the kernel will do next, in plain words, for each state. */
const NEXT_STEP: Record<string, string> = {
  new: "It exists, but the kernel has not admitted it to the ready queue yet. That happens on the next tick.",
  ready: "It sits in the ready queue. Round Robin will pick it once the processes ahead of it finish their slice.",
  running: "It keeps the CPU until it finishes its work or its time slice runs out.",
  waiting: "It is blocked on something outside the CPU. Devices arrive in milestone M6, so nothing blocks yet.",
  terminated: "It is gone. Its PID and its memory have been released for the next process to use.",
};

export function InspectorSection() {
  const state = useKernelState();
  const selectedPid = useUi((s) => s.selectedPid);
  const select = useUi((s) => s.select);
  const kill = useMachine((s) => s.kill);
  const prioritise = useMachine((s) => s.prioritise);
  const closeWindowsForPid = useUi((s) => s.closeWindowsForPid);

  const p = selectedPid === null ? undefined : state.processes.find((x) => x.pid === selectedPid);

  if (!p) {
    return (
      <div className="panel">
        <div className="panel__title">Inspector</div>
        <div className="empty-note">
          Click a process chip, a row, or an app window to see exactly what the kernel knows about it.
        </div>
      </div>
    );
  }

  const app = appForPid(p.appId);
  const m = metricsAt(p, state.now);
  const tint = STATE_TINT[p.state];
  const events = state.log.filter((e) => e.pid === p.pid).slice(-3);

  return (
    <div className="panel">
      <div className="panel__title">
        Inspector
        <small>
          <button
            className="btn--ghost"
            style={{ border: 0, background: "transparent", color: "inherit", padding: 0 }}
            onClick={() => select(null)}
          >
            clear
          </button>
        </small>
      </div>

      <div className="inspector__head">
        <span className="window__icon">{app?.icon ?? "📦"}</span>
        <b>{p.name}</b>
        <span className="window__pid">P{p.pid}</span>
        <span className="tm__state" style={{ background: tint.bg, color: tint.fg, marginLeft: "auto" }}>
          {STATE_LABEL[p.state]}
        </span>
      </div>

      <p className="inspector__blurb">{app?.blurb}</p>

      <div className="why">
        <b>▸</b>
        <span>
          {STATE_FRIENDLY[p.state]}. {NEXT_STEP[p.state]}
        </span>
      </div>

      <div className="metrics" style={{ marginTop: 9 }}>
        <div className="metric">
          <span>Arrived at</span>
          <b>{formatClock(p.arrivalTime)}</b>
        </div>
        <div className="metric">
          <span>CPU time needed</span>
          <b>{p.burstTotal} ms</b>
        </div>
        <div className="metric">
          <span>CPU time received</span>
          <b>{m.service} ms</b>
        </div>
        <div className="metric">
          <span>Still owed</span>
          <b>{m.remaining} ms</b>
        </div>
        <div className="metric">
          <span>Waiting so far</span>
          <b>{m.waiting} ms</b>
        </div>
        <div className="metric">
          <span>Priority</span>
          <b>{p.priority} / 5</b>
        </div>
      </div>

      {m.finished && (
        <div className="metrics" style={{ marginTop: 7 }}>
          <div className="metric">
            <span>Finished at</span>
            <b>{formatClock(p.completionTime ?? state.now)}</b>
          </div>
          <div className="metric">
            <span>Turnaround</span>
            <b>{m.turnaround} ms</b>
          </div>
        </div>
      )}

      <p className="note">
        This process declares {p.memPages} pages of memory. Memory allocation and paging arrive in
        milestones M3 and M4 — for now the number is recorded but nothing is stored.
      </p>

      <div style={{ marginTop: 9, display: "flex", gap: 6 }}>
        <button
          className="btn"
          disabled={p.state === "terminated"}
          onClick={() => prioritise(p.pid, p.priority - 1)}
        >
          ▲ More important
        </button>
        <button
          className="btn btn--danger"
          disabled={p.state === "terminated"}
          onClick={() => {
            kill(p.pid);
            closeWindowsForPid(p.pid);
          }}
        >
          ✕ Kill
        </button>
      </div>

      {events.length > 0 && (
        <div style={{ marginTop: 9 }}>
          <div className="toolbar__label" style={{ marginBottom: 4 }}>
            Recent history
          </div>
          {events.map((e) => (
            <div className="console__line" key={e.id} data-kind={e.kind}>
              <span className="console__t">{formatClock(e.t)}</span>
              <span className="console__text">
                {e.chip && <span className="chip">{e.chip}</span>} {e.text}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
