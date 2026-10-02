import { t } from "./i18n";
import type { GesturePoint, NavKey, Scenario, Step, StepBody, StepType, TouchAction } from "./types";

export const PACKAGE_RE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;
export const NAV_KEYS: readonly NavKey[] = ["back", "home", "recents", "power", "volume_up", "volume_down"];
const TOUCH_ACTIONS: readonly TouchAction[] = ["down", "move", "up"];

const MAX_STEPS = 5000;
const MAX_POINTS = 2000;
const MAX_WAIT = 24 * 60 * 60 * 1000;

export function stepLabel(type: StepType): string {
  return t(`step.${type}`);
}

export function keyLabel(key: NavKey): string {
  return t(`key.${key}`);
}

export function newId(): string {
  return crypto.randomUUID();
}

export function newStep(type: StepType): Step {
  const base = { id: newId(), enabled: true };
  switch (type) {
    case "tap":
      return { ...base, type, x: 0.5, y: 0.5 };
    case "swipe":
      return { ...base, type, x1: 0.5, y1: 0.75, x2: 0.5, y2: 0.25, duration: 300 };
    case "gesture":
      return { ...base, type, points: [] };
    case "key":
      return { ...base, type, key: "home" };
    case "text":
      return { ...base, type, text: "" };
    case "wait":
      return { ...base, type, ms: 1000 };
    case "launchApp":
    case "stopApp":
    case "clearAppData":
      return { ...base, type, package: "" };
    case "proxyNext":
    case "proxyClear":
      return { ...base, type };
    case "shell":
      return { ...base, type, command: "" };
    case "runScenario":
      return { ...base, type, scenarioId: "" };
  }
}

export function newScenario(name = t("scenario.new")): Scenario {
  return { id: newId(), name, steps: [], repeat: 1, pauseMs: 0, continueOnError: false, updatedAt: Date.now() };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function describeStep(step: Step, scenarios: readonly Scenario[] = []): string {
  switch (step.type) {
    case "tap":
      return `(${pct(step.x)}, ${pct(step.y)})`;
    case "swipe":
      return `(${pct(step.x1)}, ${pct(step.y1)}) → (${pct(step.x2)}, ${pct(step.y2)}), ${t("desc.ms", { n: step.duration })}`;
    case "gesture": {
      const first = step.points[0];
      const last = step.points[step.points.length - 1];
      if (!first || !last) return t("desc.empty");
      return t("desc.gesture", { from: `(${pct(first.x)}, ${pct(first.y)})`, to: `(${pct(last.x)}, ${pct(last.y)})`, ms: last.t, n: step.points.length });
    }
    case "key":
      return keyLabel(step.key);
    case "text":
      return `«${step.text}»`;
    case "wait":
      return t("desc.ms", { n: step.maxMs && step.maxMs > step.ms ? `${step.ms}–${step.maxMs}` : step.ms });
    case "launchApp":
    case "stopApp":
    case "clearAppData":
      return step.package || t("desc.noPackage");
    case "proxyNext":
    case "proxyClear":
      return "";
    case "shell":
      return step.command;
    case "runScenario":
      return scenarios.find((s) => s.id === step.scenarioId)?.name ?? t("desc.noScenario");
  }
}

class InvalidScenario extends Error {}

function fail(message: string): never {
  throw new InvalidScenario(message);
}

function num(v: unknown, min: number, max: number, what: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) fail(t("val.number", { what }));
  return Math.min(max, Math.max(min, v));
}

function str(v: unknown, max: number, what: string): string {
  if (typeof v !== "string") fail(t("val.string", { what }));
  if (v.length > max) fail(t("val.tooLong", { what }));
  return v;
}

function pkg(v: unknown): string {
  const s = str(v, 256, t("field.package")).trim();
  // Empty is allowed while editing; the runner rejects it with a clear error.
  if (s && !PACKAGE_RE.test(s)) fail(t("val.badPackage", { pkg: s }));
  return s;
}

function body(raw: Record<string, unknown>): StepBody {
  const u = (k: string, what: string) => num(raw[k], 0, 1, what);
  switch (raw.type as StepType) {
    case "tap":
      return { type: "tap", x: u("x", "X"), y: u("y", "Y") };
    case "swipe":
      return {
        type: "swipe",
        x1: u("x1", "X1"),
        y1: u("y1", "Y1"),
        x2: u("x2", "X2"),
        y2: u("y2", "Y2"),
        duration: Math.round(num(raw.duration, 10, 60_000, t("field.duration"))),
      };
    case "gesture": {
      if (!Array.isArray(raw.points) || raw.points.length > MAX_POINTS) fail(t("val.gesturePoints"));
      const points: GesturePoint[] = raw.points.map((p: unknown) => {
        const o = (p ?? {}) as Record<string, unknown>;
        if (!TOUCH_ACTIONS.includes(o.action as TouchAction)) fail(t("val.gestureAction"));
        return {
          t: Math.round(num(o.t, 0, 600_000, t("field.gestureTime"))),
          action: o.action as TouchAction,
          x: num(o.x, 0, 1, t("field.gestureX")),
          y: num(o.y, 0, 1, t("field.gestureY")),
        };
      });
      return { type: "gesture", points };
    }
    case "key":
      if (!NAV_KEYS.includes(raw.key as NavKey)) fail(t("val.unknownKey"));
      return { type: "key", key: raw.key as NavKey };
    case "text":
      return { type: "text", text: str(raw.text, 1000, t("field.text")) };
    case "wait": {
      const ms = Math.round(num(raw.ms, 0, MAX_WAIT, t("field.wait")));
      const maxMs = raw.maxMs === undefined || raw.maxMs === null || raw.maxMs === 0 ? undefined : Math.round(num(raw.maxMs, 0, MAX_WAIT, t("field.waitMax")));
      return maxMs !== undefined && maxMs > ms ? { type: "wait", ms, maxMs } : { type: "wait", ms };
    }
    case "launchApp":
    case "stopApp":
    case "clearAppData":
      return { type: raw.type as "launchApp", package: pkg(raw.package) };
    case "proxyNext":
    case "proxyClear":
      return { type: raw.type as "proxyNext" };
    case "shell":
      return { type: "shell", command: str(raw.command, 4000, t("field.command")) };
    case "runScenario":
      return { type: "runScenario", scenarioId: str(raw.scenarioId, 100, t("field.scenario")) };
    default:
      fail(t("val.unknownStep", { type: String(raw.type) }));
  }
}

export function sanitizeStep(raw: unknown): Step {
  if (!raw || typeof raw !== "object") fail(t("val.stepObject"));
  const o = raw as Record<string, unknown>;
  const everyNth = o.everyNth === undefined || o.everyNth === null ? undefined : Math.round(num(o.everyNth, 1, 100_000, t("field.everyNth")));
  return {
    id: typeof o.id === "string" && o.id.length <= 100 ? o.id : newId(),
    enabled: o.enabled !== false,
    ...(everyNth && everyNth > 1 ? { everyNth } : {}),
    ...body(o),
  };
}

export function sanitizeScenario(raw: unknown): Scenario {
  if (!raw || typeof raw !== "object") fail(t("val.scenarioObject"));
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.steps) || o.steps.length > MAX_STEPS) fail(t("val.scenarioSteps"));
  const name = str(o.name ?? "", 200, t("field.name")).trim() || t("scenario.untitled");
  return {
    id: typeof o.id === "string" && /^[\w-]{1,100}$/.test(o.id) ? o.id : newId(),
    name,
    steps: o.steps.map(sanitizeStep),
    repeat: Math.round(num(o.repeat ?? 1, 0, 1_000_000, t("field.repeat"))),
    pauseMs: Math.round(num(o.pauseMs ?? 0, 0, MAX_WAIT, t("field.pause"))),
    continueOnError: o.continueOnError === true,
    updatedAt: Date.now(),
  };
}

export function isInvalidScenario(e: unknown): e is Error {
  return e instanceof InvalidScenario;
}
