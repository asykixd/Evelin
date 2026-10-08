import { describe, expect, it } from "vitest";
import { isInvalidScenario, sanitizeScenario } from "../src/shared/scenario";
import { defaultSettings, loadSettings, mergeSettings } from "../src/shared/settings";

describe("sanitizeScenario", () => {
  it("clamps coordinates, drops unknown fields and keeps valid steps", () => {
    const s = sanitizeScenario({
      id: "abc",
      name: "  Test  ",
      repeat: 2,
      extra: true,
      steps: [
        { type: "tap", x: 1.5, y: -1, enabled: false },
        { type: "wait", ms: 100, maxMs: 50 },
        { type: "launchApp", package: "com.example.app", everyNth: 3 },
        { type: "tapText", text: "OK", timeoutMs: 99_999_999 },
      ],
    });
    expect(s).toMatchObject({ id: "abc", name: "Test", repeat: 2, pauseMs: 0, continueOnError: false });
    expect(s).not.toHaveProperty("extra");
    expect(s.steps.map(({ id: _id, ...rest }) => rest)).toEqual([
      { enabled: false, type: "tap", x: 1, y: 0 },
      { enabled: true, type: "wait", ms: 100 },
      { enabled: true, everyNth: 3, type: "launchApp", package: "com.example.app" },
      { enabled: true, type: "tapText", text: "OK", timeoutMs: 600_000 },
    ]);
  });

  it("replaces ids that aren't safe identifiers", () => {
    expect(sanitizeScenario({ id: "../x", steps: [] }).id).not.toBe("../x");
  });

  it.each([
    ["unknown step type", { steps: [{ type: "rm" }] }],
    ["package with shell characters", { steps: [{ type: "stopApp", package: "com.a;reboot" }] }],
    ["unknown key", { steps: [{ type: "key", key: "menu" }] }],
    ["non-numeric coordinate", { steps: [{ type: "tap", x: "1", y: 0 }] }],
    ["missing steps", { name: "x" }],
  ])("rejects %s", (_name, raw) => {
    let error: unknown;
    try {
      sanitizeScenario(raw);
    } catch (e) {
      error = e;
    }
    expect(isInvalidScenario(error)).toBe(true);
  });
});

describe("settings", () => {
  const defaults = defaultSettings("en");

  it("merges valid fields and rejects invalid ones", () => {
    const next = mergeSettings(defaults, { stream: { maxFps: 60 }, cyberyozhRefreshMin: 15 });
    expect(next.stream).toEqual({ ...defaults.stream, maxFps: 60 });
    expect(next.cyberyozhRefreshMin).toBe(15);
    expect(() => mergeSettings(defaults, { stream: { maxFps: 61 } })).toThrow();
    expect(() => mergeSettings(defaults, { proxyTestUrl: "file:///etc/passwd" })).toThrow();
    expect(() => mergeSettings(defaults, { adbPath: "adb\nrm" })).toThrow();
    expect(() => mergeSettings(defaults, { adbPath: "/usr/bin/python3" })).toThrow();
    expect(mergeSettings(defaults, { adbPath: "C:\\Android\\platform-tools\\ADB.EXE" }).adbPath).toBe("C:\\Android\\platform-tools\\ADB.EXE");
    expect(mergeSettings(defaults, { adbPath: " /opt/homebrew/bin/adb " }).adbPath).toBe("/opt/homebrew/bin/adb");
  });

  it("falls back to defaults field by field when loading a corrupted file", () => {
    const loaded = loadSettings({ language: "xx", confirmDanger: false, stream: { maxSize: 1080, bitRate: "fast" } }, defaults);
    expect(loaded.language).toBe("en");
    expect(loaded.confirmDanger).toBe(false);
    expect(loaded.stream).toEqual({ ...defaults.stream, maxSize: 1080 });
  });
});
