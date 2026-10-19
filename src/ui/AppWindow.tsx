import type { Pcb } from "../kernel/types";

/**
 * The inside of an app window. Each one is a toy, but the progress bar above it
 * is real: it fills only while the process owns the CPU, so three open windows
 * fill in rotation. That is Round Robin, felt rather than explained.
 */
export function AppWindow({ proc }: { proc: Pcb }) {
  const appId = proc.appId;

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
          {[
            ["holiday.jpg", "2.4 MB"],
            ["project.zip", "18 MB"],
            ["notes.txt", "4 KB"],
            ["song.mp3", "6.1 MB"],
          ].map(([name, size]) => (
            <div className="fake__row" key={name}>
              <span>📄 {name}</span>
              <span>{size}</span>
            </div>
          ))}
          <p className="note">
            Reading a file means asking the disk for specific blocks. Open the X-ray panel's Disk tab
            to watch the head travel between them.
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
            There is only one printer. Two apps printing at once can end up waiting on each other
            forever — that is deadlock, and you will be able to cause it in M6.
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
