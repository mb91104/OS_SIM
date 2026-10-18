import { useClock, useKeyboard } from "./state/useClock";
import { useKernelWatch } from "./state/useKernelWatch";
import { useIsLive } from "./state/useMachine";
import { Console } from "./ui/Console";
import { Desktop } from "./ui/Desktop";
import { Dock } from "./ui/Dock";
import { Timeline } from "./ui/Timeline";
import { Toolbar } from "./ui/Toolbar";
import { XrayPanel } from "./ui/xray/XrayPanel";

export function App() {
  useClock();
  useKeyboard();
  useKernelWatch();

  const replaying = !useIsLive();

  return (
    <div className={`app ${replaying ? "is-replaying" : ""}`}>
      <Toolbar />
      <Timeline />
      <div className="stage">
        <Desktop />
        <XrayPanel />
      </div>
      <footer>
        <Console />
        <Dock />
      </footer>
    </div>
  );
}
