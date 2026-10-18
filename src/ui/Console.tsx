import { useEffect, useRef } from "react";
import { formatClock } from "../lib/format";
import { useKernelState } from "../state/useMachine";

const VISIBLE_LINES = 7;

/**
 * The narration console. Every meaningful thing the kernel does gets one plain
 * English sentence here — this is where a student reads *why* the picture moved.
 */
export function Console() {
  const state = useKernelState();
  const lines = state.log.slice(-VISIBLE_LINES);
  const scroller = useRef<HTMLDivElement>(null);
  const lastId = state.log[state.log.length - 1]?.id ?? 0;

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastId]);

  return (
    <div className="console" ref={scroller} aria-live="polite">
      {lines.map((line) => (
        <div className="console__line" key={line.id} data-kind={line.kind}>
          <span className="console__t">{formatClock(line.t)}</span>
          <span className="console__tick">·</span>
          <span className="console__text">
            {line.chip && <span className="chip">{line.chip}</span>} {line.text}
          </span>
        </div>
      ))}
    </div>
  );
}
