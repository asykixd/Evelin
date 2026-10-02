import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { setLang, t } from "@shared/i18n";
import type { AppSettings } from "@shared/types";

interface SettingsContextValue {
  settings: AppSettings;
  /** Throws if main rejects the patch. */
  update(patch: Partial<AppSettings>): Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ initial, children }: { initial: AppSettings; children: ReactNode }) {
  const [settings, setSettings] = useState(initial);
  // Set before children render so t() returns the right language immediately.
  setLang(settings.language);

  useEffect(() => {
    document.documentElement.lang = settings.language;
  }, [settings.language]);

  const update = useCallback(async (patch: Partial<AppSettings>) => setSettings(await window.farm.settings.update(patch)), []);
  const value = useMemo(() => ({ settings, update }), [settings, update]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("SettingsProvider is missing");
  return ctx;
}

/** Returns `t` and re-renders the component when the language changes. */
export function useT(): typeof t {
  useSettings();
  return t;
}
