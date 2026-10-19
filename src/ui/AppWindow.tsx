import { useState } from "react";
import { FS_BLOCKS, listFiles, usedBlocks } from "../kernel/fs";
import type { Pcb } from "../kernel/types";
import { useKernelState, useMachine } from "../state/useMachine";

/**
 * The inside of an app window. Each one is a toy, but the progress bar above it
 * is real: it fills only while the process owns the CPU, so three open windows
 * fill in rotation. That is Round Robin, felt rather than explained.
 */
export function AppWindow({ proc }: { proc: Pcb }) {
  const appId = proc.appId;
  const state = useKernelState();
  const createFile = useMachine((s) => s.createFile);
  const deleteFile = useMachine((s) => s.deleteFile);
  const readFile = useMachine((s) => s.readFile);
  const [fileName, setFileName] = useState("notes.txt");

  switch (appId) {
    case "browser":
      return (
        <div className="fake">
          <div className="fake__bar">🔒 toyos://news/today</div>
          <div className="fake__line" style={{ width: "82%" }} />
          <div className="fake__line" style={{ width: "96%" }} />
          <div className="fake__line" style={{ width: "70%" }} />
          <div className="fake__line" style={{ width: "88%" }} />
          <p className="note">
            Loading a page is bursty: the app waits, then crunches. Watch its CPU time get handed out
            in slices, not all at once.
          </p>
        </div>
      );

    case "music":
      return (
        <div className="fake">
          <div className="eq">
            {Array.from({ length: 9 }).map((_, i) => (
              <i key={i} style={{ animationDelay: `${i * 0.12}s` }} />
            ))}
          </div>
          <div className="fake__row">
            <span>▶ Now playing</span>
            <span>Lo-fi Kernel Beats</span>
          </div>
          <p className="note">
            Audio has to be fed constantly. If this process waits too long for the CPU, the sound
            stutters — that is why real systems give it high priority.
          </p>
        </div>
      );

    case "photos":
      return (
        <div className="fake">
          <div className="fake__tiles">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="fake__tile"
                style={{ filter: `hue-rotate(${i * 52}deg)` }}
              />
            ))}
          </div>
          <p className="note">
            Filters need both CPU time and several pages of memory. Open the X-ray panel's Memory tab:
            four pages do not always fit in RAM at once.
          </p>
        </div>
      );

    case "files":
      return (
        <div className="fake">
          <div className="fake__row">
            <span>
              📁 / ({usedBlocks(state.fs)}/{FS_BLOCKS} blocks used)
            </span>
            <span>{listFiles(state.fs).length} file(s)</span>
          </div>

          {listFiles(state.fs).length === 0 ? (
            <p className="note">The disk is empty. Create a file below.</p>
          ) : (
            listFiles(state.fs).map((file) => (
              <div className="fake__row" key={file.name}>
                <span>📄 {file.name}</span>
                <span className="fs-row__actions">
                  <span className="dim">
                    {file.blocks} block{file.blocks === 1 ? "" : "s"}
                  </span>
                  <button className="btn btn--tiny" onClick={() => readFile(file.name)}>
                    read
                  </button>
                  <button className="btn btn--tiny" onClick={() => deleteFile(file.name)}>
                    delete
                  </button>
                </span>
              </div>
            ))
          )}

          <div className="diskform" style={{ marginTop: 8 }}>
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
              + Create
            </button>
          </div>

          <p className="note">
            Reading a file asks the disk for one block per file block. Open the X-ray panel's Disk
            tab to watch the head travel between the cylinders those blocks live on.
          </p>
        </div>
      );

    case "printer":
      return (
        <div className="fake">
          <div className="fake__row">
            <span>🖨️ Document</span>
            <span>{proc.memPages} pages of RAM buffered</span>
          </div>
          <div className="fake__line" style={{ width: "60%" }} />
          <div className="fake__line" style={{ width: "90%" }} />
          <div className="fake__line" style={{ width: "45%" }} />
          <p className="note">
            There is only one printer. A second Printer app waits in the device queue — open the
            X-ray panel's Devices tab to see the wait. Ask two processes for each other's device to
            cause a deadlock.
          </p>
        </div>
      );

    case "code":
      return (
        <div className="fake">
          <div className="fake__row">
            <span style={{ fontFamily: "var(--mono)" }}>main.ts</span>
            <span>compiling…</span>
          </div>
          <pre
            style={{
              margin: 0,
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--muted)",
              lineHeight: 1.6,
            }}
          >
            {`for (const page of pages) {
  render(page);
}`}
          </pre>
          <p className="note">
            Editing is calm; compiling is a long burst of pure CPU. Same app, two very different
            workloads.
          </p>
        </div>
      );

    case "camera":
      return (
        <div className="fake">
          <div className="fake__row">
            <span>
              <span className="fake__rec" /> REC
            </span>
            <span>00:0{(proc.pid % 9) + 1}</span>
          </div>
          <div
            className="fake__tile"
            style={{ aspectRatio: "16 / 9", background: "linear-gradient(140deg,#1b2450,#0d1330)" }}
          />
          <p className="note">
            Video must be processed in real time. Miss a deadline and a frame is dropped — the
            classic reason for a high-priority process.
          </p>
        </div>
      );

    default:
      return (
        <div className="fake">
          <p className="note">A process with no visible window. It still uses the CPU.</p>
        </div>
      );
  }
}
