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

/** ?demo=devices — two Printer apps fighting over the one printer. */
export function applyDeviceDemo(): void {
  for (let i = 0; i < 2; i++) {
    const pid = useMachine.getState().launch("printer");
    useUi.getState().openApp(pid, "printer");
  }
  useMachine.getState().advanceTicks(2);
  useUi.getState().setXrayTab("devices");
}

/** ?demo=deadlock — two processes each holding what the other wants. */
export function applyDeadlockDemo(): void {
  useMachine.getState().launch("printer");
  useMachine.getState().launch("camera");
  useMachine.getState().advanceTicks(2);
  useMachine.getState().requestDevice(1, "camera");
  useMachine.getState().requestDevice(2, "printer");
  useMachine.getState().pause();
  useUi.getState().setXrayTab("devices");
}

/** ?demo=files — a Files window with a couple of readable files. */
export function applyFilesDemo(): void {
  const { launch, createFile, readFile } = useMachine.getState();
  const pid = launch("files");
  useUi.getState().openApp(pid, "files");
  createFile("holiday.jpg", 3);
  createFile("notes.txt", 1);
  readFile("holiday.jpg");
  useMachine.getState().advanceTicks(2);
  useUi.getState().setXrayTab("disk");
  useMachine.getState().play();
}
