import { useMemo } from "react";
import type { ProcessState } from "../kernel/types";
import { pidColor } from "../lib/format";
import { useIsLive, useKernelState, useMachine } from "../state/useMachine";

/** The timeline always shows this many simulated milliseconds across its width. */
const SPAN_MS = 200;
/** Internal SVG coordinate width. */
const UNITS = 1000;
const LANE_Y = 6;
const LANE_H = 26;

export function Timeline() {
  const state = useKernelState();
  const live = useIsLive();
  const viewIndex = useMachine((s) => s.viewIndex);
  const historyLength = useMachine((s) => s.history.length);
  const seek = useMachine((s) => s.seek);
  const goLive = useMachine((s) => s.goLive);

  const start = Math.max(0, state.now - SPAN_MS);
  const toUnits = (t: number) => ((t - start) / SPAN_MS) * UNITS;

  const processById = useMemo(() => {
    const map = new Map<number, { name: string; color: string; state: ProcessState }>();
    for (const p of state.processes) {
      map.set(p.pid, { name: p.name, color: p.color, state: p.state });
    }
    return map;
  }, [state.processes]);

  const visible = state.gantt.filter((s) => s.end > start);
  const colourOf = (pid: number) => processById.get(pid)?.color ?? pidColor(pid);

  /* Faint vertical lines every time slice — the rhythm of Round Robin. */
  const gridlines: number[] = [];
  if (SPAN_MS / state.quantum <= 40) {
    for (let t = Math.ceil(start / state.quantum) * state.quantum; t < start + SPAN_MS; t += state.quantum) {
      gridlines.push(t);
    }
  }

  const legend = useMemo(() => {
    const seen = new Map<number, string>();
    for (const s of visible) {
      const p = processById.get(s.pid);
      if (p && !seen.has(s.pid)) seen.set(s.pid, p.name);
    }
    return [...seen.entries()];
  }, [visible, processById]);

  const replaying = !live;

  return (
    <section className="timeline">
      <div className="timeline__head">
        <span>CPU timeline</span>
        <span className={`badge ${replaying ? "badge--past" : "badge--live"}`}>
          {replaying ? "Viewing the past" : "Live"}
        </span>
        <div className="timeline__legend">
          {legend.map(([pid, name]) => (
            <span key={pid} className="timeline__legend-item">
              <i className="timeline__swatch" style={{ background: colourOf(pid) }} />
              {name} · P{pid}
            </span>
          ))}
        </div>
      </div>

      <svg className="gantt" viewBox={`0 0 ${UNITS} 40`} preserveAspectRatio="none" role="img" aria-label="CPU timeline">
        <rect x={0} y={LANE_Y} width={UNITS} height={LANE_H} rx={6} fill="#1a2342" />

        {gridlines.map((t) => (
          <line
            key={t}
            x1={toUnits(t)}
            x2={toUnits(t)}
            y1={LANE_Y}
            y2={LANE_Y + LANE_H}
            stroke="#2b3765"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {visible.map((slice) => {
          const x = toUnits(slice.start);
          const w = Math.max(1, toUnits(slice.end) - x);
          return (
            <g key={`${slice.pid}-${slice.start}`}>
              <rect x={x} y={LANE_Y} width={w} height={LANE_H} fill={colourOf(slice.pid)} rx={0} />
              {w > 26 && (
                <text
                  x={x + w / 2}
                  y={LANE_Y + LANE_H / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={13}
                  fontWeight={700}
                  fill="#08101f"
                >
                  P{slice.pid}
                </text>
              )}
            </g>
          );
        })}

        {/* Playhead */}
        <line
          x1={toUnits(state.now)}
          x2={toUnits(state.now)}
          y1={0}
          y2={40}
          stroke="#e9edff"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />

        <text x={2} y={40} fontSize={9} fill="#6f7cad">
          T+{start}
        </text>
        <text x={UNITS - 2} y={40} fontSize={9} fill="#6f7cad" textAnchor="end">
          T+{start + SPAN_MS}
        </text>
      </svg>

      <div className="scrubber">
        <span className="toolbar__label">Rewind</span>
        <input
          type="range"
          min={0}
          max={Math.max(0, historyLength - 1)}
          step={1}
          value={viewIndex}
          onChange={(e) => seek(Number(e.target.value))}
          title="Drag back through history to re-watch what just happened"
        />
        {replaying ? (
          <button className="btn" onClick={goLive}>
            <span className="btn__icon">⏩</span>
            Back to live
          </button>
        ) : (
          <span className="value" style={{ minWidth: 92 }}>
            every tick
          </span>
        )}
      </div>
    </section>
  );
}
