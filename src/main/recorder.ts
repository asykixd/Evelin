import { performance } from "node:perf_hooks";
import type { NavKey, RecordingStatus, Scenario, StepBody, TouchEvent } from "@shared/types";
import { locale, t } from "@shared/i18n";
import { newScenario } from "@shared/scenario";
import type { DeviceManager } from "./devices";
import { eventsToSteps, findTouchscreen, GeteventParser, parseRotation, type RecordedEvent } from "./recording";

const ROTATION_POLL_MS = 1000;

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

  #notifySoon(): void {
    this.#notifyTimer ??= setTimeout(() => {
      this.#notifyTimer = undefined;
      this.#notify();
    }, 200);
  }

  async start(serial: string): Promise<RecordingStatus> {
    if (this.#active) throw new Error(t("err.alreadyRecording", { serial: this.#active.status.serial }));
    const active: Active = { status: { serial, startedAt: Date.now(), events: 0, physical: false }, events: [], t0: performance.now() };
    this.#active = active;
    try {
      active.stopPhysical = await this.#startPhysical(serial, active);
      active.status.physical = true;
    } catch (e) {
      active.status.physicalError = e instanceof Error ? e.message : String(e);
    }
    // Recording may have been cancelled while attaching to the touchscreen.
    if (this.#active !== active) {
      active.stopPhysical?.();
      throw new Error(t("err.recordingCancelled"));
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
    if (!screen) throw new Error(t("err.noTouchscreen"));

    const parser = new GeteventParser(screen, parseRotation(input) ?? 0, (e) => this.#add(active, e));
    const adb = await this.devices.getAdb(serial);
    // PTY rather than plain exec: without a terminal getevent buffers output and touch timing is lost.
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
        // process exited
      }
    })();
    // The phone may be turned while recording; sensor coordinates don't rotate with the display.
    const rotationTimer = setInterval(() => {
      this.devices
        .shell(serial, "dumpsys input | grep SurfaceOrientation")
        .then((out) => {
          const rotation = parseRotation(out);
          if (rotation !== undefined) parser.rotation = rotation;
        })
        .catch(() => {});
    }, ROTATION_POLL_MS);
    return () => {
      clearInterval(rotationTimer);
      void Promise.resolve(proc.kill()).catch(() => {});
    };
  }

  #add(active: Active, e: { kind: "touch"; action: TouchEvent["action"]; x: number; y: number } | { kind: "key"; key: NavKey } | { kind: "step"; step: StepBody }): void {
    if (this.#active !== active) return;
    active.events.push({ ...e, t: performance.now() - active.t0 } as RecordedEvent);
    active.status.events = active.events.length;
    this.#notifySoon();
  }

  captureTouch(serials: string[], e: TouchEvent): void {
    if (this.#active && serials.includes(this.#active.status.serial)) this.#add(this.#active, { kind: "touch", ...e });
  }

  captureKey(serials: string[], key: NavKey): void {
    if (this.#active && serials.includes(this.#active.status.serial)) this.#add(this.#active, { kind: "key", key });
  }

  captureStep(serials: string[], step: StepBody): void {
    if (this.#active && serials.includes(this.#active.status.serial)) this.#add(this.#active, { kind: "step", step });
  }

  #finish(): Active | undefined {
    const active = this.#active;
    this.#active = undefined;
    active?.stopPhysical?.();
    clearTimeout(this.#notifyTimer);
    this.#notifyTimer = undefined;
    this.#notify();
    return active;
  }

  stop(deviceName: string): Scenario | undefined {
    const active = this.#finish();
    if (!active) return undefined;
    const steps = eventsToSteps(active.events);
    if (steps.length === 0) return undefined;
    const stamp = new Date(active.status.startedAt).toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" });
    return { ...newScenario(t("scenario.recorded", { stamp, device: deviceName })), steps };
  }

  cancel(): void {
    this.#finish();
  }
}
