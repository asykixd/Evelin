import { describe, expect, it } from "vitest";
import { eventsToSteps, findTouchscreen, GeteventParser, parseRotation, rotate, type RecordedEvent } from "../src/main/recording";

const GETEVENT_PL = `add device 1: /dev/input/event3
  name:     "gpio-keys"
  events:
    KEY (0001): KEY_VOLUMEDOWN        KEY_VOLUMEUP
add device 2: /dev/input/event2
  name:     "touchscreen"
  events:
    ABS (0003): ABS_MT_SLOT           : value 0, min 0, max 9, fuzz 0, flat 0, resolution 0
                ABS_MT_POSITION_X     : value 0, min 0, max 1079, fuzz 0, flat 0, resolution 0
                ABS_MT_POSITION_Y     : value 0, min 0, max 2399, fuzz 0, flat 0, resolution 0
`;

describe("findTouchscreen", () => {
  it("picks the device with multitouch axes", () => {
    expect(findTouchscreen(GETEVENT_PL)).toEqual({ path: "/dev/input/event2", maxX: 1079, maxY: 2399 });
  });

  it("returns undefined without a touchscreen", () => {
    expect(findTouchscreen("add device 1: /dev/input/event0\n  name: \"keys\"\n")).toBeUndefined();
  });
});

describe("rotate", () => {
  it("maps all four rotations", () => {
    expect(rotate(0.2, 0.3, 0)).toEqual({ x: 0.2, y: 0.3 });
    expect(rotate(0.2, 0.3, 1)).toEqual({ x: 0.3, y: 0.8 });
    expect(rotate(0.2, 0.3, 2)).toEqual({ x: 0.8, y: 0.7 });
    expect(rotate(0.2, 0.3, 3)).toEqual({ x: 0.7, y: 0.2 });
  });
});

describe("parseRotation", () => {
  it("reads SurfaceOrientation from dumpsys input", () => {
    expect(parseRotation("    SurfaceOrientation: 3\n")).toBe(3);
    expect(parseRotation("nothing here")).toBeUndefined();
  });
});

describe("GeteventParser", () => {
  const screen = { path: "/dev/input/event2", maxX: 1000, maxY: 2000 };

  it("turns a touch into down/move/up and recognizes physical keys", () => {
    const events: unknown[] = [];
    const parser = new GeteventParser(screen, 0, (e) => events.push(e));
    parser.push(
      [
        "/dev/input/event2: EV_ABS       ABS_MT_TRACKING_ID   00000001",
        "/dev/input/event2: EV_ABS       ABS_MT_POSITION_X    000001f4",
        "/dev/input/event2: EV_ABS       ABS_MT_POSITION_Y    000003e8",
        "/dev/input/event2: EV_SYN       SYN_REPORT           00000000",
        "/dev/input/event2: EV_ABS       ABS_MT_POSITION_X    000000fa",
        "/dev/input/event2: EV_SYN       SYN_REPORT           00000000",
        "/dev/input/event2: EV_ABS       ABS_MT_TRACKING_ID   ffffffff",
        "/dev/input/event2: EV_SYN       SYN_REPORT           00000000",
        "/dev/input/event3: EV_KEY       KEY_VOLUMEUP         DOWN",
        "",
      ].join("\n"),
    );
    expect(events).toEqual([
      { kind: "touch", action: "down", x: 0.5, y: 0.5 },
      { kind: "touch", action: "move", x: 0.25, y: 0.5 },
      { kind: "touch", action: "up", x: 0.25, y: 0.5 },
      { kind: "key", key: "volume_up" },
    ]);
  });

  it("applies a rotation changed mid-recording", () => {
    const events: unknown[] = [];
    const parser = new GeteventParser(screen, 0, (e) => events.push(e));
    parser.rotation = 1;
    parser.push("/dev/input/event2: EV_ABS       ABS_MT_POSITION_X    000000c8\n/dev/input/event2: EV_KEY       BTN_TOUCH            DOWN\n/dev/input/event2: EV_SYN       SYN_REPORT           00000000\n");
    expect(events).toEqual([{ kind: "touch", action: "down", x: 0, y: 0.8 }]);
  });

  it("buffers partial lines between chunks", () => {
    const events: unknown[] = [];
    const parser = new GeteventParser(screen, 0, (e) => events.push(e));
    parser.push("/dev/input/event2: EV_KEY       BTN_TOUCH    ");
    parser.push("        DOWN\n/dev/input/event2: EV_SYN       SYN_REPORT           00000000\n");
    expect(events).toEqual([{ kind: "touch", action: "down", x: 0, y: 0 }]);
  });
});

describe("eventsToSteps", () => {
  it("makes a tap from a short touch and a wait from the gap", () => {
    const events: RecordedEvent[] = [
      { t: 1000, kind: "touch", action: "down", x: 0.5, y: 0.5 },
      { t: 1100, kind: "touch", action: "up", x: 0.5, y: 0.5 },
      { t: 2100, kind: "key", key: "back" },
    ];
    const steps = eventsToSteps(events).map(({ id: _id, ...rest }) => rest);
    expect(steps).toEqual([
      { enabled: true, type: "tap", x: 0.5, y: 0.5 },
      { enabled: true, type: "wait", ms: 1000 },
      { enabled: true, type: "key", key: "back" },
    ]);
  });

  it("makes a gesture from a long or moving touch and closes an unfinished stroke", () => {
    const events: RecordedEvent[] = [
      { t: 0, kind: "touch", action: "down", x: 0.5, y: 0.8 },
      { t: 100, kind: "touch", action: "move", x: 0.5, y: 0.5 },
      { t: 200, kind: "touch", action: "move", x: 0.5, y: 0.2 },
    ];
    const [step] = eventsToSteps(events);
    expect(step?.type).toBe("gesture");
    if (step?.type !== "gesture") return;
    expect(step.points.at(-1)).toEqual({ t: 200, action: "up", x: 0.5, y: 0.2 });
  });
});
