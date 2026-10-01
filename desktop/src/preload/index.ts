import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { DeviceInfo, FarmApi, VideoPacket } from "@shared/types";

// Наружу отдаём только узкий типизированный API, без доступа к ipcRenderer.
function subscribe<A extends unknown[]>(channel: string, listener: (...args: A) => void): () => void {
  const wrapped = (_e: IpcRendererEvent, ...args: unknown[]) => listener(...(args as A));
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.off(channel, wrapped);
}

const api: FarmApi = {
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
  },
};

contextBridge.exposeInMainWorld("farm", api);
