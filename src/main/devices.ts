// Работа с устройствами через локальный ADB-сервер (аналог AndroidDeviceController из device_controller.py).

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { Adb, AdbServerClient, escapeArg } from "@yume-chan/adb";
import { AdbServerNodeTcpConnector } from "@yume-chan/adb-server-node-tcp";
import type { DeviceInfo, DeviceResult, DeviceState } from "@shared/types";

const execFileAsync = promisify(execFile);

// В собранном macOS-приложении PATH урезан, поэтому проверяем и типичные пути.
const ADB_CANDIDATES =
  process.platform === "win32"
    ? ["adb", `${process.env.LOCALAPPDATA}\\Android\\Sdk\\platform-tools\\adb.exe`]
    : ["adb", "/opt/homebrew/bin/adb", "/usr/local/bin/adb", `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`];

/** Аргументы для shell собираются через пробел без экранирования, поэтому всё пользовательское экранируем сами. */
export function shellCommand(...args: string[]): string {
  return args.map(escapeArg).join(" ");
}

export class DeviceManager {
  readonly client = new AdbServerClient(new AdbServerNodeTcpConnector({ host: "127.0.0.1", port: 5037 }));
  #adbs = new Map<string, Promise<Adb>>();
  #devices = new Map<string, DeviceInfo>();
  #observer: AdbServerClient.DeviceObserver | undefined;
  #listeners = new Set<(devices: DeviceInfo[]) => void>();

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
      // Сервер не запущен — пробуем поднять его сами.
    }
    for (const bin of ADB_CANDIDATES) {
      if (bin !== "adb" && !existsSync(bin)) continue;
      try {
        await execFileAsync(bin, ["start-server"]);
        await this.client.getVersion();
        return;
      } catch {
        // пробуем следующий путь
      }
    }
    throw new Error("Не удалось запустить ADB-сервер. Установите platform-tools и добавьте adb в PATH.");
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

  /** Выполняет shell-команду. Строка передаётся как есть (пайпы и т.п. работают), поэтому данные снаружи экранируйте через `shellCommand`. */
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
      // Устройство могло отключиться, пока мы ждали ответа.
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

  // --- Прокси (settings put global http_proxy), как set_http_proxy / clear_http_proxy в Python-версии ---

  async getProxy(serial: string): Promise<string> {
    const out = (await this.shell(serial, "settings get global http_proxy")).trim();
    // Android возвращает "null", если ключ не задан, и ":0" после очистки.
    return out === "null" || out === ":0" ? "" : out;
  }

  async setProxy(serial: string, hostPort: string): Promise<boolean> {
    await this.shell(serial, shellCommand("settings", "put", "global", "http_proxy", hostPort));
    return (await this.getProxy(serial)) === hostPort;
  }

  async clearProxy(serial: string): Promise<boolean> {
    // ":0" сбрасывает прокси сразу, без перезагрузки; delete убирает ключ полностью.
    await this.shell(serial, "settings put global http_proxy :0");
    await this.shell(serial, "settings delete global http_proxy");
    return (await this.getProxy(serial)) === "";
  }

  /** Запускает действие на каждом устройстве параллельно и собирает результаты, не бросая исключений. */
  async forEach(serials: string[], action: (serial: string) => Promise<string | void>): Promise<DeviceResult[]> {
    return Promise.all(
      serials.map(async (serial): Promise<DeviceResult> => {
        if (!this.has(serial)) return { serial, success: false, error: "Устройство не подключено или не авторизовано" };
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
