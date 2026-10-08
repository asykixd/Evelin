import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, session, shell, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { ReadableStream } from "@yume-chan/stream-extra";
import { langForLocale, t } from "@shared/i18n";
import { isInvalidScenario, NAV_KEYS, PACKAGE_RE } from "@shared/scenario";
import type { DeviceResult, NavKey, ProxyState, TouchEvent } from "@shared/types";
import { DeviceManager, shellCommand } from "./devices";
import { MirrorManager } from "./mirror";
import { isValidHostPort, ProxyStore } from "./proxies";
import { Recorder } from "./recorder";
import { ScenarioRunner } from "./runner";
import { ScenarioStore } from "./scenarios";
import { SettingsStore } from "./settings";
import { Updater } from "./updater";

const settings = new SettingsStore(join(app.getPath("userData"), "settings.json"));
const devices = new DeviceManager(() => settings.get().adbPath);
const proxies = new ProxyStore(join(app.getPath("userData"), "proxy-settings.json"));
const scenarios = new ScenarioStore(join(app.getPath("userData"), "scenarios.json"));
const recorder = new Recorder(devices);
let win: BrowserWindow | undefined;
const updater = new Updater(() => win);

const mirror = new MirrorManager(
  devices,
  join(app.isPackaged ? process.resourcesPath : app.getAppPath(), "resources", "scrcpy-server"),
  {
    packet: (serial, packet) => win?.webContents.send("mirror:packet", serial, packet),
    size: (serial, w, h) => win?.webContents.send("mirror:size", serial, w, h),
    stopped: (serial, reason) => win?.webContents.send("mirror:stopped", serial, reason),
  },
  () => settings.get().stream,
);

function proxyChanged(): ProxyState {
  const state = proxies.state();
  win?.webContents.send("proxy:changed", state);
  return state;
}

let yozhTimer: NodeJS.Timeout | undefined;

function scheduleYozhRefresh(): void {
  clearInterval(yozhTimer);
  yozhTimer = undefined;
  const minutes = settings.get().cyberyozhRefreshMin;
  if (minutes <= 0) return;
  yozhTimer = setInterval(() => {
    if (!proxies.state().hasCyberyozhToken) return;
    proxies.refreshCyberyozh().then(proxyChanged, (e) => console.warn("[proxy] автообновление CyberYozh:", e));
  }, minutes * 60_000);
}

async function assignNextProxy(serial: string): Promise<string> {
  const p = proxies.next();
  if (!p) throw new Error(t("err.noProxies"));
  if (!/^https?$/.test(p.type)) throw new Error(t("err.proxyHttpOnly", { type: p.type }));
  if (!isValidHostPort(p.host, p.port)) throw new Error(t("err.proxyBadAddress"));
  const hostPort = `${p.host}:${p.port}`;
  if (!(await devices.setProxy(serial, hostPort))) throw new Error(t("err.proxyNotApplied"));
  void devices.refresh(serial);
  return p.login ? t("err.proxyAuthWarning", { hostPort }) : hostPort;
}

async function clearProxy(serial: string): Promise<void> {
  if (!(await devices.clearProxy(serial))) throw new Error(t("err.proxyNotCleared"));
  void devices.refresh(serial);
}

const runner = new ScenarioRunner({ devices, mirror, scenarios, assignNextProxy, clearProxy });

const PRELOAD = fileURLToPath(new URL("../preload/index.cjs", import.meta.url));
const RENDERER_HTML = fileURLToPath(new URL("../renderer/index.html", import.meta.url));
const DEV_URL = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: "Evelin",
    backgroundColor: "#0f1115",
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });

  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });

  if (!app.isPackaged) {
    win.webContents.on("console-message", (e) => {
      if (e.level === "warning" || e.level === "error") console.log(`[renderer:${e.level}] ${e.message}`);
    });
  }

  if (DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadFile(RENDERER_HTML);

  win.on("closed", () => {
    win = undefined;
    void mirror.stopAll();
  });
}

function isTrustedSender(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? "";
  if (DEV_URL && url.startsWith(DEV_URL)) return true;
  return url.startsWith("file://") && fileURLToPath(url.split("#")[0]!.split("?")[0]!) === RENDERER_HTML;
}

function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => Promise<R> | R): void {
  ipcMain.handle(channel, (e, ...args) => {
    if (!isTrustedSender(e)) throw new Error(t("err.untrusted"));
    return fn(...(args as A));
  });
}

function on<A extends unknown[]>(channel: string, fn: (...args: A) => unknown): void {
  ipcMain.on(channel, (e, ...args) => {
    if (!isTrustedSender(e)) return;
    try {
      void fn(...(args as A));
    } catch (err) {
      console.warn(`[ipc] ${channel}:`, err);
    }
  });
}

function serials(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error(t("err.deviceList"));
  return [...new Set(value.filter((s): s is string => typeof s === "string" && devices.has(s)))];
}

function serial(value: unknown): string {
  if (typeof value !== "string" || !devices.has(value)) throw new Error(t("err.unknownDevice"));
  return value;
}

function finite(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(t("err.number"));
  return value;
}

const TOUCH_ACTIONS = new Set(["down", "move", "up"]);
/** The console has no cancel button, so endless commands like `logcat` must not block it forever. */
const SHELL_TIMEOUT = 60_000;

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function registerIpc(): void {
  handle("settings:get", () => settings.get());
  handle("settings:update", (patch: unknown) => settings.update(patch));
  handle("settings:pickAdb", async () => {
    if (!win) return undefined;
    const filters = process.platform === "win32" ? [{ name: "adb", extensions: ["exe"] }] : [];
    const pick = await dialog.showOpenDialog(win, { title: t("dialog.pickAdb"), filters, properties: ["openFile"] });
    return pick.canceled ? undefined : pick.filePaths[0];
  });
  handle("settings:info", () => ({ version: app.getVersion(), dataDir: app.getPath("userData") }));
  handle("settings:openDataDir", async () => {
    await shell.openPath(app.getPath("userData"));
  });

  handle("devices:list", () => devices.list());
  handle("devices:refresh", (s: unknown) => devices.refresh(serial(s)));

  handle("mirror:start", async (s: unknown) => {
    try {
      return { success: true, ...(await mirror.start(serial(s))) };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  handle("mirror:stop", (s: unknown) => (typeof s === "string" ? mirror.stop(s) : undefined));

  // Fire-and-forget so latency doesn't pile up on every pointer move.
  on("control:touch", (list: unknown, ev: unknown) => {
    const e = ev as TouchEvent;
    if (!e || !TOUCH_ACTIONS.has(e.action)) return;
    const targets = serials(list);
    const event: TouchEvent = { action: e.action, x: finite(e.x), y: finite(e.y) };
    recorder.captureTouch(targets, event);
    return mirror.touch(targets, event);
  });
  on("control:scroll", (list: unknown, x: unknown, y: unknown, dx: unknown, dy: unknown) =>
    mirror.scroll(serials(list), finite(x), finite(y), finite(dx), finite(dy)),
  );
  on("control:key", (list: unknown, key: unknown) => {
    if (!NAV_KEYS.includes(key as NavKey)) return;
    const targets = serials(list);
    recorder.captureKey(targets, key as NavKey);
    return mirror.key(targets, key as NavKey);
  });
  on("control:text", (list: unknown, text: unknown) => {
    if (typeof text !== "string" || text.length === 0 || text.length > 1000) return;
    const targets = serials(list);
    recorder.captureStep(targets, { type: "text", text });
    return mirror.text(targets, text);
  });

  handle("batch:shell", (list: unknown, command: unknown) => {
    if (typeof command !== "string" || !command.trim()) throw new Error(t("err.emptyCommand"));
    // Intentionally unescaped: an operator console that runs on the phone, not on the host.
    return devices.forEach(serials(list), (s) => devices.shell(s, command, SHELL_TIMEOUT));
  });

  handle("batch:launchApp", (list: unknown, pkg: unknown) => {
    if (typeof pkg !== "string" || !PACKAGE_RE.test(pkg)) throw new Error(t("err.badPackage"));
    const targets = serials(list);
    recorder.captureStep(targets, { type: "launchApp", package: pkg });
    return devices.forEach(targets, async (s) => {
      const out = await devices.shell(s, shellCommand("monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"));
      if (/No activities found|monkey aborted/i.test(out)) throw new Error(t("err.packageNotFound", { pkg }));
    });
  });

  handle("batch:installApk", async (list: unknown) => {
    const targets = serials(list);
    if (!win) return [];
    const pick = await dialog.showOpenDialog(win, { title: t("dialog.pickApk"), filters: [{ name: "APK", extensions: ["apk"] }], properties: ["openFile"] });
    const file = pick.filePaths[0];
    if (pick.canceled || !file) return [];
    const bytes = new Uint8Array(await readFile(file));
    return devices.forEach(targets, async (s) => {
      const adb = await devices.getAdb(s);
      const remote = `/data/local/tmp/farm-${randomUUID()}.apk`;
      const sync = await adb.sync();
      try {
        await sync.write({ filename: remote, file: streamOf(bytes) });
      } finally {
        await sync.dispose();
      }
      try {
        const out = await devices.shell(s, shellCommand("pm", "install", "-r", "-g", remote));
        if (!out.includes("Success")) throw new Error(out.trim() || t("err.installFailed"));
        return out.trim();
      } finally {
        await devices.shell(s, shellCommand("rm", "-f", remote)).catch(() => {});
      }
    });
  });

  handle("batch:screenshot", async (list: unknown) => {
    const targets = serials(list);
    if (!win) return [];
    const pick = await dialog.showOpenDialog(win, { title: t("dialog.screenshotDir"), properties: ["openDirectory", "createDirectory"] });
    const dir = pick.filePaths[0];
    if (pick.canceled || !dir) return [];
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return devices.forEach(targets, async (s) => {
      const adb = await devices.getAdb(s);
      const png = await adb.subprocess.noneProtocol.spawnWait("screencap -p");
      const path = join(dir, `${s.replace(/[^\w.-]/g, "_")}_${stamp}.png`);
      await writeFile(path, png);
      return path;
    });
  });

  handle("batch:reboot", (list: unknown) => devices.forEach(serials(list), (s) => devices.shell(s, "reboot").then(() => {})));
  handle("batch:wake", (list: unknown) =>
    devices.forEach(serials(list), (s) => devices.shell(s, "input keyevent KEYCODE_WAKEUP").then(() => {})),
  );

  handle("proxy:state", () => proxies.state());
  handle("proxy:importFile", async () => {
    if (!win) return proxies.state();
    const pick = await dialog.showOpenDialog(win, { title: t("dialog.proxyFile"), filters: [{ name: "Text", extensions: ["txt"] }], properties: ["openFile"] });
    const file = pick.filePaths[0];
    if (!pick.canceled && file) await proxies.importText(await readFile(file, "utf8"));
    return proxyChanged();
  });
  handle("proxy:clearFile", async () => {
    await proxies.clearFileProxies();
    return proxyChanged();
  });
  handle("proxy:setToken", async (token: unknown) => {
    if (typeof token !== "string" || token.length > 512) throw new Error(t("err.badToken"));
    await proxies.setCyberyozhToken(token);
    await proxies.refreshCyberyozh().catch(() => {});
    return proxyChanged();
  });
  handle("proxy:refreshCyberyozh", async () => {
    try {
      await proxies.refreshCyberyozh();
      return { state: proxyChanged() };
    } catch (e) {
      return { state: proxyChanged(), error: e instanceof Error ? e.message : String(e) };
    }
  });

  handle("proxy:assign", (list: unknown) => devices.forEach(serials(list), assignNextProxy));
  handle("proxy:clear", (list: unknown) => devices.forEach(serials(list), clearProxy));
  handle("proxy:test", (list: unknown): Promise<DeviceResult[]> =>
    devices.forEach(serials(list), async (s) => {
      const proxy = await devices.getProxy(s);
      if (!(await devices.shell(s, "command -v curl")).trim()) throw new Error(t("err.noCurl"));
      const args = ["curl", "-s", "-m", "15"];
      if (proxy) args.push("-x", proxy);
      args.push(settings.get().proxyTestUrl);
      const out = (await devices.shell(s, shellCommand(...args))).trim();
      if (!out) throw new Error(t("err.noResponse"));
      return proxy ? t("err.viaProxy", { proxy, out }) : t("err.noProxy", { out });
    }),
  );

  const scenarioError = (e: unknown) => {
    if (isInvalidScenario(e)) return new Error(t("val.invalid", { message: e.message }));
    return e;
  };
  handle("scenarios:list", () => scenarios.list());
  handle("scenarios:save", async (raw: unknown) => {
    try {
      await scenarios.save(raw);
    } catch (e) {
      throw scenarioError(e);
    }
    return scenarios.list();
  });
  handle("scenarios:remove", async (id: unknown) => {
    if (typeof id === "string") await scenarios.remove(id);
    return scenarios.list();
  });
  handle("scenarios:export", async (id: unknown) => {
    const scenario = typeof id === "string" ? scenarios.get(id) : undefined;
    if (!scenario || !win) return false;
    // Bundle nested scenarios so the exported file is self-contained.
    const bundle = new Map([[scenario.id, scenario]]);
    for (let added = true; added; ) {
      added = false;
      for (const s of [...bundle.values()])
        for (const step of s.steps)
          if (step.type === "runScenario" && !bundle.has(step.scenarioId)) {
            const nested = scenarios.get(step.scenarioId);
            if (nested) {
              bundle.set(nested.id, nested);
              added = true;
            }
          }
    }
    const safeName = scenario.name.replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "scenario";
    const pick = await dialog.showSaveDialog(win, { title: t("dialog.exportScenario"), defaultPath: `${safeName}.evelin.json`, filters: [{ name: "Evelin", extensions: ["json"] }] });
    if (pick.canceled || !pick.filePath) return false;
    await writeFile(pick.filePath, JSON.stringify([...bundle.values()], null, 2));
    return true;
  });
  handle("scenarios:import", async () => {
    if (!win) return { scenarios: scenarios.list(), imported: 0, withShell: 0 };
    const pick = await dialog.showOpenDialog(win, { title: t("dialog.importScenarios"), filters: [{ name: "Evelin", extensions: ["json"] }], properties: ["openFile"] });
    const file = pick.filePaths[0];
    if (pick.canceled || !file) return { scenarios: scenarios.list(), imported: 0, withShell: 0 };
    let imported;
    try {
      imported = await scenarios.import(JSON.parse(await readFile(file, "utf8")));
    } catch (e) {
      throw scenarioError(e instanceof SyntaxError ? new Error(t("val.notJson")) : e);
    }
    const withShell = imported.filter((s) => s.steps.some((st) => st.type === "shell")).length;
    return { scenarios: scenarios.list(), imported: imported.length, withShell };
  });
  handle("scenarios:run", (id: unknown, list: unknown) => {
    if (typeof id !== "string") throw new Error(t("err.scenarioNotFound"));
    const targets = serials(list);
    if (recorder.serial && targets.includes(recorder.serial)) throw new Error(t("err.recordingOnDevice"));
    runner.start(id, targets);
  });
  handle("scenarios:stop", (list: unknown) => runner.stop(list === undefined ? undefined : (Array.isArray(list) ? list.filter((s) => typeof s === "string") : [])));
  handle("scenarios:runs", () => runner.list());

  handle("recorder:start", (s: unknown) => {
    const target = serial(s);
    if (runner.isBusy(target)) throw new Error(t("err.runningOnDevice"));
    return recorder.start(target);
  });
  handle("recorder:stop", async () => {
    const target = recorder.serial;
    const info = target ? devices.list().find((d) => d.serial === target) : undefined;
    const scenario = recorder.stop(info?.model ?? target ?? "");
    if (!scenario) return undefined;
    return scenarios.save(scenario);
  });
  handle("recorder:cancel", () => recorder.cancel());

  handle("updates:status", () => updater.status());
  handle("updates:check", () => updater.check(true));
  handle("updates:download", () => updater.download());
  handle("updates:install", () => updater.install());
}

// A second instance would fight over device sessions and the same data files.
if (!app.requestSingleInstanceLock()) app.exit(0);

app.on("second-instance", () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(async () => {
  // Vite HMR needs inline scripts in dev.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = DEV_URL
      ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws:; img-src 'self' data: blob:"
      : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:";
    callback({ responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [csp] } });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

  registerIpc();
  await settings.load(langForLocale(app.getLocale()));
  await Promise.all([proxies.load(), scenarios.load()]);
  scheduleYozhRefresh();
  settings.onChange((next, prev) => {
    if (next.cyberyozhRefreshMin !== prev.cyberyozhRefreshMin) scheduleYozhRefresh();
  });

  let known = new Set<string>();
  devices.onChange((list) => {
    const now = new Set(list.map((d) => d.serial));
    for (const s of known) {
      if (now.has(s)) continue;
      mirror.forgetDevice(s);
      runner.stop([s]);
      if (recorder.serial === s) recorder.cancel();
    }
    known = now;
    win?.webContents.send("devices:changed", list);
  });
  runner.onChange((runs) => win?.webContents.send("scenarios:runs", runs));
  recorder.onStatus((status) => win?.webContents.send("recorder:status", status));
  updater.onStatus((status) => win?.webContents.send("updates:status", status));

  createWindow();
  updater.start();

  try {
    await devices.start();
  } catch (e) {
    dialog.showErrorBox("ADB", e instanceof Error ? e.message : String(e));
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  clearInterval(yozhTimer);
  runner.stop();
  recorder.cancel();
  void mirror.stopAll();
  void devices.stop();
  updater.installOnQuit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
