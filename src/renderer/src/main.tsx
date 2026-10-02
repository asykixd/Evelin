import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { SettingsProvider } from "./settings";
import "./styles.css";

// Настройки (в том числе язык) нужны до первого рендера, чтобы интерфейс не мигал другим языком.
void window.farm.settings.get().then((settings) => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <SettingsProvider initial={settings}>
        <App />
      </SettingsProvider>
    </StrictMode>,
  );
});
