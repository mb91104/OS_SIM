import { useState } from "react";
import { FS_BLOCKS, listFiles, usedBlocks } from "../kernel/fs";
import { residentPages } from "../kernel/memory";
import type { Pcb } from "../kernel/types";
import { useKernelState, useMachine } from "../state/useMachine";

/**
 * The inside of an app window. Each one is a terminal readout rather than a
 * fake GUI: the numbers and the little ASCII meters are driven by the PCB, so
 * they move when the process gets the CPU and rewind with the scrubber. That is
 * Round Robin, felt rather than explained.
 */

/** Deterministic "animation" — a function of simulated time, never wall clock. */
function wave(seed: number, length: number, bars: string): string {
  let out = "";
  for (let i = 0; i < length; i++) out += bars[(seed + i * 5) % bars.length];
  return out;
}

function Cursor() {
  return <span className="term__cursor" aria-hidden="true" />;
}

export function AppWindow({ proc }: { proc: Pcb }) {
  const appId = proc.appId;
  const state = useKernelState();
  const createFile = useMachine((s) => s.createFile);
  const deleteFile = useMachine((s) => s.deleteFile);
  const readFile = useMachine((s) => s.readFile);
  const [fileName, setFileName] = useState("notes.txt");

  const done = proc.burstTotal - proc.burstRemaining;
  const percent = Math.round((done / proc.burstTotal) * 100);

  switch (appId) {
    case "browser":
      return (
        <div className="term">
          <div className="term__line">
            <span className="term__prompt">$</span> GET toyos://news/today
          </div>
          <div className="term__line term__line--muted">{"  resolve toyos.local ..... ok"}</div>
          <div className="term__line term__line--muted">{"  fetch 4 resources ...... 3 done"}</div>
          <div className="term__line">
            <span className="term__ok">200 OK</span>
            <span className="term__line--dim">
              {"  1.2 KB  cpu "}
              {done}/{proc.burstTotal} ms
            </span>
          </div>
          <div className="rule">{"─".repeat(46)}</div>
          <div className="term__line term__line--dim">{`  <h1>today</h1>`}</div>
          <div className="term__line term__line--muted">{`  <p>the kernel decided ...</p>`}</div>
          <div className="term__line">
            <span className="term__prompt">$</span> <Cursor />
          </div>
          <p className="term__note">
            Loading a page is bursty: the app waits, then crunches. Watch its CPU time get handed out
            in slices, not all at once.
          </p>
        </div>
      );

    case "music":
      return (
        <div className="term">
          <div className="term__line">
            <span className="term__prompt">$</span> play lo-fi-kernel-beats.wav
          </div>
          <div className="term__line term__line--dim">
            {`  device  SND ${proc.heldDevices.includes("speakers") ? "acquired" : "—"}`}
          </div>
          <div className="term__line term__line--dim">
            {`  buffer  ${Math.max(1, 12 - (proc.burstRemaining % 12))}/12 frames`}
          </div>
          <div className="rule">{"─".repeat(46)}</div>
          <div className="vu">
            {wave(proc.burstRemaining, 22, "▁▂▃▄▅▆▇█")} <small>[-6.0 dB]</small>
          </div>
          <div className="term__line term__line--muted">{"  01  lo-fi kernel beats   3:41"}</div>
          <div className="term__line">
            <span className="term__prompt">▶</span> {percent}% decoded
          </div>
          <p className="term__note">
            Audio has to be fed constantly. If this process waits too long for the CPU, the sound
            stutters — that is why real systems give it high priority.
          </p>
        </div>
      );

    case "photos": {
      const resident = residentPages(state.memory, proc.pid).length;
      return (
        <div className="term">
          <div className="term__line">
            <span className="term__prompt">$</span> filter --preset mono ./holiday/*.png
          </div>
          <div className="term__line term__line--muted">
            {`  pages ${resident}/${proc.memPages} resident in RAM`}
          </div>
          <div className="rule">{"─".repeat(46)}</div>
          <div className="ascii-grid">
            {Array.from({ length: 6 }).map((_, i) => (
              <span key={i}>{(state.now + i * 7) % 3 === 0 ? "▒▒▒" : "░░░"}</span>
            ))}
          </div>
          <div className="term__line term__line--muted">
            {`  pass 1/3  luma ${percent}%  pages ${resident}/${proc.memPages}`}
          </div>
          <div className="term__line">
            <span className="term__prompt">$</span> <Cursor />
          </div>
          <p className="term__note">
            Filters need both CPU time and several pages of memory. Open the X-ray panel's Memory tab:
            four pages do not always fit in RAM at once.
          </p>
        </div>
      );
    }

    case "files":
      return (
        <div className="term">
          <div className="term__line">
            <span className="term__prompt">$</span> ls / — {usedBlocks(state.fs)}/{FS_BLOCKS} blocks used,{" "}
            {listFiles(state.fs).length} file(s)
          </div>

          {listFiles(state.fs).length === 0 ? (
            <p className="term__note">The disk is empty. Create a file below.</p>
          ) : (
            listFiles(state.fs).map((file) => (
              <div className="fake__row" key={file.name}>
                <span>
                  <span className="term__line--muted">-rw- </span>
                  {file.name}{" "}
                  <span className="dim">
                    {file.blocks} block{file.blocks === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="fs-row__actions">
                  <button className="btn btn--tiny" onClick={() => readFile(file.name)}>
                    read
                  </button>
                  <button className="btn btn--tiny" onClick={() => deleteFile(file.name)}>
                    rm
                  </button>
                </span>
              </div>
            ))
          )}

          <div className="diskform" style={{ marginTop: 4 }}>
            <span className="term__prompt">$</span>
            <input
              className="diskform__input"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createFile(fileName, 1);
              }}
              aria-label="New file name"
            />
            <button className="btn" onClick={() => createFile(fileName, 1)}>
              create
            </button>
          </div>

          <p className="term__note">
            Reading a file asks the disk for one block per file block. Open the X-ray panel's Disk
            tab to watch the head travel between the cylinders those blocks live on.
          </p>
        </div>
      );

    case "printer":
      return (
        <div className="term">
          <div className="term__line">
            <span className="term__prompt">$</span> lpr --device PRN ./document.txt
          </div>
          <div className="term__line term__line--dim">
            {`  device  ${proc.heldDevices.includes("printer") ? "PRN acquired" : "PRN — waiting"}`}
          </div>
          <div className="rule">{"─".repeat(46)}</div>
          <div className="term__line term__line--muted">
            {`  spool   job 00${proc.pid} · ${proc.memPages} pages buffered`}
          </div>
          <div className="term__line term__line--muted">
            {`  page 1  ${wave(proc.burstRemaining, 24, "▚▞")}`}
          </div>
          <div className="term__line">
            <span className="term__ok">{percent}%</span> printed
            {proc.blockedTime > 0 ? ` · blocked ${proc.blockedTime} ms` : ""}
          </div>
          <p className="term__note">
            There is only one printer. A second Printer app waits in the device queue — open the
            X-ray panel's Devices tab to see the wait. Ask two processes for each other's device to
            cause a deadlock.
          </p>
        </div>
      );

    case "code":
      return (
        <div className="term">
          <div className="term__line">
            <span className="term__prompt">$</span> tsc -b --pretty false
          </div>
          <div className="term__line term__line--muted">{"  main.ts -> dist/main.js"}</div>
          <div className="term__line term__line--muted">{"  lib/page.ts -> dist/page.js"}</div>
          <div className="rule">{"─".repeat(46)}</div>
          <pre
            style={{
              margin: 0,
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--muted)",
              lineHeight: 1.55,
            }}
          >
            {`for (const page of pages) {
  render(page);
}`}
          </pre>
          <div className="term__line">
            <span className="term__ok">
              {proc.burstRemaining === 0 ? "compiled" : `compiling ${percent}%`}
            </span>
            <span className="term__line--dim">{`  ${done}/${proc.burstTotal} ms of CPU`}</span>
          </div>
          <p className="term__note">
            Editing is calm; compiling is a long burst of pure CPU. Same app, two very different
            workloads.
          </p>
        </div>
      );

    case "camera":
      return (
        <div className="term">
          <div className="term__line">
            <span className="term__prompt">$</span> record --device CAM --fps 30
          </div>
          <div className="term__line">
            <span className="term__ok">REC</span>{" "}
            {`00:0${(state.now % 9) + 1} · ${done}/${proc.burstTotal} ms · ${state.memory.pageSizeKb * proc.memPages} KB`}
          </div>
          <div className="rule">{"▚▞".repeat(23)}</div>
          <div className="ascii-grid">
            {Array.from({ length: 6 }).map((_, i) => (
              <span key={i}>{(state.now + i) % 2 === 0 ? "▓▓" : "▒▒"}</span>
            ))}
          </div>
          <div className="term__line term__line--muted">
            {`  frames ${Math.max(0, Math.floor(done / 4))} · dropped ${proc.blockedTime > 0 ? 1 : 0}`}
          </div>
          <div className="term__line">
            <span className="term__prompt">$</span> <Cursor />
          </div>
          <p className="term__note">
            Video must be processed in real time. Miss a deadline and a frame is dropped — the
            classic reason for a high-priority process.
          </p>
        </div>
      );

    default:
      return (
        <div className="term">
          <div className="term__line term__line--dim">
            A process with no visible window. It still uses the CPU.
          </div>
        </div>
      );
  }
}
