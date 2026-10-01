// Типы, общие для main, preload и renderer.

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

export interface FarmApi {
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
  };
}
