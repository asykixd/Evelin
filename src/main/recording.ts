import type { GesturePoint, NavKey, Step, StepBody, TouchAction } from "../shared/types";

export type RecordedEvent =
  | { t: number; kind: "touch"; action: TouchAction; x: number; y: number }
  | { t: number; kind: "key"; key: NavKey }
  | { t: number; kind: "step"; step: StepBody };

export interface TouchscreenInfo {
  path: string;
  maxX: number;
  maxY: number;
}

/** The touchscreen is the device in `getevent -pl` output that has ABS_MT_POSITION_X/Y axes. */
export function findTouchscreen(output: string): TouchscreenInfo | undefined {
  let path: string | undefined;
  let maxX: number | undefined;
  let maxY: number | undefined;
  for (const line of output.split(/\r?\n/)) {
    const dev = /^add device \d+:\s*(\S+)/.exec(line);
    if (dev) {
      if (path && maxX && maxY) return { path, maxX, maxY };
      path = dev[1];
      maxX = maxY = undefined;
      continue;
    }
    const axis = /ABS_MT_POSITION_([XY])\s*:.*\bmax (\d+)/.exec(line);
    if (axis) {
      if (axis[1] === "X") maxX = Number(axis[2]);
      else maxY = Number(axis[2]);
    }
  }
  return path && maxX && maxY ? { path, maxX, maxY } : undefined;
}

const PHYSICAL_KEYS: Record<string, NavKey> = {
  KEY_BACK: "back",
  KEY_HOMEPAGE: "home",
  KEY_HOME: "home",
  KEY_APPSELECT: "recents",
  KEY_POWER: "power",
  KEY_VOLUMEUP: "volume_up",
  KEY_VOLUMEDOWN: "volume_down",
};

/** Parses the rotation out of `dumpsys input`; undefined when it isn't reported. */
export function parseRotation(dumpsysInput: string): number | undefined {
  const m = /SurfaceOrientation:\s*(\d)/.exec(dumpsysInput);
  return m ? Number(m[1]) : undefined;
}

/** Maps sensor coordinates to display coordinates for rotation 0..3. */
export function rotate(x: number, y: number, rotation: number): { x: number; y: number } {
  switch (rotation & 3) {
    case 1:
      return { x: y, y: 1 - x };
    case 2:
      return { x: 1 - x, y: 1 - y };
    case 3:
      return { x: 1 - y, y: x };
    default:
      return { x, y };
  }
}

type Emit = (e: { kind: "touch"; action: TouchAction; x: number; y: number } | { kind: "key"; key: NavKey }) => void;

/** Parses `getevent -l` output. Only slot 0 is tracked: scenarios replay a single pointer via scrcpy. */
export class GeteventParser {
  #slot = 0;
  #x = 0;
  #y = 0;
  #down = false;
  #pendingDown = false;
  #pendingUp = false;
  #moved = false;
  #buffer = "";

  constructor(
    private readonly screen: TouchscreenInfo,
    /** Display rotation 0..3; the recorder updates it when the phone is turned. */
    public rotation: number,
    private readonly emit: Emit,
  ) {}

  push(chunk: string): void {
    this.#buffer += chunk;
    const lines = this.#buffer.split(/\r?\n/);
    this.#buffer = lines.pop() ?? "";
    for (const line of lines) this.#line(line);
  }

  #line(line: string): void {
    // "/dev/input/event2: EV_ABS       ABS_MT_POSITION_X    000001a2"
    const m = /^(\S+):\s+(\w+)\s+(\w+)\s+(\S+)/.exec(line.trim());
    if (!m) return;
    const [, path, type, code, value] = m as unknown as [string, string, string, string, string];

    if (type === "EV_KEY" && PHYSICAL_KEYS[code] && value === "DOWN") {
      this.emit({ kind: "key", key: PHYSICAL_KEYS[code] });
      return;
    }
    if (path !== this.screen.path) return;

    if (type === "EV_ABS") {
      const n = parseInt(value, 16);
      if (code === "ABS_MT_SLOT") this.#slot = n;
      if (this.#slot !== 0) return;
      if (code === "ABS_MT_POSITION_X") {
        this.#x = n;
        this.#moved = true;
      } else if (code === "ABS_MT_POSITION_Y") {
        this.#y = n;
        this.#moved = true;
      } else if (code === "ABS_MT_TRACKING_ID") {
        if (value === "ffffffff") this.#pendingUp = true;
        else this.#pendingDown = true;
      }
    } else if (type === "EV_KEY" && code === "BTN_TOUCH") {
      // Protocol A and some drivers never send TRACKING_ID.
      if (value === "DOWN") this.#pendingDown = true;
      else if (value === "UP") this.#pendingUp = true;
    } else if (type === "EV_SYN" && code === "SYN_REPORT") {
      this.#sync();
    }
  }

  #point() {
    return rotate(
      Math.min(1, Math.max(0, this.#x / this.screen.maxX)),
      Math.min(1, Math.max(0, this.#y / this.screen.maxY)),
      this.rotation,
    );
  }

  #sync(): void {
    if (this.#pendingDown && !this.#down) {
      this.#down = true;
      this.emit({ kind: "touch", action: "down", ...this.#point() });
    } else if (this.#pendingUp && this.#down) {
      this.#down = false;
      this.emit({ kind: "touch", action: "up", ...this.#point() });
    } else if (this.#down && this.#moved) {
      this.emit({ kind: "touch", action: "move", ...this.#point() });
    }
    this.#pendingDown = this.#pendingUp = this.#moved = false;
  }
}

const MIN_WAIT = 100;
const TAP_MAX_MS = 250;
const TAP_MAX_DIST = 0.02;
const MOVE_MIN_INTERVAL = 16;

const roundWait = (ms: number) => Math.round(ms / 50) * 50;

/** Touches become taps/gestures and gaps become waits; idle time before the first action is dropped. */
export function eventsToSteps(events: readonly RecordedEvent[]): Step[] {
  const steps: Step[] = [];
  let lastEnd: number | undefined;
  let stroke: { start: number; points: GesturePoint[] } | undefined;

  const push = (start: number, end: number, body: StepBody) => {
    if (lastEnd !== undefined && start - lastEnd >= MIN_WAIT) {
      steps.push({ id: crypto.randomUUID(), enabled: true, type: "wait", ms: roundWait(start - lastEnd) });
    }
    steps.push({ id: crypto.randomUUID(), enabled: true, ...body } as Step);
    lastEnd = end;
  };

  const finishStroke = () => {
    if (!stroke) return;
    const { start, points } = stroke;
    stroke = undefined;
    const first = points[0]!;
    const last = points[points.length - 1]!;
    if (last.action !== "up") points.push({ ...last, action: "up" });
    const duration = points[points.length - 1]!.t;
    const dist = Math.max(...points.map((p) => Math.hypot(p.x - first.x, p.y - first.y)));
    if (duration <= TAP_MAX_MS && dist <= TAP_MAX_DIST) {
      push(start, start + duration, { type: "tap", x: round(first.x), y: round(first.y) });
    } else {
      push(start, start + duration, { type: "gesture", points: points.map((p) => ({ ...p, x: round(p.x), y: round(p.y) })) });
    }
  };

  for (const e of [...events].sort((a, b) => a.t - b.t)) {
    if (e.kind === "touch") {
      if (e.action === "down") {
        finishStroke();
        stroke = { start: e.t, points: [{ t: 0, action: "down", x: e.x, y: e.y }] };
      } else if (stroke) {
        const t = Math.round(e.t - stroke.start);
        const prev = stroke.points[stroke.points.length - 1]!;
        // ~60 points per second is enough for replay.
        if (e.action === "move" && t - prev.t < MOVE_MIN_INTERVAL) continue;
        stroke.points.push({ t, action: e.action, x: e.x, y: e.y });
        if (e.action === "up") finishStroke();
      }
      continue;
    }
    finishStroke();
    push(e.t, e.t, e.kind === "key" ? { type: "key", key: e.key } : e.step);
  }
  finishStroke();
  return steps;
}

function round(v: number): number {
  return Math.round(v * 10000) / 10000;
}
