import { averageMetrics, metricsAt } from "../../kernel/machine";
import { residentPages } from "../../kernel/memory";
import { STATE_LABEL, STATE_TINT, formatAverage, formatPercent } from "../../lib/format";
import { useKernelState } from "../../state/useMachine";
import { useUi } from "../../state/useUi";

/**
 * The kernel's own bookkeeping. Compare this table with the friendly Task
 * Manager window: same processes, but here you see raw PCB fields, including the
 * ones the user never sees (arrival time, remaining burst, waiting time).
 */
export function PcbSection() {
  const state = useKernelState();
  const select = useUi((s) => s.select);
  const selectedPid = useUi((s) => s.selectedPid);

  const avg = averageMetrics(state.processes);
  const busy = state.now === 0 ? 0 : state.stats.busyTicks / state.now;

  if (state.processes.length === 0) {
    return (
      <div className="panel">
        <div className="panel__title">Process table</div>
        <div className="empty-note">
          No process control blocks yet. Launch an app to create one.
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel__title">
        Process table
        <small>PCB records</small>
      </div>

      <table className="pcbtable">
        <thead>
          <tr>
            <th>PID</th>
            <th style={{ textAlign: "left" }}>Name</th>
            <th>State</th>
            <th>Pri</th>
            <th title="CPU time still owed">Left</th>
            <th title="Pages currently resident in RAM">RAM</th>
            <th title="Time spent waiting for the CPU">Wait</th>
            <th title="Time spent blocked on a device">Block</th>
            <th title="Total time from arrival to finishing">Turn</th>
          </tr>
        </thead>
        <tbody>
          {state.processes.map((p) => {
            const m = metricsAt(p, state.now);
            const tint = STATE_TINT[p.state];
            return (
              <tr
                key={p.pid}
                className={selectedPid === p.pid ? "is-selected" : ""}
                onClick={() => select(p.pid)}
              >
                <td style={{ color: p.color }}>P{p.pid}</td>
                <td style={{ textAlign: "left" }}>{p.name}</td>
                <td>
                  <span style={{ color: tint.fg }}>{STATE_LABEL[p.state]}</span>
                </td>
                <td>{p.priority}</td>
                <td className={p.burstRemaining === 0 ? "dim" : ""}>{p.burstRemaining}</td>
                <td className={p.state === "terminated" ? "dim" : ""}>
                  {residentPages(state.memory, p.pid).length}/{p.memPages}
                </td>
                <td className={m.finished ? "" : "dim"}>{m.waiting}</td>
                <td className={p.blockedTime > 0 ? "blocked" : "dim"}>{p.blockedTime}</td>
                <td className={m.finished ? "" : "dim"}>{m.turnaround}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="metrics" style={{ marginTop: 10 }}>
        <div className="metric">
          <span>CPU busy</span>
          <b>{formatPercent(busy)}</b>
        </div>
        <div className="metric">
          <span>Context switches</span>
          <b>{state.stats.contextSwitches}</b>
        </div>
        <div className="metric">
          <span>Time slice used up</span>
          <b>{state.stats.quantumExpiries}</b>
        </div>
        <div className="metric">
          <span>Processes done</span>
          <b>
            {state.stats.completed}
            {state.stats.killed > 0 ? ` (+${state.stats.killed} killed)` : ""}
          </b>
        </div>
        <div className="metric">
          <span>Avg waiting</span>
          <b>{avg.count === 0 ? "—" : `${formatAverage(avg.avgWaiting)} ms`}</b>
        </div>
        <div className="metric">
          <span>Avg turnaround</span>
          <b>{avg.count === 0 ? "—" : `${formatAverage(avg.avgTurnaround)} ms`}</b>
        </div>
        <div className="metric">
          <span>Page faults</span>
          <b>{state.memory.pageFaults}</b>
        </div>
      </div>

      <p className="note">
        Waiting = turnaround − CPU time used. Averages only count processes that finished on their
        own, so killed apps do not distort them.
      </p>
    </div>
  );
}
