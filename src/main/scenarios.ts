// Хранилище сценариев: userData/scenarios.json. Секретов здесь нет, поэтому файл не шифруется.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { newId, sanitizeScenario } from "@shared/scenario";
import type { Scenario } from "@shared/types";

export class ScenarioStore {
  #scenarios: Scenario[] = [];
  #saving: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.path, "utf8")) as unknown;
      if (!Array.isArray(raw)) return;
      for (const item of raw) {
        try {
          this.#scenarios.push(sanitizeScenario(item));
        } catch (e) {
          console.warn("[scenarios] пропущен повреждённый сценарий:", e);
        }
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") console.warn("[scenarios] не удалось прочитать сценарии:", e);
    }
  }

  list(): Scenario[] {
    return [...this.#scenarios].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): Scenario | undefined {
    return this.#scenarios.find((s) => s.id === id);
  }

  async save(raw: unknown): Promise<Scenario> {
    const scenario = sanitizeScenario(raw);
    const i = this.#scenarios.findIndex((s) => s.id === scenario.id);
    if (i >= 0) this.#scenarios[i] = scenario;
    else this.#scenarios.push(scenario);
    await this.#persist();
    return scenario;
  }

  /** Импорт: всегда новые id, чтобы не затереть существующие сценарии. Ссылки runScenario внутри файла переназначаются. */
  async import(raw: unknown): Promise<Scenario[]> {
    const items = Array.isArray(raw) ? raw : [raw];
    const parsed = items.map(sanitizeScenario);
    const ids = new Map(parsed.map((s) => [s.id, newId()]));
    const imported = parsed.map((s) => ({
      ...s,
      id: ids.get(s.id)!,
      steps: s.steps.map((step) => (step.type === "runScenario" && ids.has(step.scenarioId) ? { ...step, scenarioId: ids.get(step.scenarioId)! } : step)),
    }));
    this.#scenarios.push(...imported);
    await this.#persist();
    return imported;
  }

  async remove(id: string): Promise<void> {
    this.#scenarios = this.#scenarios.filter((s) => s.id !== id);
    await this.#persist();
  }

  #persist(): Promise<void> {
    // Записи сериализуются, а файл подменяется атомарно, чтобы не получить обрезанный JSON.
    this.#saving = this.#saving.catch(() => {}).then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      await writeFile(tmp, JSON.stringify(this.#scenarios, null, 2));
      await rename(tmp, this.path);
    });
    return this.#saving;
  }
}
