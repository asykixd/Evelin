import type { Lang } from "./i18n";

export type DeviceState = "device" | "unauthorized" | "offline";

export interface DeviceInfo {
  serial: string;
  state: DeviceState;
  model?: string;
  brand?: string;
  androidVersion?: string;
  battery?: number;
  /** `settings get global http_proxy`; empty when no proxy is set. */
  proxy?: string;
}

export interface DeviceResult {
  serial: string;
  success: boolean;
  output?: string;
  error?: string;
}

export interface Proxy {
  type: string;
  host: string;
  port: string;
  login: string;
  password: string;
  source: "file" | "cyberyozh";
}

export interface ProxyState {
  proxies: Proxy[];
  hasCyberyozhToken: boolean;
  encryptionAvailable: boolean;
}

export interface MirrorStarted {
  success: boolean;
  width?: number;
  height?: number;
  error?: string;
}

export interface VideoPacket {
  type: "configuration" | "data";
  keyframe?: boolean;
  data: Uint8Array;
}

export type TouchAction = "down" | "move" | "up";

/** Normalized to 0..1 so one touch can be broadcast to devices with different resolutions. */
export interface TouchEvent {
  action: TouchAction;
  x: number;
  y: number;
}

export type NavKey = "back" | "home" | "recents" | "power" | "volume_up" | "volume_down";

/** `t` is milliseconds since touch down. */
export interface GesturePoint {
  t: number;
  action: TouchAction;
  x: number;
  y: number;
}

export interface StepBase {
  id: string;
  enabled: boolean;
  /** Run only on iterations 1, N+1, 2N+1…; unset or 1 means every time. */
  everyNth?: number;
}

export type StepBody =
  | { type: "tap"; x: number; y: number }
  | { type: "swipe"; x1: number; y1: number; x2: number; y2: number; duration: number }
  | { type: "gesture"; points: GesturePoint[] }
  | { type: "key"; key: NavKey }
  | { type: "text"; text: string }
  /** Polls `uiautomator dump` for a node whose text or description contains `text`. */
  | { type: "waitText"; text: string; timeoutMs: number }
  | { type: "tapText"; text: string; timeoutMs: number }
  | { type: "wait"; ms: number; maxMs?: number }
  | { type: "launchApp"; package: string }
  | { type: "stopApp"; package: string }
  | { type: "clearAppData"; package: string }
  | { type: "proxyNext" }
  | { type: "proxyClear" }
  | { type: "shell"; command: string }
  | { type: "runScenario"; scenarioId: string };

export type Step = StepBase & StepBody;
export type StepType = StepBody["type"];

export interface Scenario {
  id: string;
  name: string;
  steps: Step[];
  /** 0 repeats until stopped. */
  repeat: number;
  pauseMs: number;
  continueOnError: boolean;
  updatedAt: number;
}

export type RunState = "running" | "done" | "failed" | "stopped";

export interface RunStatus {
  runId: string;
  scenarioId: string;
  scenarioName: string;
  serial: string;
  state: RunState;
  /** 1-based. */
  iteration: number;
  stepIndex: number;
  stepCount: number;
  error?: string;
  startedAt: number;
}

export interface RecordingStatus {
  serial: string;
  startedAt: number;
  events: number;
  /** Whether getevent attached, so touches on the phone itself are recorded too. */
  physical: boolean;
  physicalError?: string;
}

export interface StreamSettings {
  /** Long side of the video, px. */
  maxSize: number;
  /** Mbit/s. */
  bitRate: number;
  maxFps: number;
  stayAwake: boolean;
}

export interface AppSettings {
  language: Lang;
  /** False until the user picks a language on first run. */
  languageChosen: boolean;
  /** Ask before reboot and delete. */
  confirmDanger: boolean;
  stream: StreamSettings;
  /** URL fetched with curl on the device to test the proxy. */
  proxyTestUrl: string;
  /** Minutes; 0 disables. */
  cyberyozhRefreshMin: number;
  /** Empty means auto-detect. */
  adbPath: string;
}

export interface AppInfo {
  version: string;
  dataDir: string;
}

export type UpdateState = "idle" | "checking" | "latest" | "available" | "downloading" | "ready" | "error";

export interface UpdateStatus {
  state: UpdateState;
  current: string;
  latest?: string;
  /** GitHub release page. */
  url?: string;
  /** 0..1 while downloading. */
  progress?: number;
  /** False for dev builds, the portable zip or a read-only install location; the release page is offered instead. */
  canInstall: boolean;
  error?: string;
}

export interface FarmApi {
  settings: {
    get(): Promise<AppSettings>;
    update(patch: Partial<AppSettings>): Promise<AppSettings>;
    /** undefined when cancelled. */
    pickAdbPath(): Promise<string | undefined>;
    info(): Promise<AppInfo>;
    openDataDir(): Promise<void>;
  };
  devices: {
    list(): Promise<DeviceInfo[]>;
    refresh(serial: string): Promise<DeviceInfo | undefined>;
    onChange(listener: (devices: DeviceInfo[]) => void): () => void;
  };
  mirror: {
    start(serial: string): Promise<MirrorStarted>;
    stop(serial: string): Promise<void>;
    onPacket(listener: (serial: string, packet: VideoPacket) => void): () => void;
    onSize(listener: (serial: string, width: number, height: number) => void): () => void;
    onStopped(listener: (serial: string, reason: string) => void): () => void;
  };
  control: {
    touch(serials: string[], event: TouchEvent): void;
    scroll(serials: string[], x: number, y: number, dx: number, dy: number): void;
    key(serials: string[], key: NavKey): void;
    text(serials: string[], text: string): void;
  };
  batch: {
    shell(serials: string[], command: string): Promise<DeviceResult[]>;
    launchApp(serials: string[], pkg: string): Promise<DeviceResult[]>;
    installApk(serials: string[]): Promise<DeviceResult[]>;
    screenshot(serials: string[]): Promise<DeviceResult[]>;
    reboot(serials: string[]): Promise<DeviceResult[]>;
    wake(serials: string[]): Promise<DeviceResult[]>;
  };
  proxy: {
    state(): Promise<ProxyState>;
    importFile(): Promise<ProxyState>;
    clearFileProxies(): Promise<ProxyState>;
    setCyberyozhToken(token: string): Promise<ProxyState>;
    refreshCyberyozh(): Promise<{ state: ProxyState; error?: string }>;
    assign(serials: string[]): Promise<DeviceResult[]>;
    clear(serials: string[]): Promise<DeviceResult[]>;
    test(serials: string[]): Promise<DeviceResult[]>;
    /** Fires when main changes the list, e.g. on CyberYozh auto-refresh. */
    onChange(listener: (state: ProxyState) => void): () => void;
  };
  scenarios: {
    list(): Promise<Scenario[]>;
    save(scenario: Scenario): Promise<Scenario[]>;
    remove(id: string): Promise<Scenario[]>;
    exportFile(id: string): Promise<boolean>;
    /** `withShell` counts imported scenarios containing shell steps, which deserve a review before running. */
    importFile(): Promise<{ scenarios: Scenario[]; imported: number; withShell: number }>;
    run(id: string, serials: string[]): Promise<void>;
    /** Stops everything when called without arguments. */
    stop(serials?: string[]): Promise<void>;
    runs(): Promise<RunStatus[]>;
    onRuns(listener: (runs: RunStatus[]) => void): () => void;
  };
  recorder: {
    start(serial: string): Promise<RecordingStatus>;
    /** Saves the recording as a new scenario. */
    stop(): Promise<Scenario | undefined>;
    cancel(): Promise<void>;
    onStatus(listener: (status: RecordingStatus | null) => void): () => void;
  };
  updates: {
    status(): Promise<UpdateStatus>;
    check(): Promise<UpdateStatus>;
    download(): Promise<void>;
    /** Quits, installs the downloaded update and relaunches. */
    install(): Promise<void>;
    onStatus(listener: (status: UpdateStatus) => void): () => void;
  };
}
