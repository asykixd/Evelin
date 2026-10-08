import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, createReadStream, existsSync } from "node:fs";
import { access, mkdir, open, readdir, rm, type FileHandle } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { app, dialog, shell, type BrowserWindow } from "electron";
import { t } from "@shared/i18n";
import type { UpdateStatus } from "@shared/types";

const execFileAsync = promisify(execFile);

const LATEST_RELEASE_URL = "https://api.github.com/repos/asykixd/Evelin/releases/latest";
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
const DOWNLOAD_PARTS = 8;
const MIN_PART_SIZE = 4 * 1024 * 1024;
const PART_RETRIES = 3;

interface Asset {
  name: string;
  browser_download_url: string;
  size: number;
  /** "sha256:<hex>", provided by GitHub for uploaded assets. */
  digest?: string | null;
}

interface Release {
  tag_name: string;
  html_url: string;
  assets: Asset[];
}

type Target = { kind: "mac"; bundle: string; asset: string } | { kind: "nsis"; asset: string };

export function parseVersion(v: string): number[] | undefined {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? m.slice(1).map(Number) : undefined;
}

export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return false;
}

/** Where and how the running build can be replaced in place, if at all. */
function installTarget(): Target | undefined {
  if (!app.isPackaged) return undefined;
  const exe = app.getPath("exe");
  if (process.platform === "darwin") {
    const bundle = resolve(exe, "../../..");
    // Translocated or mounted-DMG copies are read-only.
    if (!bundle.endsWith(".app") || bundle.includes("/AppTranslocation/") || bundle.startsWith("/Volumes/")) return undefined;
    return { kind: "mac", bundle, asset: `-mac-${process.arch}.zip` };
  }
  // Only NSIS installs ship an uninstaller next to the exe; the portable zip can't self-update.
  if (process.platform === "win32" && existsSync(join(dirname(exe), `Uninstall ${app.getName()}.exe`))) {
    return { kind: "nsis", asset: `-win-${process.arch}-setup.exe` };
  }
  return undefined;
}

async function canReplace(target: Target): Promise<boolean> {
  if (target.kind !== "mac") return true;
  try {
    await access(dirname(target.bundle), constants.W_OK);
    await access(target.bundle, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function fetchLatestRelease(): Promise<Release> {
  const res = await fetch(LATEST_RELEASE_URL, {
    headers: { accept: "application/vnd.github+json", "user-agent": `Evelin/${app.getVersion()}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) throw new Error(t("upd.errNoReleases"));
  if (!res.ok) throw new Error(t("upd.errStatus", { status: res.status }));
  const data = (await res.json()) as Partial<Release>;
  if (typeof data.tag_name !== "string" || typeof data.html_url !== "string" || !Array.isArray(data.assets)) {
    throw new Error(t("upd.errBadResponse"));
  }
  return data as Release;
}

/** Fetches bytes start..end (inclusive) into the file, resuming from the last written byte on failure. */
async function downloadRange(url: string, file: FileHandle, start: number, end: number, onBytes: (n: number) => void): Promise<void> {
  let pos = start;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { range: `bytes=${pos}-${end}` }, signal: AbortSignal.timeout(10 * 60_000) });
      if (res.status !== 206 || !res.body) throw new Error(t("upd.errStatus", { status: res.status }));
      for await (const chunk of res.body) {
        await file.write(chunk, 0, chunk.length, pos);
        pos += chunk.length;
        onBytes(chunk.length);
      }
      if (pos !== end + 1) throw new Error(t("upd.errInterrupted"));
      return;
    } catch (e) {
      if (attempt >= PART_RETRIES) throw e;
    }
  }
}

// Parallel ranged requests: a single GitHub CDN connection is often throttled.
async function download(asset: Asset, dest: string, onProgress: (fraction: number) => void): Promise<void> {
  if (asset.size <= 0) throw new Error(t("upd.errEmpty"));
  // Without a digest there is nothing to check the download against, so don't install it.
  const expected = asset.digest?.startsWith("sha256:") ? asset.digest.slice("sha256:".length) : undefined;
  if (!expected) throw new Error(t("upd.errNoDigest"));
  const parts = Math.max(1, Math.min(DOWNLOAD_PARTS, Math.floor(asset.size / MIN_PART_SIZE)));
  const partSize = Math.ceil(asset.size / parts);
  let received = 0;
  const onBytes = (n: number) => {
    received += n;
    onProgress(Math.min(1, received / asset.size));
  };
  const file = await open(dest, "w");
  try {
    await Promise.all(
      Array.from({ length: parts }, (_, i) =>
        downloadRange(asset.browser_download_url, file, i * partSize, Math.min(asset.size, (i + 1) * partSize) - 1, onBytes),
      ),
    );
  } finally {
    await file.close();
  }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(dest)) hash.update(chunk as Buffer);
  if (hash.digest("hex") !== expected) throw new Error(t("upd.errChecksum"));
}

async function unpackApp(zip: string, dir: string): Promise<string> {
  const out = join(dir, "app");
  await execFileAsync("ditto", ["-x", "-k", zip, out]);
  const name = (await readdir(out)).find((n) => n.endsWith(".app"));
  if (!name) throw new Error(t("upd.errNoApp"));
  return join(out, name);
}

// Runs detached after the app exits: swap the bundle, roll back on failure, optionally relaunch.
const MAC_SWAP_SCRIPT = `
pid=$1; target=$2; staged=$3; relaunch=$4
while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
backup="$target.old-$$"
mv "$target" "$backup" || exit 1
if mv "$staged" "$target"; then rm -rf "$backup"; else mv "$backup" "$target"; fi
xattr -dr com.apple.quarantine "$target" 2>/dev/null
[ "$relaunch" = 1 ] && open "$target"
exit 0
`;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export class Updater {
  #status: UpdateStatus = { state: "idle", current: app.getVersion(), canInstall: false };
  #listeners = new Set<(s: UpdateStatus) => void>();
  #target = installTarget();
  #asset: Asset | undefined;
  #staged: string | undefined;
  #checking: Promise<UpdateStatus> | undefined;
  /** Version already offered by a background check, so periodic checks don't nag. */
  #offered: string | undefined;
  #installing = false;

  constructor(private readonly window: () => BrowserWindow | undefined) {}

  start(): void {
    if (!app.isPackaged) return;
    void this.check();
    setInterval(() => void this.check(), CHECK_INTERVAL).unref();
  }

  onStatus(listener: (s: UpdateStatus) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  status(): UpdateStatus {
    return { ...this.#status };
  }

  #set(patch: Partial<UpdateStatus>): void {
    this.#status = { ...this.#status, ...patch };
    const s = this.status();
    for (const l of this.#listeners) l(s);
  }

  async #ask(options: Electron.MessageBoxOptions): Promise<number> {
    const win = this.window();
    const { response } = await (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options));
    return response;
  }

  check(manual = false): Promise<UpdateStatus> {
    if (this.#status.state === "downloading" || this.#status.state === "ready") return Promise.resolve(this.status());
    this.#checking ??= this.#check(manual).finally(() => (this.#checking = undefined));
    return this.#checking;
  }

  async #check(manual: boolean): Promise<UpdateStatus> {
    this.#set({ state: "checking", error: undefined });
    try {
      const release = await fetchLatestRelease();
      const latest = release.tag_name.replace(/^v/, "");
      if (!isNewer(latest, this.#status.current)) {
        this.#set({ state: "latest", latest, url: release.html_url, canInstall: false });
        return this.status();
      }
      const target = this.#target;
      this.#asset = target && release.assets.find((a) => a.name.endsWith(target.asset));
      const canInstall = Boolean(target && this.#asset && (await canReplace(target)));
      this.#set({ state: "available", latest, url: release.html_url, canInstall });
      if (manual || this.#offered !== latest) void this.#offer(latest, release.html_url, canInstall);
    } catch (e) {
      this.#set({ state: "error", error: t("upd.checkFailed", { error: message(e) }) });
    }
    return this.status();
  }

  async #offer(latest: string, url: string, canInstall: boolean): Promise<void> {
    this.#offered = latest;
    const response = await this.#ask({
      type: "info",
      title: t("upd.title"),
      message: t("upd.offer", { version: latest }),
      detail: t(canInstall ? "upd.offerInstall" : "upd.offerManual", { current: this.#status.current }),
      buttons: [t(canInstall ? "upd.install" : "upd.openDownload"), t("upd.later")],
      defaultId: 0,
      cancelId: 1,
    });
    if (response !== 0) return;
    if (canInstall) this.download();
    else void shell.openExternal(url);
  }

  download(): void {
    const target = this.#target;
    const asset = this.#asset;
    if (this.#status.state !== "available" || !this.#status.canInstall || !target || !asset) return;
    void this.#download(target, asset);
  }

  async #download(target: Target, asset: Asset): Promise<void> {
    this.#set({ state: "downloading", progress: 0, error: undefined });
    try {
      const dir = join(app.getPath("temp"), "evelin-update");
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      const file = join(dir, asset.name);
      let percent = 0;
      await download(asset, file, (fraction) => {
        const p = Math.floor(fraction * 100);
        if (p === percent) return;
        percent = p;
        this.#set({ progress: fraction });
      });
      this.#staged = target.kind === "mac" ? await unpackApp(file, dir) : file;
      this.#set({ state: "ready", progress: undefined });
    } catch (e) {
      // Fall back to the release page.
      this.#set({ state: "available", progress: undefined, canInstall: false, error: t("upd.downloadFailed", { error: message(e) }) });
      return;
    }
    const response = await this.#ask({
      type: "info",
      title: t("upd.title"),
      message: t("upd.ready", { version: this.#status.latest ?? "" }),
      detail: t("upd.readyDetail"),
      buttons: [t("upd.restartNow"), t("upd.later")],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) this.install();
  }

  install(): void {
    if (!this.#launchInstaller(true)) throw new Error(t("upd.notReady"));
    app.quit();
  }

  /** Applies a downloaded update when the app quits without an explicit restart. */
  installOnQuit(): void {
    this.#launchInstaller(false);
  }

  #launchInstaller(relaunch: boolean): boolean {
    const target = this.#target;
    const staged = this.#staged;
    if (this.#installing || !target || !staged || this.#status.state !== "ready") return false;
    this.#installing = true;
    const child =
      target.kind === "mac"
        ? spawn("/bin/sh", ["-c", MAC_SWAP_SCRIPT, "sh", String(process.pid), target.bundle, staged, relaunch ? "1" : "0"], {
            detached: true,
            stdio: "ignore",
          })
        : spawn(staged, ["--updated", "/S", ...(relaunch ? ["--force-run"] : [])], { detached: true, stdio: "ignore" });
    child.on("error", (e) => console.error("[update] не удалось запустить установку:", e));
    child.unref();
    return true;
  }
}
