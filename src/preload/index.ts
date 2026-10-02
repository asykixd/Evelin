import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { DeviceInfo, FarmApi, ProxyState, RecordingStatus, RunStatus, UpdateStatus, VideoPacket } from "@shared/types";

function subscribe<A extends unknown[]>(channel: string, listener: (...args: A) => void): () => void {
  const wrapped = (_e: IpcRendererEvent, ...args: unknown[]) => listener(...(args as A));
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.off(channel, wrapped);
}

const api: FarmApi = {
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    update: (patch) => ipcRenderer.invoke("settings:update", patch),
    pickAdbPath: () => ipcRenderer.invoke("settings:pickAdb"),
    info: () => ipcRenderer.invoke("settings:info"),
    openDataDir: () => ipcRenderer.invoke("settings:openDataDir"),
  },
  devices: {
    list: () => ipcRenderer.invoke("devices:list"),
    refresh: (serial) => ipcRenderer.invoke("devices:refresh", serial),
    onChange: (listener) => subscribe<[DeviceInfo[]]>("devices:changed", listener),
  },
  mirror: {
    start: (serial) => ipcRenderer.invoke("mirror:start", serial),
    stop: (serial) => ipcRenderer.invoke("mirror:stop", serial),
    onPacket: (listener) => subscribe<[string, VideoPacket]>("mirror:packet", listener),
    onSize: (listener) => subscribe<[string, number, number]>("mirror:size", listener),
    onStopped: (listener) => subscribe<[string, string]>("mirror:stopped", listener),
  },
  control: {
    touch: (serials, event) => ipcRenderer.send("control:touch", serials, event),
    scroll: (serials, x, y, dx, dy) => ipcRenderer.send("control:scroll", serials, x, y, dx, dy),
    key: (serials, key) => ipcRenderer.send("control:key", serials, key),
    text: (serials, text) => ipcRenderer.send("control:text", serials, text),
  },
  batch: {
    shell: (serials, command) => ipcRenderer.invoke("batch:shell", serials, command),
    launchApp: (serials, pkg) => ipcRenderer.invoke("batch:launchApp", serials, pkg),
    installApk: (serials) => ipcRenderer.invoke("batch:installApk", serials),
    screenshot: (serials) => ipcRenderer.invoke("batch:screenshot", serials),
    reboot: (serials) => ipcRenderer.invoke("batch:reboot", serials),
    wake: (serials) => ipcRenderer.invoke("batch:wake", serials),
  },
  proxy: {
    state: () => ipcRenderer.invoke("proxy:state"),
    importFile: () => ipcRenderer.invoke("proxy:importFile"),
    clearFileProxies: () => ipcRenderer.invoke("proxy:clearFile"),
    setCyberyozhToken: (token) => ipcRenderer.invoke("proxy:setToken", token),
    refreshCyberyozh: () => ipcRenderer.invoke("proxy:refreshCyberyozh"),
    assign: (serials) => ipcRenderer.invoke("proxy:assign", serials),
    clear: (serials) => ipcRenderer.invoke("proxy:clear", serials),
    test: (serials) => ipcRenderer.invoke("proxy:test", serials),
    onChange: (listener) => subscribe<[ProxyState]>("proxy:changed", listener),
  },
  scenarios: {
    list: () => ipcRenderer.invoke("scenarios:list"),
    save: (scenario) => ipcRenderer.invoke("scenarios:save", scenario),
    remove: (id) => ipcRenderer.invoke("scenarios:remove", id),
    exportFile: (id) => ipcRenderer.invoke("scenarios:export", id),
    importFile: () => ipcRenderer.invoke("scenarios:import"),
    run: (id, serials) => ipcRenderer.invoke("scenarios:run", id, serials),
    stop: (serials) => ipcRenderer.invoke("scenarios:stop", serials),
    runs: () => ipcRenderer.invoke("scenarios:runs"),
    onRuns: (listener) => subscribe<[RunStatus[]]>("scenarios:runs", listener),
  },
  recorder: {
    start: (serial) => ipcRenderer.invoke("recorder:start", serial),
    stop: () => ipcRenderer.invoke("recorder:stop"),
    cancel: () => ipcRenderer.invoke("recorder:cancel"),
    onStatus: (listener) => subscribe<[RecordingStatus | null]>("recorder:status", listener),
  },
  updates: {
    status: () => ipcRenderer.invoke("updates:status"),
    check: () => ipcRenderer.invoke("updates:check"),
    download: () => ipcRenderer.invoke("updates:download"),
    install: () => ipcRenderer.invoke("updates:install"),
    onStatus: (listener) => subscribe<[UpdateStatus]>("updates:status", listener),
  },
};

contextBridge.exposeInMainWorld("farm", api);
