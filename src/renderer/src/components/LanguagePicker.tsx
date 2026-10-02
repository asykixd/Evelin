import { useState, type ReactNode } from "react";
import { LANG_NAMES, LANGS, tIn, type Lang } from "@shared/i18n";
import { errorText } from "../errors";
import { useSettings } from "../settings";

/** Shown instead of the app until the user picks a language on first run. */
export function LanguageGate({ children }: { children: ReactNode }) {
  const { settings, update } = useSettings();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  if (settings.languageChosen) return children;

  // The detected language goes first: it's the likely pick.
  const langs = [settings.language, ...LANGS.filter((l) => l !== settings.language)];

  async function pick(language: Lang): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await update({ language, languageChosen: true });
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal lang-modal">
        {langs.map((l) => (
          <div key={l} className="lang-title" lang={l}>
            {tIn(l, "lang.pick")}
          </div>
        ))}
        <div className="lang-options">
          {langs.map((l) => (
            <button key={l} className={`btn${l === settings.language ? " primary" : ""}`} disabled={busy} onClick={() => void pick(l)}>
              {LANG_NAMES[l]}
            </button>
          ))}
        </div>
        {error && <p className="hint error">{error}</p>}
        <p className="hint">{langs.map((l) => tIn(l, "lang.pickHint")).join(" / ")}</p>
      </div>
    </div>
  );
}
