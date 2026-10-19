import {
  faultRate,
  FRAMES_MAX,
  FRAMES_MIN,
  freeFrameCount,
  memoryUsage,
  type Replacement,
} from "../../kernel/memory";
import type { Frame } from "../../kernel/types";
import { formatPercent } from "../../lib/format";
import { useKernelState, useMachine } from "../../state/useMachine";
import { useUi } from "../../state/useUi";

const REPLACEMENTS: { id: Replacement; label: string; hint: string }[] = [
  { id: "lru", label: "LRU", hint: "Least recently used — evict the page untouched for the longest" },
  { id: "fifo", label: "FIFO", hint: "First in, first out — evict the page that arrived earliest" },
  { id: "clock", label: "Clock", hint: "Second chance — sweep a hand around, skip recently used pages" },
  { id: "optimal", label: "OPT", hint: "Belady's optimal — evict the page wanted farthest in the future" },
];

function FrameCell({ frame, selected }: { frame: Frame; selected: boolean }) {
  const state = useKernelState();
  const proc = frame.pid === null ? undefined : state.processes.find((p) => p.pid === frame.pid);
  const select = useUi((s) => s.select);

  if (!proc) {
    return (
      <div className="frame frame--free" title={`Frame ${frame.index} — free`}>
        <span className="frame__idx">{frame.index}</span>
        <span className="frame__body">free</span>
      </div>
    );
  }

  return (
    <button
      className={`frame frame--used ${selected ? "is-selected" : ""}`}
      style={{ borderColor: proc.color }}
      onClick={() => select(proc.pid)}
      title={`Frame ${frame.index} — ${proc.name} page ${frame.page}, loaded at T+${frame.loadedAt}`}
    >
      <span className="frame__idx">{frame.index}</span>
      <span className="frame__body">
        <i className="pchip__dot" style={{ background: proc.color }} />
        P{proc.pid}
        <small>page {frame.page}</small>
      </span>
    </button>
  );
}

export function MemorySection() {
  const state = useKernelState();
  const setFrames = useMachine((s) => s.setFrames);
  const setReplacement = useMachine((s) => s.setReplacement);
  const selectedPid = useUi((s) => s.selectedPid);

  const mem = state.memory;
  const free = freeFrameCount(mem);
  const used = mem.frames.length - free;
  const kb = mem.frames.length * mem.pageSizeKb;
  const rate = faultRate(mem);
  const hint = REPLACEMENTS.find((r) => r.id === mem.replacement)?.hint ?? "";

  return (
    <>
      <div className="panel">
        <div className="panel__title">
          Physical memory
          <small>
            {used}/{mem.frames.length} frames · {kb} KB
          </small>
        </div>

        <div className="framegrid">
          {mem.frames.map((frame) => (
            <FrameCell key={frame.index} frame={frame} selected={frame.pid === selectedPid} />
          ))}
        </div>

        <div className="memctl">
          <label className="memctl__row">
            <span className="toolbar__label">Frames</span>
            <input
              className="slider"
              type="range"
              min={FRAMES_MIN}
              max={FRAMES_MAX}
              step={1}
              value={mem.frames.length}
              onChange={(e) => setFrames(Number(e.target.value))}
            />
            <span className="value">{mem.frames.length}</span>
          </label>

          <label className="memctl__row">
            <span className="toolbar__label" title={hint}>
              When full
            </span>
            <select
              className="policy-select"
              value={mem.replacement}
              onChange={(e) => setReplacement(e.target.value as Replacement)}
              title={hint}
            >
              {REPLACEMENTS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="panel">
        <div className="panel__title">
          Paging
          <small>how often memory had to be fetched</small>
        </div>
        <div className="metrics">
          <div className="metric">
            <span>Pages in RAM</span>
            <b>{formatPercent(memoryUsage(mem))}</b>
          </div>
          <div className="metric">
            <span>Hits</span>
            <b>{mem.hits}</b>
          </div>
          <div className="metric">
            <span>Page faults</span>
            <b>{mem.pageFaults}</b>
          </div>
          <div className="metric">
            <span>Fault rate</span>
            <b>{formatPercent(rate)}</b>
          </div>
          <div className="metric">
            <span>Evictions</span>
            <b>{mem.evictions}</b>
          </div>
          <div className="metric">
            <span>Clock hand</span>
            <b>{mem.replacement === "clock" ? mem.clockHand : "—"}</b>
          </div>
        </div>

        <p className="note">
          Each process walks through its pages as it runs. A page that is already in a frame is a{" "}
          <b>hit</b>; one that is not is a <b>page fault</b>, and the kernel must fetch it — evicting
          another page when memory is full. Try a smaller frame count and compare LRU with OPT.
        </p>

        {mem.frames.some((f) => f.pid !== null) && (
          <p className="note" style={{ marginTop: 4 }}>
            Resident pages:{" "}
            {state.processes
              .filter((p) => mem.frames.some((f) => f.pid === p.pid))
              .map((p) => `P${p.pid} (${mem.frames.filter((f) => f.pid === p.pid).length}/${p.memPages})`)
              .join(" · ")}
          </p>
        )}
      </div>
    </>
  );
}
