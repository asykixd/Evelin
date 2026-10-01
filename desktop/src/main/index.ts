import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, session, shell, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { ReadableStream } from "@yume-chan/stream-extra";
import type { DeviceResult, NavKey, TouchEvent } from "@shared/types";
import { DeviceManager, shellCommand } from "./devices";
import { MirrorManager } from "./mirror";
import { isValidHostPort, ProxyStore } from "./proxies";

const devices = new DeviceManager();
const proxies = new ProxyStore(join(app.getPath("userData"), "proxy-settings.json"));
let win: BrowserWindow | undefined;

const mirror = new MirrorManager(
  devices,
  join(app.isPackaged ? process.resourcesPath : app.getAppPath(), "resources", "scrcpy-server"),
  {
    packet: (serial, packet) => win?.webContents.send("mirror:packet", serial, packet),
    size: (serial, w, h) => win?.webContents.send("mirror:size", serial, w, h),
    stopped: (serial, reason) => win?.webContents.send("mirror:stopped", serial, reason),
  },
);

const PRELOAD = fileURLToPath(new URL("../preload/index.cjs", import.meta.url));
const RENDERER_HTML = fileURLToPath(new URL("../renderer/index.html", import.meta.url));
const DEV_URL = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: "Android Farm",
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

  // Никакой навигации и новых окон внутри приложения; внешние ссылки — в браузере.
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });

  // В режиме разработки дублируем ошибки renderer в терминал.
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

// --- Валидация IPC: всё, что пришло из renderer, считаем недоверенным. ---

function isTrustedSender(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? "";
  if (DEV_URL && url.startsWith(DEV_URL)) return true;
  return url.startsWith("file://") && fileURLToPath(url.split("#")[0]!.split("?")[0]!) === RENDERER_HTML;
}

function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => Promise<R> | R): void {
  ipcMain.handle(channel, (e, ...args) => {
    if (!isTrustedSender(e)) throw new Error("Недоверенный отправитель");
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
  if (!Array.isArray(value)) throw new Error("Ожидался список устройств");
  return [...new Set(value.filter((s): s is string => typeof s === "string" && devices.has(s)))];
}

function serial(value: unknown): string {
  if (typeof value !== "string" || !devices.has(value)) throw new Error("Неизвестное устройство");
  return value;
}

function finite(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Ожидалось число");
  return value;
}

const NAV_KEYS = new Set<NavKey>(["back", "home", "recents", "power", "volume_up", "volume_down"]);
const TOUCH_ACTIONS = new Set(["down", "move", "up"]);
const PACKAGE_RE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function registerIpc(): void {
  // Устройства
  handle("devices:list", () => devices.list());
  handle("devices:refresh", (s: unknown) => devices.refresh(serial(s)));

  // Трансляция
  handle("mirror:start", async (s: unknown) => {
    try {
      return { success: true, ...(await mirror.start(serial(s))) };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  handle("mirror:stop", (s: unknown) => (typeof s === "string" ? mirror.stop(s) : undefined));

  // Управление (fire-and-forget, чтобы не копить задержку на каждом движении пальца)
  on("control:touch", (list: unknown, ev: unknown) => {
    const e = ev as TouchEvent;
    if (!e || !TOUCH_ACTIONS.has(e.action)) return;
    return mirror.touch(serials(list), { action: e.action, x: finite(e.x), y: finite(e.y) });
  });
  on("control:scroll", (list: unknown, x: unknown, y: unknown, dx: unknown, dy: unknown) =>
    mirror.scroll(serials(list), finite(x), finite(y), finite(dx), finite(dy)),
  );
  on("control:key", (list: unknown, key: unknown) => {
    if (NAV_KEYS.has(key as NavKey)) return mirror.key(serials(list), key as NavKey);
  });
  on("control:text", (list: unknown, text: unknown) => {
    if (typeof text === "string" && text.length > 0 && text.length <= 1000) return mirror.text(serials(list), text);
  });

  // Пакетные операции
  handle("batch:shell", (list: unknown, command: unknown) => {
    if (typeof command !== "string" || !command.trim()) throw new Error("Пустая команда");
    // Команда намеренно выполняется как есть: это консоль для оператора фермы, она исполняется на телефоне, не на ПК.
    return devices.forEach(serials(list), (s) => devices.shell(s, command));
  });

  handle("batch:launchApp", (list: unknown, pkg: unknown) => {
    if (typeof pkg !== "string" || !PACKAGE_RE.test(pkg)) throw new Error("Некорректное имя пакета");
    return devices.forEach(serials(list), async (s) => {
      const out = await devices.shell(s, shellCommand("monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"));
      if (/No activities found|monkey aborted/i.test(out)) throw new Error(`Пакет ${pkg} не найден или не запускается`);
    });
  });

  handle("batch:installApk", async (list: unknown) => {
    const targets = serials(list);
    if (!win) return [];
    const pick = await dialog.showOpenDialog(win, { title: "Выберите APK", filters: [{ name: "APK", extensions: ["apk"] }], properties: ["openFile"] });
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
        if (!out.includes("Success")) throw new Error(out.trim() || "Установка не удалась");
        return out.trim();
      } finally {
        await devices.shell(s, shellCommand("rm", "-f", remote)).catch(() => {});
      }
    });
  });

  handle("batch:screenshot", async (list: unknown) => {
    const targets = serials(list);
    if (!win) return [];
    const pick = await dialog.showOpenDialog(win, { title: "Папка для скриншотов", properties: ["openDirectory", "createDirectory"] });
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

  // Прокси
  handle("proxy:state", () => proxies.state());
  handle("proxy:importFile", async () => {
    if (!win) return proxies.state();
    const pick = await dialog.showOpenDialog(win, { title: "Файл с прокси (proxies.txt)", filters: [{ name: "Text", extensions: ["txt"] }], properties: ["openFile"] });
    const file = pick.filePaths[0];
    if (!pick.canceled && file) await proxies.importText(await readFile(file, "utf8"));
    return proxies.state();
  });
  handle("proxy:clearFile", async () => {
    await proxies.clearFileProxies();
    return proxies.state();
  });
  handle("proxy:setToken", async (token: unknown) => {
    if (typeof token !== "string" || token.length > 512) throw new Error("Некорректный токен");
    await proxies.setCyberyozhToken(token);
    await proxies.refreshCyberyozh().catch(() => {});
    return proxies.state();
  });
  handle("proxy:refreshCyberyozh", async () => {
    try {
      await proxies.refreshCyberyozh();
      return { state: proxies.state() };
    } catch (e) {
      return { state: proxies.state(), error: e instanceof Error ? e.message : String(e) };
    }
  });

  handle("proxy:assign", async (list: unknown) => {
    const targets = serials(list);
    // Прокси раздаём заранее и последовательно, чтобы round-robin был детерминированным.
    const plan = new Map(targets.map((s) => [s, proxies.next()] as const));
    const results = await devices.forEach(targets, async (s) => {
      const p = plan.get(s);
      if (!p) throw new Error("Нет доступных прокси");
      if (!/^https?$/.test(p.type)) throw new Error(`Системный прокси Android поддерживает только HTTP, а не ${p.type}`);
      if (!isValidHostPort(p.host, p.port)) throw new Error("Некорректный адрес прокси");
      const hostPort = `${p.host}:${p.port}`;
      if (!(await devices.setProxy(s, hostPort))) throw new Error("Настройка не применилась");
      return p.login ? `${hostPort} (внимание: логин/пароль системным прокси не поддерживаются)` : hostPort;
    });
    void Promise.all(targets.map((s) => devices.refresh(s)));
    return results;
  });
  handle("proxy:clear", async (list: unknown) => {
    const targets = serials(list);
    const results = await devices.forEach(targets, async (s) => {
      if (!(await devices.clearProxy(s))) throw new Error("Прокси не сбросился");
    });
    void Promise.all(targets.map((s) => devices.refresh(s)));
    return results;
  });
  handle("proxy:test", (list: unknown): Promise<DeviceResult[]> =>
    devices.forEach(serials(list), async (s) => {
      const proxy = await devices.getProxy(s);
      if (!(await devices.shell(s, "command -v curl")).trim()) throw new Error("curl не установлен на устройстве");
      const args = ["curl", "-s", "-m", "15"];
      if (proxy) args.push("-x", proxy);
      args.push("http://httpbin.org/ip");
      const out = (await devices.shell(s, shellCommand(...args))).trim();
      if (!out) throw new Error("Нет ответа");
      return proxy ? `через ${proxy}: ${out}` : `без прокси: ${out}`;
    }),
  );
}

app.whenReady().then(async () => {
  // Строгая CSP и для dev-сервера, и для собранной версии; в dev Vite нужен inline-скрипт для HMR.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = DEV_URL
      ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws:; img-src 'self' data: blob:"
      : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:";
    callback({ responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [csp] } });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

  registerIpc();
  await proxies.load();

  let known = new Set<string>();
  devices.onChange((list) => {
    const now = new Set(list.map((d) => d.serial));
    for (const s of known) if (!now.has(s)) mirror.forgetDevice(s);
    known = now;
    win?.webContents.send("devices:changed", list);
  });

  createWindow();

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
  void mirror.stopAll();
  void devices.stop();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
