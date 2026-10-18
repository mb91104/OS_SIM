import { useEffect } from "react";
import { BASE_TICKS_PER_SECOND, useMachine } from "./useMachine";
import { useUi } from "./useUi";

/**
 * The only place real time touches the simulator. A `requestAnimationFrame` loop
 * converts elapsed wall-clock time into *whole ticks* — the kernel never sees a
 * fractional millisecond, which keeps every run reproducible.
 */
export function useClock() {
  const running = useMachine((s) => s.running);
  const speed = useMachine((s) => s.speed);

  useEffect(() => {
    if (!running) return;

    let raf = 0;
    let last = performance.now();
    let carry = 0;

    const loop = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      carry += dt * BASE_TICKS_PER_SECOND * speed;

      const ticks = Math.floor(carry);
      if (ticks > 0) {
        carry -= ticks;
        useMachine.getState().advanceTicks(Math.min(ticks, 48));
      }

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, speed]);
}

/** Keyboard shortcuts, so the simulator can be driven from a projector. */
export function useKeyboard() {
  const step = useMachine((s) => s.step);
  const togglePlay = useMachine((s) => s.togglePlay);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowRight":
        case ".":
          e.preventDefault();
          step();
          break;
        case "x":
        case "X": {
          const ui = useUi.getState();
          ui.setXrayOpen(!ui.xrayOpen);
          break;
        }
        case "Escape":
          useUi.getState().select(null);
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, togglePlay]);
}
