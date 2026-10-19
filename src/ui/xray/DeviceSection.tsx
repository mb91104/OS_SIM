import type { Pid } from "../../kernel/types";
import { useKernelState, useMachine } from "../../state/useMachine";
import { useUi } from "../../state/useUi";

const ICON: Record<string, string> = {
  printer: "🖨️",
  camera: "📷",
  speakers: "🔊",
};

function Chip({ pid }: { pid: Pid }) {
  const state = useKernelState();
  const select = useUi((s) => s.select);
  const p = state.processes.find((x) => x.pid === pid);
  if (!p) return null;
  return (
    <button className="pchip" onClick={() => select(pid)} title={`${p.name} — ${p.state}`}>
      <i className="pchip__dot" style={{ background: p.color }} />
      {ICON[state.devices.find((d) => d.heldBy.includes(pid))?.id ?? ""] ?? "⚙️"} P{pid}
    </button>
  );
}

export function DeviceSection() {
  const state = useKernelState();
  const setEnabled = useMachine((s) => s.setDevicesEnabled);
  const request = useMachine((s) => s.requestDevice);
  const release = useMachine((s) => s.releaseDevice);

  const active = state.processes.filter(
    (p) => p.state === "ready" || p.state === "running",
  );

  return (
    <>
      <div className="panel">
        <div className="panel__title">
          Devices
          <small>one of each, so apps have to queue</small>
        </div>

        <label className="memctl__row">
          <span className="toolbar__label">Device contention</span>
          <button
            className={`btn ${state.devicesEnabled ? "btn--primary" : ""}`}
            onClick={() => setEnabled(!state.devicesEnabled)}
          >
            {state.devicesEnabled ? "On" : "Off"}
          </button>
        </label>

        {!state.devicesEnabled && (
          <p className="note" style={{ marginTop: 8 }}>
            Off: every app gets the CPU without asking for hardware, so scheduling stays
            device-free. Turn it on to make the Printer, Camera and Music Player wait their turn.
          </p>
        )}

        {state.deadlock && (
          <div className="deadlock-banner" role="alert">
            <b>Deadlock.</b> {state.deadlock.map((pid) => `P${pid}`).join(" and ")} are each holding
            one device and waiting for the other. Kill one process to break the cycle.
          </div>
        )}

        {state.devicesEnabled &&
          state.devices.map((device) => (
            <div className="device" key={device.id}>
              <div className="device__head">
                <span>
                  {ICON[device.id] ?? "⚙️"} <b>{device.name}</b>
                </span>
                <span className="device__count">
                  {device.heldBy.length}/{device.instances} in use
                </span>
              </div>
              <div className="device__row">
                <span className="device__label">holder</span>
                <div className="device__items">
                  {device.heldBy.length === 0 ? (
                    <span className="qrow__empty">free</span>
                  ) : (
                    device.heldBy.map((pid) => <Chip key={pid} pid={pid} />)
                  )}
                </div>
              </div>
              <div className="device__row">
                <span className="device__label">queue</span>
                <div className="device__items">
                  {device.waitQueue.length === 0 ? (
                    <span className="qrow__empty">nobody waiting</span>
                  ) : (
                    device.waitQueue.map((pid) => <Chip key={pid} pid={pid} />)
                  )}
                </div>
              </div>
            </div>
          ))}
      </div>

      {state.devicesEnabled && (
        <div className="panel">
          <div className="panel__title">
            Deadlock sandbox
            <small>ask a ready process for another device</small>
          </div>
          <p className="note" style={{ marginBottom: 8 }}>
            Launch the Printer and the Camera. When both are running, ask each one for the other's
            device. Each now holds one and waits for the other: a deadlock.
          </p>

          {active.length === 0 ? (
            <div className="empty-note">No ready process. Launch an app first.</div>
          ) : (
            active.map((p) => {
              const free = state.devices.filter((d) => !p.heldDevices.includes(d.id));
              return (
                <div className="sandbox-row" key={p.pid}>
                  <span className="sandbox-row__who">
                    P{p.pid} {p.name}
                  </span>
                  <div className="sandbox-row__actions">
                    {p.heldDevices.map((id) => (
                      <button
                        key={id}
                        className="btn btn--tiny"
                        onClick={() => release(p.pid, id)}
                        title={`Give the ${id} back`}
                      >
                        release {id}
                      </button>
                    ))}
                    {free.map((d) => (
                      <button
                        key={d.id}
                        className="btn btn--tiny"
                        onClick={() => request(p.pid, d.id)}
                        title={`Ask P${p.pid} for the ${d.name}`}
                      >
                        + {d.name.toLowerCase()}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </>
  );
}
