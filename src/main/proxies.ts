import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { safeStorage } from "electron";
import { t } from "@shared/i18n";
import type { Proxy, ProxyState } from "@shared/types";

const CYBERYOZH_URL = "https://app.cyberyozh.com/api/v1/proxies/history/";

const HOST_RE = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

export function isValidHostPort(host: string, port: string): boolean {
  const n = Number(port);
  return HOST_RE.test(host) && /^\d+$/.test(port) && n >= 1 && n <= 65535;
}

/** Line format: `type://host:port[:login[:password]]`; `#` starts a comment. */
export function parseProxyLines(text: string): Proxy[] {
  const proxies: Proxy[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split("://");
    if (parts.length !== 2) continue;
    const [type, rest] = parts as [string, string];
    const [host = "", port = "", login = "", password = ""] = rest.split(":");
    if (!isValidHostPort(host, port)) continue;
    proxies.push({ type: type.toLowerCase(), host, port, login, password, source: "file" });
  }
  return proxies;
}

interface CyberyozhProxy {
  url?: string;
  system_status?: string;
  connection_login?: string;
  connection_password?: string;
}

function fromCyberyozh(p: CyberyozhProxy): Proxy | undefined {
  if (!p.url) return undefined;
  try {
    const u = new URL(p.url);
    const proxy: Proxy = {
      type: u.protocol.replace(":", ""),
      host: u.hostname,
      port: u.port,
      login: p.connection_login ?? decodeURIComponent(u.username),
      password: p.connection_password ?? decodeURIComponent(u.password),
      source: "cyberyozh",
    };
    return isValidHostPort(proxy.host, proxy.port) ? proxy : undefined;
  } catch {
    return undefined;
  }
}

interface StoredSettings {
  fileProxies: Proxy[];
  cyberyozhToken?: string;
}

/** Encrypted with safeStorage as a whole: it holds proxy passwords and the API token. */
interface SettingsFile {
  encrypted?: string;
}

export class ProxyStore {
  #settings: StoredSettings = { fileProxies: [] };
  #cyberyozh: Proxy[] = [];
  #index = 0;

  constructor(private readonly settingsPath: string) {}

  async load(): Promise<void> {
    try {
      const file = JSON.parse(await readFile(this.settingsPath, "utf8")) as SettingsFile;
      if (file.encrypted && safeStorage.isEncryptionAvailable()) {
        const data = JSON.parse(safeStorage.decryptString(Buffer.from(file.encrypted, "base64"))) as Partial<StoredSettings>;
        this.#settings = { fileProxies: data.fileProxies ?? [], cyberyozhToken: data.cyberyozhToken };
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") console.warn("[proxy] не удалось прочитать настройки:", e);
    }
    if (this.#token()) await this.refreshCyberyozh().catch(() => {});
  }

  async #save(): Promise<void> {
    await mkdir(dirname(this.settingsPath), { recursive: true });
    if (!safeStorage.isEncryptionAvailable()) throw new Error(t("err.encryption"));
    const file: SettingsFile = { encrypted: safeStorage.encryptString(JSON.stringify(this.#settings)).toString("base64") };
    await writeFile(this.settingsPath, JSON.stringify(file), { mode: 0o600 });
  }

  #token(): string | undefined {
    return this.#settings.cyberyozhToken;
  }

  state(): ProxyState {
    return {
      proxies: [...this.#cyberyozh, ...this.#settings.fileProxies],
      hasCyberyozhToken: Boolean(this.#settings.cyberyozhToken),
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
    };
  }

  async importText(text: string): Promise<number> {
    const parsed = parseProxyLines(text);
    const key = (p: Proxy) => `${p.type}://${p.host}:${p.port}:${p.login}`;
    const known = new Set(this.#settings.fileProxies.map(key));
    const added = parsed.filter((p) => !known.has(key(p)));
    this.#settings.fileProxies.push(...added);
    await this.#save();
    return added.length;
  }

  async clearFileProxies(): Promise<void> {
    this.#settings.fileProxies = [];
    this.#index = 0;
    await this.#save();
  }

  async setCyberyozhToken(token: string): Promise<void> {
    const trimmed = token.trim();
    if (!trimmed) {
      this.#settings.cyberyozhToken = undefined;
      this.#cyberyozh = [];
    } else {
      this.#settings.cyberyozhToken = trimmed;
    }
    await this.#save();
  }

  async refreshCyberyozh(): Promise<void> {
    const token = this.#token();
    if (!token) {
      this.#cyberyozh = [];
      return;
    }
    const res = await fetch(CYBERYOZH_URL, {
      headers: { accept: "application/json", "X-Api-Key": token },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(t("err.yozhStatus", { status: res.status }));
    const data = (await res.json()) as unknown;
    const list = Array.isArray(data)
      ? data
      : data && typeof data === "object" && Array.isArray((data as { results?: unknown }).results)
        ? (data as { results: unknown[] }).results
        : undefined;
    if (!list) throw new Error(t("err.yozhResponse"));
    this.#cyberyozh = (list as CyberyozhProxy[])
      .filter((p) => p && typeof p === "object" && p.system_status === "active")
      .map(fromCyberyozh)
      .filter((p): p is Proxy => p !== undefined);
  }

  next(): Proxy | undefined {
    const all = this.state().proxies;
    if (all.length === 0) return undefined;
    const proxy = all[this.#index % all.length];
    this.#index += 1;
    return proxy;
  }
}
