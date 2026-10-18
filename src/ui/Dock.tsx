import { APPS } from "../kernel/catalog";
import { useKernelState, useMachine } from "../state/useMachine";
import { useUi } from "../state/useUi";

/**
 * The Dock is the whole user interface. Clicking an icon is a syscall —
 * that is the only way a process gets created in ToyOS.
 */
export function Dock() {
  const state = useKernelState();
  const launch = useMachine((s) => s.launch);
  const running = useMachine((s) => s.running);
  const play = useMachine((s) => s.play);

  const openApp = useUi((s) => s.openApp);
  const openTaskManager = useUi((s) => s.openTaskManager);
  const toast = useUi((s) => s.toast);

  const liveCounts = new Map<string, number>();
  for (const p of state.processes) {
    if (p.state !== "terminated") liveCounts.set(p.appId, (liveCounts.get(p.appId) ?? 0) + 1);
  }

  const startApp = (appId: string, name: string) => {
    const pid = launch(appId);
    openApp(pid, appId);
    if (!running) play();
    toast(`Started ${name} as P${pid}`, "info");
  };

  return (
    <div className="dock-wrap">
      <div className="dock">
        <button className="dock__item" onClick={openTaskManager} title="Reopen the Task Manager window">
          <span className="dock__icon">🧭</span>
          <span className="dock__label">Task Manager</span>
        </button>

        <div className="dock__sep" />

        {APPS.map((app) => {
          const count = liveCounts.get(app.id) ?? 0;
          return (
            <button
              key={app.id}
              className="dock__item"
              onClick={() => startApp(app.id, app.name)}
              title={`${app.blurb} (needs ~${app.burst[0]}–${app.burst[1]} ms of CPU, ${app.memPages} pages)`}
            >
              <span className="dock__icon">{app.icon}</span>
              <span className="dock__label">{app.name}</span>
              {count > 0 && <span className="dock__badge">{count}</span>}
            </button>
          );
        })}

        <div className="dock__hint">
          Click an app to launch it.
          <br />
          Opening more apps than the CPU can handle is the whole point.
        </div>
      </div>
    </div>
  );
}
