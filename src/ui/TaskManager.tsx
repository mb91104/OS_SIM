import { appForPid } from "../kernel/catalog";
import { STATE_LABEL, STATE_TINT } from "../lib/format";
import { useKernelState, useMachine } from "../state/useMachine";
import { useUi } from "../state/useUi";

/**
 * The user-facing view of what is running — the apps *you* started, in words
 * you would use. Compare with the kernel's own process table in the X-ray panel:
 * same reality, two vocabularies. That contrast is the point of this window.
 */
export function TaskManager() {
  const state = useKernelState();
  const kill = useMachine((s) => s.kill);
  const prioritise = useMachine((s) => s.prioritise);

  const selectedPid = useUi((s) => s.selectedPid);
  const select = useUi((s) => s.select);
  const closeWindowsForPid = useUi((s) => s.closeWindowsForPid);
  const toast = useUi((s) => s.toast);

  const active = state.processes.filter((p) => p.state !== "terminated");

  if (active.length === 0) {
    return (
      <div className="tm__empty">
        Nothing is running yet.
        <br />
        Click an app in the Dock to start a process.
      </div>
    );
  }

  return (
    <div>
      {active.map((p) => {
        const app = appForPid(p.appId);
        const tint = STATE_TINT[p.state];
        const done = p.burstTotal - p.burstRemaining;
        return (
          <div
            key={p.pid}
            className={`tm__row ${selectedPid === p.pid ? "is-selected" : ""}`}
            onClick={() => select(p.pid)}
          >
            <span className="window__icon">{app?.icon ?? "📦"}</span>

            <div className="tm__name">
              <b>{p.name}</b>
              <small>
                P{p.pid} · {done}/{p.burstTotal} ms · {p.memPages} pages
              </small>
            </div>

            <span className="tm__state" style={{ background: tint.bg, color: tint.fg }}>
              {STATE_LABEL[p.state]}
            </span>

            <div className="tm__prio" onClick={(e) => e.stopPropagation()}>
              <button
                title="More important"
                disabled={p.priority <= 1}
                onClick={() => prioritise(p.pid, p.priority - 1)}
              >
                ▲
              </button>
              <span>{p.priority}</span>
              <button
                title="Less important"
                disabled={p.priority >= 5}
                onClick={() => prioritise(p.pid, p.priority + 1)}
              >
                ▼
              </button>
              <button
                className="window__btn--close"
                title={`Close ${p.name}`}
                onClick={() => {
                  kill(p.pid);
                  closeWindowsForPid(p.pid);
                  toast(`${p.name} (P${p.pid}) was closed`, "killed");
                }}
              >
                ✕
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
