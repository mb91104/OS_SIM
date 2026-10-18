import { appForPid } from "../kernel/catalog";
import { useKernelState } from "../state/useMachine";
import { useUi } from "../state/useUi";
import { AppWindow } from "./AppWindow";
import { TaskManager } from "./TaskManager";
import { Toasts } from "./Toasts";
import { Window } from "./Window";

/**
 * The Desktop holds one window per running app, plus the Task Manager. Closing a
 * window is a real `kill()` syscall — the window and the process are the same thing.
 */
export function Desktop() {
  const state = useKernelState();
  const windows = useUi((s) => s.windows);
  const byId = new Map(state.processes.map((p) => [p.pid, p]));

  const ordered = [...windows].sort((a, b) => a.z - b.z);

  return (
    <div className="desktop">
      {ordered.map((win) => {
        if (win.kind === "taskmanager") {
          return (
            <Window key={win.id} win={win} icon="🧭" title="Task Manager">
              <TaskManager />
            </Window>
          );
        }

        const proc = win.pid === undefined ? undefined : byId.get(win.pid);
        if (!proc || proc.state === "terminated") return null;

        const app = appForPid(proc.appId);
        const progress = 1 - proc.burstRemaining / proc.burstTotal;

        return (
          <Window
            key={win.id}
            win={win}
            icon={app?.icon ?? "📦"}
            title={proc.name}
            pid={proc.pid}
            progress={progress}
          >
            <AppWindow proc={proc} />
          </Window>
        );
      })}

      {state.processes.length === 0 && (
        <div className="desktop__hint">
          <h2>An empty desktop</h2>
          <p>
            Click an app in the Dock to start a process. Then open the X-ray panel to watch the
            kernel decide who gets the CPU next.
          </p>
          <p>
            <kbd>Space</kbd> run / pause · <kbd>→</kbd> step one tick · <kbd>X</kbd> X-ray ·{" "}
            <kbd>Esc</kbd> deselect
          </p>
        </div>
      )}

      <Toasts />
    </div>
  );
}
