import { randomUUID } from "node:crypto";
import { t } from "@shared/i18n";
import { PACKAGE_RE, stepLabel } from "@shared/scenario";
import type { GesturePoint, RunStatus, Scenario, Step } from "@shared/types";
import { shellCommand, type DeviceManager } from "./devices";
import type { MirrorManager } from "./mirror";
import type { ScenarioStore } from "./scenarios";

const MAX_NESTING = 5;
const SWIPE_FRAME_MS = 16;

export interface RunnerDeps {
  devices: DeviceManager;
  mirror: MirrorManager;
  scenarios: ScenarioStore;
  assignNextProxy(serial: string): Promise<string>;
  clearProxy(serial: string): Promise<void>;
}

class Stopped extends Error {}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Stopped());
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Stopped());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

interface Run {
  status: RunStatus;
  controller: AbortController;
}

export class ScenarioRunner {
  #runs = new Map<string, Run>();
  #listeners = new Set<(runs: RunStatus[]) => void>();

  constructor(private readonly deps: RunnerDeps) {}

  onChange(listener: (runs: RunStatus[]) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  list(): RunStatus[] {
    return [...this.#runs.values()].map((r) => ({ ...r.status }));
  }

  #emit(): void {
    const runs = this.list();
    for (const l of this.#listeners) l(runs);
  }

  isBusy(serial: string): boolean {
    return [...this.#runs.values()].some((r) => r.status.serial === serial && r.status.state === "running");
  }

  start(scenarioId: string, serials: string[]): void {
    const scenario = this.deps.scenarios.get(scenarioId);
    if (!scenario) throw new Error(t("err.scenarioNotFound"));
    if (scenario.steps.length === 0) throw new Error(t("err.noSteps"));

    for (const serial of serials) {
      this.stop([serial]);
      for (const [id, r] of this.#runs) if (r.status.serial === serial) this.#runs.delete(id);

      const run: Run = {
        controller: new AbortController(),
        status: {
          runId: randomUUID(),
          scenarioId: scenario.id,
          scenarioName: scenario.name,
          serial,
          state: "running",
          iteration: 1,
          stepIndex: 0,
          stepCount: scenario.steps.length,
          startedAt: Date.now(),
        },
      };
      this.#runs.set(run.status.runId, run);
      void this.#execute(run, scenario);
    }
    this.#emit();
  }

  stop(serials?: string[]): void {
    for (const r of this.#runs.values()) {
      if (r.status.state === "running" && (!serials || serials.includes(r.status.serial))) r.controller.abort();
    }
  }

  async #execute(run: Run, scenario: Scenario): Promise<void> {
    const { status, controller } = run;
    const signal = controller.signal;
    try {
      await this.deps.mirror.ensure(status.serial);
      for (let i = 1; scenario.repeat === 0 || i <= scenario.repeat; i++) {
        status.iteration = i;
        await this.#steps(status, scenario, i, signal, 0, true);
        const more = scenario.repeat === 0 || i < scenario.repeat;
        if (more && scenario.pauseMs > 0) await sleep(scenario.pauseMs, signal);
      }
      status.state = "done";
    } catch (e) {
      if (e instanceof Stopped || signal.aborted) status.state = "stopped";
      else {
        status.state = "failed";
        status.error = e instanceof Error ? e.message : String(e);
      }
    }
    this.#emit();
  }

  async #steps(status: RunStatus, scenario: Scenario, iteration: number, signal: AbortSignal, depth: number, top: boolean): Promise<void> {
    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i]!;
      if (signal.aborted) throw new Stopped();
      if (top) {
        status.stepIndex = i;
        this.#emit();
      }
      if (!step.enabled) continue;
      if (step.everyNth && step.everyNth > 1 && (iteration - 1) % step.everyNth !== 0) continue;
      try {
        await this.#step(status.serial, step, iteration, signal, depth);
      } catch (e) {
        if (e instanceof Stopped || signal.aborted) throw new Stopped();
        const message = t("err.step", { n: i + 1, label: stepLabel(step.type), message: e instanceof Error ? e.message : String(e) });
        if (!scenario.continueOnError) throw new Error(message);
        console.warn(`[runner ${status.serial}] ${message}`);
      }
    }
  }

  async #step(serial: string, step: Step, iteration: number, signal: AbortSignal, depth: number): Promise<void> {
    const { devices, mirror } = this.deps;
    const pkg = (p: string) => {
      if (!PACKAGE_RE.test(p)) throw new Error(t("err.stepPackage"));
      return p;
    };

    switch (step.type) {
      case "tap":
        await mirror.ensure(serial);
        await mirror.touch([serial], { action: "down", x: step.x, y: step.y });
        await sleep(60, signal);
        await mirror.touch([serial], { action: "up", x: step.x, y: step.y });
        return;

      case "swipe": {
        const frames = Math.max(1, Math.round(step.duration / SWIPE_FRAME_MS));
        const points: GesturePoint[] = [{ t: 0, action: "down", x: step.x1, y: step.y1 }];
        for (let f = 1; f <= frames; f++) {
          const k = f / frames;
          points.push({ t: (step.duration * f) / frames, action: f === frames ? "up" : "move", x: step.x1 + (step.x2 - step.x1) * k, y: step.y1 + (step.y2 - step.y1) * k });
        }
        await this.#gesture(serial, points, signal);
        return;
      }

      case "gesture":
        await this.#gesture(serial, step.points, signal);
        return;

      case "key":
        await mirror.ensure(serial);
        await mirror.key([serial], step.key);
        return;

      case "text":
        await mirror.ensure(serial);
        await mirror.text([serial], step.text);
        return;

      case "wait": {
        const ms = step.maxMs && step.maxMs > step.ms ? step.ms + Math.random() * (step.maxMs - step.ms) : step.ms;
        await sleep(ms, signal);
        return;
      }

      case "launchApp": {
        const out = await devices.shell(serial, shellCommand("monkey", "-p", pkg(step.package), "-c", "android.intent.category.LAUNCHER", "1"));
        if (/No activities found|monkey aborted/i.test(out)) throw new Error(t("err.appNotFound", { pkg: step.package }));
        return;
      }

      case "stopApp":
        await devices.shell(serial, shellCommand("am", "force-stop", pkg(step.package)));
        return;

      case "clearAppData": {
        const out = await devices.shell(serial, shellCommand("pm", "clear", pkg(step.package)));
        if (!out.includes("Success")) throw new Error(out.trim() || t("err.clearFailed"));
        return;
      }

      case "proxyNext":
        await this.deps.assignNextProxy(serial);
        return;

      case "proxyClear":
        await this.deps.clearProxy(serial);
        return;

      case "shell":
        if (!step.command.trim()) throw new Error(t("err.stepEmptyCommand"));
        await devices.shell(serial, step.command);
        return;

      case "runScenario": {
        if (depth >= MAX_NESTING) throw new Error(t("err.nestingTooDeep"));
        const nested = this.deps.scenarios.get(step.scenarioId);
        if (!nested) throw new Error(t("err.nestedNotFound"));
        // Nested scenarios run once; their own repeat settings are ignored.
        await this.#steps({ serial } as RunStatus, nested, iteration, signal, depth + 1, false);
        return;
      }
    }
  }

  async #gesture(serial: string, points: GesturePoint[], signal: AbortSignal): Promise<void> {
    await this.deps.mirror.ensure(serial);
    const start = performance.now();
    let last: GesturePoint | undefined;
    try {
      for (const p of points) {
        const wait = p.t - (performance.now() - start);
        if (wait > 0) await sleep(wait, signal);
        await this.deps.mirror.touch([serial], { action: p.action, x: p.x, y: p.y });
        last = p;
      }
    } finally {
      // Don't leave the finger pressed if the gesture was interrupted.
      if (last && last.action !== "up") await this.deps.mirror.touch([serial], { action: "up", x: last.x, y: last.y });
    }
  }
}
