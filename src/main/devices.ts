import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { Adb, AdbServerClient, escapeArg } from "@yume-chan/adb";
import { AdbServerNodeTcpConnector } from "@yume-chan/adb-server-node-tcp";
import { ConcatStringStream, TextDecoderStream } from "@yume-chan/stream-extra";
import { t } from "@shared/i18n";
import type { DeviceInfo, DeviceResult, DeviceState } from "@shared/types";

const execFileAsync = promisify(execFile);

// Packaged macOS apps get a minimal PATH, so probe common install locations too.
const ADB_CANDIDATES =
  process.platform === "win32"
    ? ["adb", `${process.env.LOCALAPPDATA}\\Android\\Sdk\\platform-tools\\adb.exe`]
    : ["adb", "/opt/homebrew/bin/adb", "/usr/local/bin/adb", `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`];

const RECONNECT_MIN = 2_000;
const RECONNECT_MAX = 30_000;
const REFRESH_INTERVAL = 60_000;

/** Tango joins shell args with spaces without escaping, so escape everything here. */
export function shellCommand(...args: string[]): string {
  return args.map(escapeArg).join(" ");
}

export class DeviceManager {
  readonly client = new AdbServerClient(new AdbServerNodeTcpConnector({ host: "127.0.0.1", port: 5037 }));
  #adbs = new Map<string, Promise<Adb>>();
  #devices = new Map<string, DeviceInfo>();
  #observer: AdbServerClient.DeviceObserver | undefined;
  #listeners = new Set<(devices: DeviceInfo[]) => void>();
  #retry: NodeJS.Timeout | undefined;
  #poll: NodeJS.Timeout | undefined;
  #stopped = false;

  /** An empty `adbPath` means auto-detect. */
  constructor(private readonly adbPath: () => string = () => "") {}

  /** Rejects if the ADB server can't be reached, but keeps retrying in the background either way. */
  async start(): Promise<void> {
    this.#stopped = false;
    clearInterval(this.#poll);
    // Battery and proxy aren't pushed by the device, so poll them.
    this.#poll = setInterval(() => {
      for (const d of this.#devices.values()) if (d.state === "device") void this.refresh(d.serial);
    }, REFRESH_INTERVAL);
    try {
      await this.#connect();
    } catch (e) {
      this.#reconnect();
      throw e;
    }
  }

  async #connect(): Promise<void> {
    await this.#ensureServer();
    const observer = await this.client.trackDevices();
    this.#observer = observer;
    observer.onListChange((list) => void this.#sync(list));
    // Fires when the server goes away (`adb kill-server`, platform-tools update): start it again.
    observer.onError((e) => {
      if (this.#observer !== observer) return;
      console.error("[adb] соединение с ADB-сервером потеряно:", e);
      this.#observer = undefined;
      void Promise.resolve(observer.stop()).catch(() => {});
      void this.#sync([]);
      this.#reconnect();
    });
    await this.#sync(observer.current);
  }

  #reconnect(delay = RECONNECT_MIN): void {
    if (this.#stopped || this.#retry) return;
    this.#retry = setTimeout(() => {
      this.#retry = undefined;
      this.#connect().then(
        () => console.log("[adb] подключение к ADB-серверу восстановлено"),
        () => this.#reconnect(Math.min(delay * 2, RECONNECT_MAX)),
      );
    }, delay);
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    clearInterval(this.#poll);
    clearTimeout(this.#retry);
    this.#retry = undefined;
    await this.#observer?.stop();
    for (const adb of this.#adbs.values()) {
      adb.then((a) => a.close()).catch(() => {});
    }
    this.#adbs.clear();
  }

  onChange(listener: (devices: DeviceInfo[]) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  list(): DeviceInfo[] {
    return [...this.#devices.values()].sort((a, b) => a.serial.localeCompare(b.serial));
  }

  has(serial: string): boolean {
    return this.#devices.get(serial)?.state === "device";
  }

  async #ensureServer(): Promise<void> {
    try {
      await this.client.getVersion();
      return;
    } catch {
      // not running yet — start it below
    }
    const custom = this.adbPath();
    for (const bin of custom ? [custom, ...ADB_CANDIDATES] : ADB_CANDIDATES) {
      if (bin !== "adb" && !existsSync(bin)) continue;
      try {
        await execFileAsync(bin, ["start-server"]);
        await this.client.getVersion();
        return;
      } catch {
        // try the next candidate
      }
    }
    throw new Error(t("err.adbStart"));
  }

  async #sync(list: readonly AdbServerClient.Device[]): Promise<void> {
    const seen = new Set<string>();
    for (const d of list) {
      seen.add(d.serial);
      const prev = this.#devices.get(d.serial);
      const state = d.state as DeviceState;
      if (prev && prev.state === state) continue;
      this.#devices.set(d.serial, { ...prev, serial: d.serial, state, model: d.model ?? prev?.model });
      if (state === "device") void this.refresh(d.serial);
    }
    for (const serial of [...this.#devices.keys()]) {
      if (!seen.has(serial)) {
        this.#devices.delete(serial);
        this.#dropAdb(serial);
      }
    }
    this.#emit();
  }

  #emit(): void {
    const devices = this.list();
    for (const l of this.#listeners) l(devices);
  }

  #dropAdb(serial: string): void {
    const adb = this.#adbs.get(serial);
    this.#adbs.delete(serial);
    adb?.then((a) => a.close()).catch(() => {});
  }

  getAdb(serial: string): Promise<Adb> {
    let adb = this.#adbs.get(serial);
    if (!adb) {
      adb = this.client.createAdb({ serial });
      this.#adbs.set(serial, adb);
      adb.then(
        (a) => a.disconnected.then(() => this.#adbs.get(serial) === adb && this.#adbs.delete(serial)),
        () => this.#adbs.delete(serial),
      );
    }
    return adb;
  }

  /**
   * Runs the command string as-is (pipes work); escape external input with `shellCommand`.
   * With `timeoutMs`, a command still running by then is killed and the call rejects.
   */
  async shell(serial: string, command: string, timeoutMs = 0): Promise<string> {
    const adb = await this.getAdb(serial);
    if (timeoutMs <= 0) return adb.subprocess.noneProtocol.spawnWaitText(command);
    const proc = await adb.subprocess.noneProtocol.spawn(command);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        void Promise.resolve(proc.kill()).catch(() => {});
        reject(new Error(t("err.shellTimeout", { s: Math.round(timeoutMs / 1000) })));
      }, timeoutMs);
    });
    try {
      return await Promise.race([proc.output.pipeThrough(new TextDecoderStream()).pipeThrough(new ConcatStringStream()), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async refresh(serial: string): Promise<DeviceInfo | undefined> {
    const current = this.#devices.get(serial);
    if (!current || current.state !== "device") return current;
    try {
      const adb = await this.getAdb(serial);
      const [model, brand, androidVersion, battery, proxy] = await Promise.all([
        adb.getProp("ro.product.model"),
        adb.getProp("ro.product.brand"),
        adb.getProp("ro.build.version.release"),
        this.shell(serial, "dumpsys battery").then((out) => {
          const m = /level:\s*(\d+)/.exec(out);
          return m ? Number(m[1]) : undefined;
        }),
        this.getProxy(serial),
      ]);
      // The device may have disconnected or changed state while we were waiting.
      const latest = this.#devices.get(serial);
      if (!latest) return undefined;
      const info: DeviceInfo = { ...latest, model: model || latest.model, brand, androidVersion, battery, proxy };
      if (JSON.stringify(latest) !== JSON.stringify(info)) {
        this.#devices.set(serial, info);
        this.#emit();
      }
      return info;
    } catch (e) {
      console.warn(`[adb] не удалось получить свойства ${serial}:`, e);
      return current;
    }
  }

  async getProxy(serial: string): Promise<string> {
    const out = (await this.shell(serial, "settings get global http_proxy")).trim();
    // Android returns "null" when unset and ":0" after clearing.
    return out === "null" || out === ":0" ? "" : out;
  }

  async setProxy(serial: string, hostPort: string): Promise<boolean> {
    await this.shell(serial, shellCommand("settings", "put", "global", "http_proxy", hostPort));
    return (await this.getProxy(serial)) === hostPort;
  }

  async clearProxy(serial: string): Promise<boolean> {
    // ":0" takes effect without a reboot; delete then removes the key entirely.
    await this.shell(serial, "settings put global http_proxy :0");
    await this.shell(serial, "settings delete global http_proxy");
    return (await this.getProxy(serial)) === "";
  }

  async forEach(serials: string[], action: (serial: string) => Promise<string | void>): Promise<DeviceResult[]> {
    return Promise.all(
      serials.map(async (serial): Promise<DeviceResult> => {
        if (!this.has(serial)) return { serial, success: false, error: t("err.deviceUnavailable") };
        try {
          const output = await action(serial);
          return { serial, success: true, output: output ?? undefined };
        } catch (e) {
          return { serial, success: false, error: e instanceof Error ? e.message : String(e) };
        }
      }),
    );
  }
}
