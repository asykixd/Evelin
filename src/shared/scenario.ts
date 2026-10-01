// Общая логика сценариев: строгая валидация (данные приходят из UI и из импортируемых файлов), описания и шаблоны шагов.

import type { GesturePoint, NavKey, Scenario, Step, StepBody, StepType, TouchAction } from "./types";

export const PACKAGE_RE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;
export const NAV_KEYS: readonly NavKey[] = ["back", "home", "recents", "power", "volume_up", "volume_down"];
const TOUCH_ACTIONS: readonly TouchAction[] = ["down", "move", "up"];

const MAX_STEPS = 5000;
const MAX_POINTS = 2000;
const MAX_WAIT = 24 * 60 * 60 * 1000;

export const STEP_LABELS: Record<StepType, string> = {
  tap: "Нажатие",
  swipe: "Свайп",
  gesture: "Жест",
  key: "Кнопка",
  text: "Ввод текста",
  wait: "Пауза",
  launchApp: "Запустить приложение",
  stopApp: "Закрыть приложение",
  clearAppData: "Очистить данные приложения",
  proxyNext: "Сменить прокси (следующий)",
  proxyClear: "Сбросить прокси",
  shell: "ADB shell",
  runScenario: "Выполнить другой сценарий",
};

export const KEY_LABELS: Record<NavKey, string> = {
  back: "Назад",
  home: "Домой",
  recents: "Недавние",
  power: "Питание",
  volume_up: "Громкость +",
  volume_down: "Громкость −",
};

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

export function newScenario(name = "Новый сценарий"): Scenario {
  return { id: newId(), name, steps: [], repeat: 1, pauseMs: 0, continueOnError: false, updatedAt: Date.now() };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function describeStep(step: Step, scenarios: readonly Scenario[] = []): string {
  switch (step.type) {
    case "tap":
      return `(${pct(step.x)}, ${pct(step.y)})`;
    case "swipe":
      return `(${pct(step.x1)}, ${pct(step.y1)}) → (${pct(step.x2)}, ${pct(step.y2)}), ${step.duration} мс`;
    case "gesture": {
      const first = step.points[0];
      const last = step.points[step.points.length - 1];
      if (!first || !last) return "пустой";
      return `(${pct(first.x)}, ${pct(first.y)}) → (${pct(last.x)}, ${pct(last.y)}), ${last.t} мс, ${step.points.length} точек`;
    }
    case "key":
      return KEY_LABELS[step.key];
    case "text":
      return `«${step.text}»`;
    case "wait":
      return step.maxMs && step.maxMs > step.ms ? `${step.ms}–${step.maxMs} мс` : `${step.ms} мс`;
    case "launchApp":
    case "stopApp":
    case "clearAppData":
      return step.package || "пакет не указан";
    case "proxyNext":
    case "proxyClear":
      return "";
    case "shell":
      return step.command;
    case "runScenario":
      return scenarios.find((s) => s.id === step.scenarioId)?.name ?? "сценарий не выбран";
  }
}

// --- Валидация ---

class InvalidScenario extends Error {}

function fail(message: string): never {
  throw new InvalidScenario(message);
}

function num(v: unknown, min: number, max: number, what: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) fail(`${what}: ожидалось число`);
  return Math.min(max, Math.max(min, v));
}

function str(v: unknown, max: number, what: string): string {
  if (typeof v !== "string") fail(`${what}: ожидалась строка`);
  if (v.length > max) fail(`${what}: слишком длинная строка`);
  return v;
}

function pkg(v: unknown): string {
  const s = str(v, 256, "Пакет").trim();
  // Пустой пакет допустим при редактировании, при запуске такой шаг упадёт с понятной ошибкой.
  if (s && !PACKAGE_RE.test(s)) fail(`Некорректное имя пакета: ${s}`);
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
        duration: Math.round(num(raw.duration, 10, 60_000, "Длительность")),
      };
    case "gesture": {
      if (!Array.isArray(raw.points) || raw.points.length > MAX_POINTS) fail("Жест: некорректные точки");
      const points: GesturePoint[] = raw.points.map((p: unknown) => {
        const o = (p ?? {}) as Record<string, unknown>;
        if (!TOUCH_ACTIONS.includes(o.action as TouchAction)) fail("Жест: некорректное действие");
        return {
          t: Math.round(num(o.t, 0, 600_000, "Жест: время")),
          action: o.action as TouchAction,
          x: num(o.x, 0, 1, "Жест: X"),
          y: num(o.y, 0, 1, "Жест: Y"),
        };
      });
      return { type: "gesture", points };
    }
    case "key":
      if (!NAV_KEYS.includes(raw.key as NavKey)) fail("Неизвестная кнопка");
      return { type: "key", key: raw.key as NavKey };
    case "text":
      return { type: "text", text: str(raw.text, 1000, "Текст") };
    case "wait": {
      const ms = Math.round(num(raw.ms, 0, MAX_WAIT, "Пауза"));
      const maxMs = raw.maxMs === undefined || raw.maxMs === null || raw.maxMs === 0 ? undefined : Math.round(num(raw.maxMs, 0, MAX_WAIT, "Пауза до"));
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
      return { type: "shell", command: str(raw.command, 4000, "Команда") };
    case "runScenario":
      return { type: "runScenario", scenarioId: str(raw.scenarioId, 100, "Сценарий") };
    default:
      fail(`Неизвестный тип шага: ${String(raw.type)}`);
  }
}

export function sanitizeStep(raw: unknown): Step {
  if (!raw || typeof raw !== "object") fail("Шаг: ожидался объект");
  const o = raw as Record<string, unknown>;
  const everyNth = o.everyNth === undefined || o.everyNth === null ? undefined : Math.round(num(o.everyNth, 1, 100_000, "Каждый N-й"));
  return {
    id: typeof o.id === "string" && o.id.length <= 100 ? o.id : newId(),
    enabled: o.enabled !== false,
    ...(everyNth && everyNth > 1 ? { everyNth } : {}),
    ...body(o),
  };
}

export function sanitizeScenario(raw: unknown): Scenario {
  if (!raw || typeof raw !== "object") fail("Сценарий: ожидался объект");
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.steps) || o.steps.length > MAX_STEPS) fail("Сценарий: некорректный список шагов");
  const name = str(o.name ?? "", 200, "Название").trim() || "Без названия";
  return {
    id: typeof o.id === "string" && /^[\w-]{1,100}$/.test(o.id) ? o.id : newId(),
    name,
    steps: o.steps.map(sanitizeStep),
    repeat: Math.round(num(o.repeat ?? 1, 0, 1_000_000, "Повторы")),
    pauseMs: Math.round(num(o.pauseMs ?? 0, 0, MAX_WAIT, "Пауза между повторами")),
    continueOnError: o.continueOnError === true,
    updatedAt: Date.now(),
  };
}

export function isInvalidScenario(e: unknown): e is Error {
  return e instanceof InvalidScenario;
}
