import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { Adb, AdbServerClient, escapeArg } from "@yume-chan/adb";
import { AdbServerNodeTcpConnector } from "@yume-chan/adb-server-node-tcp";
import { t } from "@shared/i18n";
import type { DeviceInfo, DeviceResult, DeviceState } from "@shared/types";

const execFileAsync = promisify(execFile);

// Packaged macOS apps get a minimal PATH, so probe common install locations too.
const ADB_CANDIDATES =
  process.platform === "win32"
    ? ["adb", `${process.env.LOCALAPPDATA}\\Android\\Sdk\\platform-tools\\adb.exe`]
    : ["adb", "/opt/homebrew/bin/adb", "/usr/local/bin/adb", `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`];

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

  /** An empty `adbPath` means auto-detect. */
  constructor(private readonly adbPath: () => string = () => "") {}

  async start(): Promise<void> {
    await this.#ensureServer();
    this.#observer = await this.client.trackDevices();
    this.#observer.onListChange((list) => void this.#sync(list));
    this.#observer.onError((e) => console.error("[adb] ошибка отслеживания устройств:", e));
    await this.#sync(this.#observer.current);
  }

  async stop(): Promise<void> {
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

  /** Runs the command string as-is (pipes work); escape external input with `shellCommand`. */
  async shell(serial: string, command: string): Promise<string> {
    const adb = await this.getAdb(serial);
    return adb.subprocess.noneProtocol.spawnWaitText(command);
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
      const info: DeviceInfo = { ...current, model: model || current.model, brand, androidVersion, battery, proxy };
      // The device may have disconnected while we were waiting.
      if (this.#devices.has(serial)) {
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
