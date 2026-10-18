import { useEffect, useRef } from "react";
import { useIsLive, useMachine } from "./useMachine";
import { useUi } from "./useUi";

/**
 * Watches the *live* kernel log and reacts to processes ending:
 * the app window closes, and a toast explains what happened. Rewinding the
 * timeline deliberately does not replay these side effects — the past is read-only.
 */
export function useKernelWatch() {
  const live = useMachine((s) => s.live);
  const isLive = useIsLive();
  const lastId = useRef(-1);
  const closeWindowsForPid = useUi((s) => s.closeWindowsForPid);
  const toast = useUi((s) => s.toast);

  useEffect(() => {
    if (!isLive || live.log.length === 0) return;

    const newest = live.log[live.log.length - 1].id;
    const previous = lastId.current;
    lastId.current = newest;

    // First run, a reboot, or log trimming — nothing to announce.
    if (previous === -1 || newest <= previous) return;

    for (const event of live.log) {
      if (event.id <= previous || event.pid === undefined) continue;

      if (event.kind === "exit") {
        const name = live.processes.find((p) => p.pid === event.pid)?.name ?? `P${event.pid}`;
        closeWindowsForPid(event.pid);
        toast(`${name} finished — P${event.pid} was released`, "done");
      } else if (event.kind === "kill") {
        closeWindowsForPid(event.pid);
      }
    }
  }, [live, isLive, closeWindowsForPid, toast]);
}
