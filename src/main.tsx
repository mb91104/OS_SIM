import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyDemoScenario, DEMO_APPS } from "./state/demoScenario";
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
} else if (params.has("demo")) {
  applyDemoScenario(DEMO_APPS, Number(params.get("ff") ?? 0) || 0);
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
