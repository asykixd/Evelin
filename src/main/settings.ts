import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setLang, type Lang } from "@shared/i18n";
import { defaultSettings, loadSettings, mergeSettings } from "@shared/settings";
import type { AppSettings } from "@shared/types";

export class SettingsStore {
  #settings: AppSettings;
  #saving: Promise<void> = Promise.resolve();
  #listeners = new Set<(next: AppSettings, prev: AppSettings) => void>();

  constructor(private readonly path: string) {
    this.#settings = defaultSettings("ru");
  }

  /** `defaultLang` applies on first run only. */
  async load(defaultLang: Lang): Promise<void> {
    this.#settings = defaultSettings(defaultLang);
    try {
      const raw: unknown = JSON.parse(await readFile(this.path, "utf8"));
      this.#settings = loadSettings(raw, this.#settings);
      // Settings saved before the first-run picker existed: the user already lives with their language.
      if (raw && typeof raw === "object" && !("languageChosen" in raw)) this.#settings.languageChosen = true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") console.warn("[settings] не удалось прочитать настройки:", e);
    }
    setLang(this.#settings.language);
  }

  get(): AppSettings {
    return structuredClone(this.#settings);
  }

  onChange(listener: (next: AppSettings, prev: AppSettings) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async update(patch: unknown): Promise<AppSettings> {
    const prev = this.#settings;
    this.#settings = mergeSettings(prev, patch);
    setLang(this.#settings.language);
    await this.#persist();
    for (const l of this.#listeners) l(this.get(), prev);
    return this.get();
  }

  #persist(): Promise<void> {
    // Serialized writes plus atomic rename, same as scenarios.
    this.#saving = this.#saving.catch(() => {}).then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      await writeFile(tmp, JSON.stringify(this.#settings, null, 2));
      await rename(tmp, this.path);
    });
    return this.#saving;
  }
}
