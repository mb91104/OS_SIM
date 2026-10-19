import { stateCounts } from "../../kernel/machine";
import type { Pcb } from "../../kernel/types";
import { STATE_LABEL, STATE_ORDER, STATE_TINT } from "../../lib/format";
import { useKernelState } from "../../state/useMachine";
import { useUi } from "../../state/useUi";
import { InspectorSection } from "./InspectorSection";
import { DiskSection } from "./DiskSection";
import { DeviceSection } from "./DeviceSection";
import { MemorySection } from "./MemorySection";
import { PcbSection } from "./PcbSection";

/** A clickable process chip, used by every queue view. */
export function PChip({ p, isNext }: { p: Pcb; isNext?: boolean }) {
  const select = useUi((s) => s.select);
  const selectedPid = useUi((s) => s.selectedPid);
  const icon = { browser: "🌐", music: "🎵", photos: "🖼️", files: "📁", printer: "🖨️", code: "⌨️", camera: "📷" }[
    p.appId
  ];

  return (
    <button
      className={`pchip ${isNext ? "pchip--next" : ""} ${selectedPid === p.pid ? "is-selected" : ""}`}
      onClick={() => select(p.pid)}
      title={`${p.name} — ${STATE_LABEL[p.state]}`}
    >
      <i className="pchip__dot" style={{ background: p.color }} />
      {icon} P{p.pid}
    </button>
  );
}

function CpuSection() {
  const state = useKernelState();
  const running =
    state.runningPid === null
      ? undefined
      : state.processes.find((p) => p.pid === state.runningPid);
  const select = useUi((s) => s.select);
  const slice = running ? running.quantumUsed / state.quantum : 0;

  return (
    <div className="panel">
      <div className="panel__title">
        CPU core
        <small>one process at a time</small>
      </div>

      <div className={`cpu ${running ? "is-busy" : ""}`}>
        <span className="cpu__core">core 0</span>
        <div className="cpu__main">
          {running ? (
            <>
              <div className="cpu__who">
                <i className="pchip__dot" style={{ background: running.color }} />
                <button
                  className="btn--ghost"
                  style={{ padding: 0, border: 0, background: "transparent", fontWeight: 650 }}
                  onClick={() => select(running.pid)}
                >
                  {running.name}
                </button>
                <span className="window__pid">P{running.pid}</span>
              </div>
              <div className="meter" title="How much of its time slice this process has used">
                <i style={{ width: `${Math.round(slice * 100)}%` }} />
              </div>
              <div className="cpu__sub">
                <span>
                  slice {running.quantumUsed}/{state.quantum} ms
                </span>
                <span>{running.burstRemaining} ms of work left</span>
              </div>
            </>
          ) : (
            <div className="cpu__idle">Idle — no process needs the CPU</div>
          )}
        </div>
      </div>
    </div>
  );
}

function QueuesSection() {
  const state = useKernelState();
  const byId = new Map(state.processes.map((p) => [p.pid, p]));

  const ready = state.readyQueue.map((pid) => byId.get(pid)).filter((p): p is Pcb => !!p);
  const fresh = state.processes.filter((p) => p.state === "new");
  const blocked = state.processes.filter((p) => p.state === "waiting");
  const counts = stateCounts(state);

  return (
    <div className="panel">
      <div className="panel__title">
        Queues
        <small>who is waiting, and in what order</small>
      </div>

      <div className="qgroup">
        <div className="qrow">
          <span className="qrow__label">Ready</span>
          <div className="qrow__items">
            {ready.length === 0 ? (
              <span className="qrow__empty">empty — nothing is waiting</span>
            ) : (
              ready.map((p, i) => <PChip key={p.pid} p={p} isNext={i === 0} />)
            )}
          </div>
        </div>

        <div className="qrow">
          <span className="qrow__label">New</span>
          <div className="qrow__items">
            {fresh.length === 0 ? (
              <span className="qrow__empty">empty</span>
            ) : (
              fresh.map((p) => <PChip key={p.pid} p={p} />)
            )}
          </div>
        </div>

        <div className="qrow">
          <span className="qrow__label">Waiting</span>
          <div className="qrow__items">
            {blocked.length === 0 ? (
              <span className="qrow__empty">no process is blocked on a device</span>
            ) : (
              blocked.map((p) => <PChip key={p.pid} p={p} />)
            )}
          </div>
        </div>
      </div>

      <div className="counters">
        {STATE_ORDER.map((s) => {
          const tint = STATE_TINT[s];
          return (
            <div className="counter" key={s} title={s}>
              <b style={{ color: tint.fg }}>{counts[s]}</b>
              <span>{STATE_LABEL[s]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function XrayPanel() {
  const xrayOpen = useUi((s) => s.xrayOpen);
  const tab = useUi((s) => s.xrayTab);
  const setTab = useUi((s) => s.setXrayTab);
  if (!xrayOpen) return null;

  const tabs: { id: typeof tab; label: string }[] = [
    { id: "cpu", label: "CPU" },
    { id: "processes", label: "Processes" },
    { id: "memory", label: "Memory" },
    { id: "disk", label: "Disk" },
    { id: "devices", label: "Devices" },
    { id: "inspector", label: "Inspect" },
  ];

  return (
    <aside className="xray" aria-label="Kernel view">
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`tab ${tab === t.id ? "is-active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "cpu" && (
        <>
          <CpuSection />
          <QueuesSection />
          <p className="note" style={{ margin: "0 2px 6px" }}>
            This panel is the kernel's point of view. Clicking a process chip jumps to the Inspector.
          </p>
        </>
      )}

      {tab === "processes" && <PcbSection />}

      {tab === "memory" && <MemorySection />}

      {tab === "disk" && <DiskSection />}

      {tab === "devices" && <DeviceSection />}

      {tab === "inspector" && <InspectorSection />}
    </aside>
  );
}
