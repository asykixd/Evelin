import { describe, expect, it } from "vitest";
import { findNodeByText, isHierarchy } from "../src/main/uiautomator";

const XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">
<node index="0" text="" content-desc="" bounds="[0,0][1080,2400]">
  <node index="0" text="Войти &amp; продолжить" content-desc="" bounds="[100,1000][500,1100]" />
  <node index="1" text="" content-desc="Settings" bounds="[980,100][1080,200]" />
  <node index="2" text="Hidden" content-desc="" bounds="[0,0][0,0]" />
</node></hierarchy>`;

describe("findNodeByText", () => {
  it("matches text case-insensitively and decodes entities", () => {
    expect(findNodeByText(XML, "войти & ПРОДОЛЖИТЬ")).toEqual({ x: 300 / 1080, y: 1050 / 2400 });
  });

  it("matches content descriptions and substrings", () => {
    expect(findNodeByText(XML, "setti")).toEqual({ x: 1030 / 1080, y: 150 / 2400 });
  });

  it("ignores zero-size nodes, missing text and empty queries", () => {
    expect(findNodeByText(XML, "Hidden")).toBeUndefined();
    expect(findNodeByText(XML, "nope")).toBeUndefined();
    expect(findNodeByText(XML, "  ")).toBeUndefined();
  });

  it("uses the landscape root size in a rotated dump", () => {
    const rotated = `<hierarchy rotation="1"><node text="" bounds="[0,0][2400,1080]"><node text="OK" bounds="[2200,980][2400,1080]" /></node></hierarchy>`;
    expect(findNodeByText(rotated, "ok")).toEqual({ x: 2300 / 2400, y: 1030 / 1080 });
  });
});

describe("isHierarchy", () => {
  it("tells XML from uiautomator errors", () => {
    expect(isHierarchy(XML)).toBe(true);
    expect(isHierarchy("ERROR: could not get idle state.")).toBe(false);
  });
});
