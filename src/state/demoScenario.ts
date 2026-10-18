import { useMachine } from "./useMachine";
import { useUi } from "./useUi";

/**
 * Seeds the machine with a set of running apps. Two uses:
 *   - `?demo=1` in the URL, so a screenshot or a classroom demo is reproducible;
 *   - the basis of shareable scenario links (milestone M7).
 */
export const DEMO_APPS = ["browser", "music", "photos", "files"];

export function applyDemoScenario(apps: string[] = DEMO_APPS, fastForward = 0): void {
  for (const appId of apps) {
    const pid = useMachine.getState().launch(appId);
    useUi.getState().openApp(pid, appId);
  }
  if (fastForward > 0) useMachine.getState().advanceTicks(fastForward);
  useMachine.getState().play();
}
