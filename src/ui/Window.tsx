import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useUi, type Win } from "../state/useUi";

interface DragState {
  dx: number;
  dy: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Props {
  win: Win;
  icon: ReactNode;
  title: string;
  pid?: number;
  progress?: number;
  children: ReactNode;
}

/** A draggable window. `position: absolute` inside the Desktop. */
export function Window({ win, icon, title, pid, progress, children }: Props) {
  const focusWindow = useUi((s) => s.focusWindow);
  const closeWindow = useUi((s) => s.closeWindow);
  const moveWindow = useUi((s) => s.moveWindow);
  const toggleMinimize = useUi((s) => s.toggleMinimize);
  const drag = useRef<DragState | null>(null);

  if (win.minimized) return null;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    focusWindow(win.id);
    if ((e.target as HTMLElement).closest("[data-nodrag]")) return;

    const parent = e.currentTarget.offsetParent as HTMLElement | null;
    const rect = parent?.getBoundingClientRect();
    drag.current = {
      dx: e.clientX - (rect?.left ?? 0) - win.x,
      dy: e.clientY - (rect?.top ?? 0) - win.y,
      left: rect?.left ?? 0,
      top: rect?.top ?? 0,
      width: rect?.width ?? 1200,
      height: rect?.height ?? 700,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const x = Math.max(0, Math.min(d.width - 120, e.clientX - d.left - d.dx));
    const y = Math.max(0, Math.min(d.height - 44, e.clientY - d.top - d.dy));
    moveWindow(win.id, x, y);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return (
    <section
      className="window"
      style={{ left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z }}
      onPointerDown={() => focusWindow(win.id)}
      aria-label={`${title} window`}
    >
      <div
        className="window__bar"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span className="window__icon">{icon}</span>
        <span className="window__title">{title}</span>
        {pid !== undefined && <span className="window__pid">P{pid}</span>}
        <span className="window__spacer" />
        <button
          className="window__btn"
          data-nodrag
          title="Minimise"
          onClick={() => toggleMinimize(win.id)}
        >
          –
        </button>
        <button
          className="window__btn window__btn--close"
          data-nodrag
          title="Close"
          onClick={() => closeWindow(win.id)}
        >
          ×
        </button>
      </div>

      {progress !== undefined && (
        <div
          className="window__progress"
          title={`${Math.round(progress * 100)}% of this process's CPU burst is done`}
        >
          <i>
            {"█".repeat(Math.round(progress * 14))}
            {"░".repeat(14 - Math.round(progress * 14))}
          </i>{" "}
          {Math.round(progress * 100)}%
        </div>
      )}

      <div className="window__body">{children}</div>
    </section>
  );
}
