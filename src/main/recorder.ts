// Запись действий на одном устройстве: ввод из Evelin (касания по плитке, кнопки, текст)
// плюс касания по самому телефону через getevent.

import { performance } from "node:perf_hooks";
import type { NavKey, RecordingStatus, Scenario, StepBody, TouchEvent } from "@shared/types";
import { newScenario } from "@shared/scenario";
import type { DeviceManager } from "./devices";
import { eventsToSteps, findTouchscreen, GeteventParser, type RecordedEvent } from "./recording";

interface Active {
  status: RecordingStatus;
  events: RecordedEvent[];
  t0: number;
  stopPhysical?: () => void;
}

export class Recorder {
  #active: Active | undefined;
  #listeners = new Set<(s: RecordingStatus | null) => void>();
  #notifyTimer: NodeJS.Timeout | undefined;

  constructor(private readonly devices: DeviceManager) {}

  onStatus(listener: (s: RecordingStatus | null) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  get serial(): string | undefined {
    return this.#active?.status.serial;
  }

  status(): RecordingStatus | null {
    return this.#active ? { ...this.#active.status } : null;
  }

  #notify(): void {
    const s = this.status();
    for (const l of this.#listeners) l(s);
  }

  // Счётчик событий обновляется часто — шлём в UI не чаще раза в 200 мс.
  #notifySoon(): void {
    this.#notifyTimer ??= setTimeout(() => {
      this.#notifyTimer = undefined;
      this.#notify();
    }, 200);
  }

  async start(serial: string): Promise<RecordingStatus> {
    if (this.#active) throw new Error(`Уже идёт запись на ${this.#active.status.serial}`);
    const active: Active = { status: { serial, startedAt: Date.now(), events: 0, physical: false }, events: [], t0: performance.now() };
    this.#active = active;
    try {
      active.stopPhysical = await this.#startPhysical(serial, active);
      active.status.physical = true;
    } catch (e) {
      active.status.physicalError = e instanceof Error ? e.message : String(e);
    }
    // Запись могли отменить, пока подключались к сенсору.
    if (this.#active !== active) {
      active.stopPhysical?.();
      throw new Error("Запись отменена");
    }
    this.#notify();
    return { ...active.status };
  }

  async #startPhysical(serial: string, active: Active): Promise<() => void> {
    const [pl, input] = await Promise.all([
      this.devices.shell(serial, "getevent -pl"),
      this.devices.shell(serial, "dumpsys input"),
    ]);
    const screen = findTouchscreen(pl);
    if (!screen) throw new Error("Сенсорный экран не найден в getevent");
    const rotation = Number(/SurfaceOrientation:\s*(\d)/.exec(input)?.[1] ?? 0);

    const parser = new GeteventParser(screen, rotation, (e) => this.#add(active, e));
    const adb = await this.devices.getAdb(serial);
    // PTY, а не обычный exec: без терминала getevent буферизует вывод и тайминги касаний теряются.
    const proc = await adb.subprocess.noneProtocol.pty("getevent -l");
    const decoder = new TextDecoder();
    void (async () => {
      try {
        const reader = proc.output.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.push(decoder.decode(value, { stream: true }));
        }
      } catch {
        // процесс завершён
      }
    })();
    return () => void Promise.resolve(proc.kill()).catch(() => {});
  }

  #add(active: Active, e: { kind: "touch"; action: TouchEvent["action"]; x: number; y: number } | { kind: "key"; key: NavKey } | { kind: "step"; step: StepBody }): void {
    if (this.#active !== active) return;
    active.events.push({ ...e, t: performance.now() - active.t0 } as RecordedEvent);
    active.status.events = active.events.length;
    this.#notifySoon();
  }

  // --- Ввод из интерфейса Evelin; вызывается из обработчиков IPC для всех целевых устройств ---

  captureTouch(serials: string[], e: TouchEvent): void {
    if (this.#active && serials.includes(this.#active.status.serial)) this.#add(this.#active, { kind: "touch", ...e });
  }

  captureKey(serials: string[], key: NavKey): void {
    if (this.#active && serials.includes(this.#active.status.serial)) this.#add(this.#active, { kind: "key", key });
  }

  captureStep(serials: string[], step: StepBody): void {
    if (this.#active && serials.includes(this.#active.status.serial)) this.#add(this.#active, { kind: "step", step });
  }

  // --- Завершение ---

  #finish(): Active | undefined {
    const active = this.#active;
    this.#active = undefined;
    active?.stopPhysical?.();
    clearTimeout(this.#notifyTimer);
    this.#notifyTimer = undefined;
    this.#notify();
    return active;
  }

  /** Возвращает сценарий из записанных шагов (ещё не сохранённый) или undefined, если ничего не записано. */
  stop(deviceName: string): Scenario | undefined {
    const active = this.#finish();
    if (!active) return undefined;
    const steps = eventsToSteps(active.events);
    if (steps.length === 0) return undefined;
    const stamp = new Date(active.status.startedAt).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
    return { ...newScenario(`Запись ${stamp} · ${deviceName}`), steps };
  }

  cancel(): void {
    this.#finish();
  }
}
