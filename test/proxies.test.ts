import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ safeStorage: {} }));

const { isHttpProxy, isValidHostPort, parseProxyLines } = await import("../src/main/proxies");

describe("parseProxyLines", () => {
  it("parses the colon format, keeping colons inside the password", () => {
    expect(parseProxyLines("HTTP://1.2.3.4:8080:user:pa:ss")).toEqual([
      { type: "http", host: "1.2.3.4", port: "8080", login: "user", password: "pa:ss", source: "file" },
    ]);
  });

  it("parses the login:password@host:port format", () => {
    expect(parseProxyLines("socks5://user:p@ss:w@proxy.example.com:1080")).toEqual([
      { type: "socks5", host: "proxy.example.com", port: "1080", login: "user", password: "p@ss:w", source: "file" },
    ]);
  });

  it("allows proxies without credentials and skips comments, blanks and garbage", () => {
    const text = ["# comment", "", "http://h.example:3128", "not a proxy", "http://bad host:1", "http://h:99999"].join("\r\n");
    expect(parseProxyLines(text)).toEqual([
      { type: "http", host: "h.example", port: "3128", login: "", password: "", source: "file" },
    ]);
  });
});

describe("isValidHostPort", () => {
  it("rejects shell metacharacters and out-of-range ports", () => {
    expect(isValidHostPort("example.com", "80")).toBe(true);
    expect(isValidHostPort("a;reboot", "80")).toBe(false);
    expect(isValidHostPort("example.com", "0")).toBe(false);
    expect(isValidHostPort("example.com", "8o")).toBe(false);
  });
});

describe("isHttpProxy", () => {
  it("accepts only types Android's global proxy supports", () => {
    const base = { host: "h", port: "1", login: "", password: "", source: "file" as const };
    expect(isHttpProxy({ ...base, type: "http" })).toBe(true);
    expect(isHttpProxy({ ...base, type: "https" })).toBe(true);
    expect(isHttpProxy({ ...base, type: "socks5" })).toBe(false);
  });
});
