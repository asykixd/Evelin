import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { LanguageGate } from "./components/LanguagePicker";
import { SettingsProvider } from "./settings";
import "./styles.css";

// Load settings before the first render so the UI doesn't flash in the wrong language.
void window.farm.settings.get().then((settings) => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <SettingsProvider initial={settings}>
        <LanguageGate>
          <App />
        </LanguageGate>
      </SettingsProvider>
    </StrictMode>,
  );
});
