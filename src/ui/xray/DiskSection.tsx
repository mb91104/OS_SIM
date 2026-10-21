import { useState } from "react";
import { DISK_MAX, DISK_MIN, type DiskPolicy } from "../../kernel/disk";
import { cylinderForBlock, FS_BLOCKS, listFiles, usedBlocks } from "../../kernel/fs";
import { useKernelState, useMachine } from "../../state/useMachine";

const POLICIES: { id: DiskPolicy; label: string; hint: string }[] = [
  { id: "fcfs", label: "FCFS", hint: "First come, first served — service requests in arrival order" },
  { id: "sstf", label: "SSTF", hint: "Shortest seek time first — always go to the nearest request" },
  { id: "scan", label: "SCAN", hint: "Elevator — sweep to the rim, then reverse" },
  { id: "cscan", label: "C-SCAN", hint: "One-way elevator — sweep, jump back, sweep again" },
  { id: "look", label: "LOOK", hint: "Like SCAN, but reverse at the last request, not the rim" },
  { id: "clook", label: "C-LOOK", hint: "Jump straight to the farthest request, then keep going" },
];

const TEXTBOOK = [98, 183, 37, 122, 14, 124, 65, 67];

/** Cylinder (0–199) → x coordinate in the little SVG track. */
const X0 = 10;
const XW = 272;
const toX = (c: number) => X0 + (c / DISK_MAX) * XW;

function Track() {
  const disk = useKernelState().disk;
  const headX = toX(disk.headPosition);

  return (
    <svg
      className="disk-track"
      viewBox="0 0 300 58"
      role="img"
      aria-label="Disk head position and request queue"
    >
      <rect x={X0} y={26} width={XW} height={6} rx={0} fill="var(--surface-3)" />
      {[0, 50, 100, 150, 199].map((c) => (
        <g key={c}>
          <line x1={toX(c)} x2={toX(c)} y1={32} y2={36} stroke="var(--line)" strokeWidth={1} />
          <text x={toX(c)} y={46} fontSize={7} fill="var(--muted-2)" textAnchor="middle">
            {c}
          </text>
        </g>
      ))}

      {/* Requests still waiting. */}
      {disk.queue.map((c, i) => (
        <circle key={`${c}-${i}`} cx={toX(c)} cy={29} r={2.6} fill="var(--text)" />
      ))}

      {/* Where the head has already been. */}
      {disk.serviced.slice(-12).map((c, i) => (
        <circle key={`s-${c}-${i}`} cx={toX(c)} cy={29} r={1.7} fill="var(--muted-2)" opacity={0.55} />
      ))}

      {/* The last movement. */}
      {disk.lastMove && (
        <line
          x1={toX(disk.lastMove.from)}
          x2={toX(disk.lastMove.to)}
          y1={18}
          y2={18}
          stroke={disk.lastMove.kind === "sweep" ? "var(--muted-2)" : "var(--text)"}
          strokeWidth={1}
          strokeDasharray={disk.lastMove.kind === "sweep" ? "3 2" : undefined}
        />
      )}

      {/* The head. */}
      <polygon points={`${headX},8 ${headX - 4},15 ${headX + 4},15`} fill="var(--text)" />
      <line x1={headX} x2={headX} y1={15} y2={26} stroke="var(--text)" strokeWidth={1} />
      <text x={headX} y={5} fontSize={7.5} fill="var(--text)" textAnchor="middle" fontWeight={700}>
        {disk.headPosition}
      </text>
    </svg>
  );
}

export function DiskSection() {
  const state = useKernelState();
  const disk = state.disk;
  const setPolicy = useMachine((s) => s.setDiskPolicy);
  const request = useMachine((s) => s.requestCylinder);
  const step = useMachine((s) => s.stepDisk);
  const drain = useMachine((s) => s.drainDisk);
  const clear = useMachine((s) => s.clearDisk);
  const reset = useMachine((s) => s.resetDisk);
  const readFile = useMachine((s) => s.readFile);
  const [value, setValue] = useState("98");

  const hint = POLICIES.find((p) => p.id === disk.policy)?.hint ?? "";

  const add = () => {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    request(n);
  };

  return (
    <>
      <div className="panel">
        <div className="panel__title">
          Disk head
          <small>
            {disk.direction === 1 ? "moving →" : "moving ←"} · {disk.queue.length} waiting
          </small>
        </div>

        <Track />

        <label className="memctl__row">
          <span className="toolbar__label" title={hint}>
            Order
          </span>
          <select
            className="policy-select"
            value={disk.policy}
            onChange={(e) => setPolicy(e.target.value as DiskPolicy)}
            title={hint}
          >
            {POLICIES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <div className="diskform">
          <input
            className="diskform__input"
            type="number"
            min={DISK_MIN}
            max={DISK_MAX}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
            aria-label="Requested cylinder"
          />
          <button className="btn" onClick={add}>
            + Request
          </button>
          <button
            className="btn"
            title="Queue the classic textbook request list"
            onClick={() => {
              for (const c of TEXTBOOK) request(c);
            }}
          >
            Textbook queue
          </button>
        </div>

        <div className="diskform">
          <button className="btn btn--primary" onClick={step} disabled={disk.queue.length === 0}>
            step head
          </button>
          <button className="btn" onClick={drain} disabled={disk.queue.length === 0}>
            Run to empty
          </button>
          <button className="btn" onClick={clear} disabled={disk.queue.length === 0}>
            Clear
          </button>
          <button className="btn" onClick={reset}>
            Park
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="panel__title">
          Seek accounting
          <small>{disk.policy.toUpperCase()}</small>
        </div>
        <div className="metrics">
          <div className="metric">
            <span>Head at</span>
            <b>{disk.headPosition}</b>
          </div>
          <div className="metric">
            <span>Requests left</span>
            <b>{disk.queue.length}</b>
          </div>
          <div className="metric">
            <span>Total seek</span>
            <b>{disk.totalSeekTime}</b>
          </div>
          <div className="metric">
            <span>Cylinders moved</span>
            <b>{disk.serviced.length}</b>
          </div>
        </div>

        <p className="note" style={{ marginTop: 8 }}>
          {disk.lastMove
            ? `Last move: ${disk.lastMove.from} → ${disk.lastMove.to}, a seek of ${disk.lastMove.seek} cylinders.`
            : "The head is idle. Add a request or load the textbook queue."}
        </p>

        {disk.serviced.length > 0 && (
          <p className="note" style={{ marginTop: 4 }}>
            Order: {disk.serviced.join(" → ")}
          </p>
        )}

        <p className="note" style={{ marginTop: 4 }}>
          Seek time is measured in cylinders: moving one track costs one unit. Compare the total for
          each policy — the clever ones make the head travel much less, but can starve far requests.
        </p>
      </div>

      <div className="panel">
        <div className="panel__title">
          Filesystem
          <small>
            {usedBlocks(state.fs)}/{FS_BLOCKS} blocks
          </small>
        </div>

        <div className="fsgrid">
          {state.fs.map((block) => (
            <div
              key={block.index}
              className={`fsblock fsblock--${block.kind}`}
              title={`Block ${block.index} · ${block.kind}${
                block.label ? ` · ${block.label}` : ""
              } · cylinder ${cylinderForBlock(block.index)}`}
            >
              {block.index}
            </div>
          ))}
        </div>

        <div className="fslegend">
          <span><i className="fsblock fsblock--dir" /> directory</span>
          <span><i className="fsblock fsblock--index" /> inode</span>
          <span><i className="fsblock fsblock--file" /> data</span>
          <span><i className="fsblock fsblock--free" /> free</span>
        </div>

        {listFiles(state.fs).length === 0 ? (
          <p className="note">No files yet. Open the Files app and create one.</p>
        ) : (
          listFiles(state.fs).map((file) => {
            const cylinders = state.fs
              .filter((b) => b.label === file.name && b.kind !== "free")
              .map((b) => cylinderForBlock(b.index));
            return (
              <div className="fake__row" key={file.name}>
                <span>
                  <span className="term__line--muted">-rw- </span>
                  {file.name}{" "}
                  <span className="dim">
                    blocks {file.start}–{file.start + file.blocks - 1}
                  </span>
                </span>
                <span className="fs-row__actions">
                  <button className="btn btn--tiny" onClick={() => readFile(file.name)}>
                    queue {cylinders.length} read{cylinders.length === 1 ? "" : "s"}
                  </button>
                </span>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
