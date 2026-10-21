import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-700.css";
import { App } from "./App";
import { applyDeadlockDemo, applyDemoScenario, applyDeviceDemo, applyFilesDemo, DEMO_APPS } from "./state/demoScenario";
import { applyScenario, scenarioFromUrl } from "./state/scenario";
import "./styles/global.css";

const container = document.getElementById("root");
if (!container) throw new Error("Root container missing from index.html");

// ?demo=1 pre-loads a few apps so a demo or a screenshot always starts the same.
// ?demo=1&ff=45 also fast-forwards 45 simulated ms before rendering.
// A shared scenario link (?s=…&apps=…) wins over the demo shortcut.
const params = new URLSearchParams(window.location.search);
const scenario = scenarioFromUrl(window.location.search);
if (scenario) {
  applyScenario(scenario);
} else if (params.get("demo") === "deadlock") {
  applyDeadlockDemo();
} else if (params.get("demo") === "devices") {
  applyDeviceDemo();
} else if (params.get("demo") === "files") {
  applyFilesDemo();
} else if (params.has("demo")) {
  applyDemoScenario(DEMO_APPS, Number(params.get("ff") ?? 0) || 0);
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
