import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false, getVersion: () => "1.0.0" }, dialog: {}, shell: {} }));

const { isNewer, parseVersion } = await import("../src/main/updater");

describe("isNewer", () => {
  it("compares versions numerically and accepts a v prefix", () => {
    expect(isNewer("v1.10.0", "1.9.9")).toBe(true);
    expect(isNewer("1.1.1", "1.1.1")).toBe(false);
    expect(isNewer("1.0.9", "1.1.0")).toBe(false);
  });

  it("never offers pre-releases or malformed tags", () => {
    expect(parseVersion("2.0.0-beta.1")).toBeUndefined();
    expect(isNewer("2.0.0-beta.1", "1.0.0")).toBe(false);
    expect(isNewer("latest", "1.0.0")).toBe(false);
  });
});
