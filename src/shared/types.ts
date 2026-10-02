// Типы, общие для main, preload и renderer.

import type { Lang } from "./i18n";

export type DeviceState = "device" | "unauthorized" | "offline";

export interface DeviceInfo {
  serial: string;
  state: DeviceState;
  model?: string;
  brand?: string;
  androidVersion?: string;
  battery?: number;
  /** Текущее значение `settings get global http_proxy`, пустая строка — прокси нет. */
  proxy?: string;
}

/** Результат операции над одним устройством. Методы никогда не бросают исключения наружу. */
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
  /** Можно ли зашифровать токен средствами ОС (Keychain / DPAPI / libsecret). */
  encryptionAvailable: boolean;
}

export interface MirrorStarted {
  success: boolean;
  width?: number;
  height?: number;
  error?: string;
}

/** Пакет видеопотока scrcpy, сериализуемый через IPC. */
export interface VideoPacket {
  type: "configuration" | "data";
  keyframe?: boolean;
  data: Uint8Array;
}

export type TouchAction = "down" | "move" | "up";

/** Координаты нормализованы в диапазон 0..1, чтобы одно касание можно было транслировать на устройства с разным разрешением. */
export interface TouchEvent {
  action: TouchAction;
  x: number;
  y: number;
}

export type NavKey = "back" | "home" | "recents" | "power" | "volume_up" | "volume_down";

// --- Сценарии (пресеты) ---

/** Точка жеста; `t` — миллисекунды от начала касания. */
export interface GesturePoint {
  t: number;
  action: TouchAction;
  x: number;
  y: number;
}

export interface StepBase {
  id: string;
  /** Выключенный шаг пропускается. */
  enabled: boolean;
  /** Выполнять только на 1-м, (N+1)-м, (2N+1)-м… повторе. 1 или пусто — каждый раз. */
  everyNth?: number;
}

export type StepBody =
  | { type: "tap"; x: number; y: number }
  | { type: "swipe"; x1: number; y1: number; x2: number; y2: number; duration: number }
  | { type: "gesture"; points: GesturePoint[] }
  | { type: "key"; key: NavKey }
  | { type: "text"; text: string }
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
  /** Сколько раз повторить; 0 — бесконечно, пока не остановят. */
  repeat: number;
  /** Пауза между повторами, мс. */
  pauseMs: number;
  /** Продолжать при ошибке шага вместо остановки сценария на этом устройстве. */
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
  /** Номер текущего повтора, с 1. */
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
  /** Удалось ли подключиться к сенсору телефона (getevent), чтобы записывать касания по самому телефону. */
  physical: boolean;
  physicalError?: string;
}

// --- Настройки ---

export interface StreamSettings {
  /** Длинная сторона видео, px. */
  maxSize: number;
  /** Мбит/с. */
  bitRate: number;
  maxFps: number;
  /** Держать экран включённым, пока идёт трансляция. */
  stayAwake: boolean;
}

export interface AppSettings {
  language: Lang;
  /** Спрашивать подтверждение перед перезагрузкой и удалением. */
  confirmDanger: boolean;
  stream: StreamSettings;
  /** Адрес, который запрашивается curl-ом с устройства при проверке IP. */
  proxyTestUrl: string;
  /** Период автообновления списка CyberYozh, минуты; 0 — выключено. */
  cyberyozhRefreshMin: number;
  /** Свой путь к adb; пусто — искать автоматически. */
  adbPath: string;
}

export interface AppInfo {
  version: string;
  dataDir: string;
}

export interface FarmApi {
  settings: {
    get(): Promise<AppSettings>;
    update(patch: Partial<AppSettings>): Promise<AppSettings>;
    /** Диалог выбора файла adb; undefined — отменено. */
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
    /** Раздаёт прокси выбранным устройствам по кругу (round-robin). */
    assign(serials: string[]): Promise<DeviceResult[]>;
    clear(serials: string[]): Promise<DeviceResult[]>;
    test(serials: string[]): Promise<DeviceResult[]>;
    /** Список прокси изменился в main (например, автообновление CyberYozh). */
    onChange(listener: (state: ProxyState) => void): () => void;
  };
  scenarios: {
    list(): Promise<Scenario[]>;
    save(scenario: Scenario): Promise<Scenario[]>;
    remove(id: string): Promise<Scenario[]>;
    exportFile(id: string): Promise<boolean>;
    /** Возвращает список и число импортированных сценариев с shell-шагами — их стоит проверить перед запуском. */
    importFile(): Promise<{ scenarios: Scenario[]; imported: number; withShell: number }>;
    run(id: string, serials: string[]): Promise<void>;
    /** Без аргумента — остановить всё. */
    stop(serials?: string[]): Promise<void>;
    runs(): Promise<RunStatus[]>;
    onRuns(listener: (runs: RunStatus[]) => void): () => void;
  };
  recorder: {
    start(serial: string): Promise<RecordingStatus>;
    /** Останавливает запись и сохраняет её как новый сценарий. */
    stop(): Promise<Scenario | undefined>;
    cancel(): Promise<void>;
    onStatus(listener: (status: RecordingStatus | null) => void): () => void;
  };
}
