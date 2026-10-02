import { readFile } from "node:fs/promises";
import { AdbScrcpyClient, AdbScrcpyOptions3_3_3 } from "@yume-chan/adb-scrcpy";
import {
  AndroidKeyCode,
  AndroidKeyEventAction,
  AndroidMotionEventAction,
  DefaultServerPath,
  ScrcpyInstanceId,
  ScrcpyPointerId,
} from "@yume-chan/scrcpy";
import { ReadableStream } from "@yume-chan/stream-extra";
import { t } from "@shared/i18n";
import { DEFAULT_STREAM } from "@shared/settings";
import type { NavKey, StreamSettings, TouchEvent, VideoPacket } from "@shared/types";
import type { DeviceManager } from "./devices";


const KEYS: Record<NavKey, AndroidKeyCode> = {
  back: AndroidKeyCode.AndroidBack,
  home: AndroidKeyCode.AndroidHome,
  recents: AndroidKeyCode.AndroidAppSwitch,
  power: AndroidKeyCode.Power,
  volume_up: AndroidKeyCode.VolumeUp,
  volume_down: AndroidKeyCode.VolumeDown,
};

const TOUCH_ACTIONS = {
  down: AndroidMotionEventAction.Down,
  move: AndroidMotionEventAction.Move,
  up: AndroidMotionEventAction.Up,
} as const;

type Client = AdbScrcpyClient<AdbScrcpyOptions3_3_3<true>>;
// The video stream class isn't exported, so derive its type from the client.
type VideoStream = NonNullable<Awaited<Client["videoStream"]>>;

interface Session {
  client: Client;
  video: VideoStream;
}

export interface MirrorSink {
  packet(serial: string, packet: VideoPacket): void;
  size(serial: string, width: number, height: number): void;
  stopped(serial: string, reason: string): void;
}

export class MirrorManager {
  #sessions = new Map<string, Promise<Session>>();
  #pushed = new Map<string, Promise<void>>();
  #server: Promise<Uint8Array>;

  constructor(
    private readonly devices: DeviceManager,
    serverPath: string,
    private readonly sink: MirrorSink,
    /** Read on every session start, so settings changes apply on reconnect. */
    private readonly stream: () => StreamSettings = () => DEFAULT_STREAM,
  ) {
    this.#server = readFile(serverPath);
  }

  isRunning(serial: string): boolean {
    return this.#sessions.has(serial);
  }

  /** Starts a session if needed, without restarting one that is already running. */
  async ensure(serial: string): Promise<void> {
    const pending = this.#sessions.get(serial);
    if (pending && (await pending.then(() => true, () => false))) return;
    await this.start(serial);
  }

  async start(serial: string): Promise<{ width: number; height: number }> {
    // Restart so a freshly created decoder receives the codec configuration again.
    if (this.#sessions.has(serial)) await this.stop(serial);

    const pending = this.#open(serial);
    this.#sessions.set(serial, pending);
    try {
      const { video } = await pending;
      return { width: video.width, height: video.height };
    } catch (e) {
      if (this.#sessions.get(serial) === pending) this.#sessions.delete(serial);
      throw e;
    }
  }

  async #open(serial: string): Promise<Session> {
    const adb = await this.devices.getAdb(serial);

    let pushed = this.#pushed.get(serial);
    if (!pushed) {
      pushed = this.#server.then((bytes) =>
        AdbScrcpyClient.pushServer(
          adb,
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
        ),
      );
      this.#pushed.set(serial, pushed);
      pushed.catch(() => this.#pushed.delete(serial));
    }
    await pushed;

    const quality = this.stream();
    const options = new AdbScrcpyOptions3_3_3({
      audio: false,
      control: true,
      videoCodec: "h264",
      maxSize: quality.maxSize,
      videoBitRate: Math.round(quality.bitRate * 1_000_000),
      maxFps: quality.maxFps,
      stayAwake: quality.stayAwake,
      clipboardAutosync: false,
      tunnelForward: true,
      scid: ScrcpyInstanceId.random(),
    });

    const client = await AdbScrcpyClient.start(adb, DefaultServerPath, options);
    const video = await client.videoStream;
    if (!video) {
      await client.close();
      throw new Error(t("err.noVideo"));
    }
    const session: Session = { client, video };

    video.sizeChanged(({ width, height }) => this.sink.size(serial, width, height));
    void this.#pump(serial, session);

    // Server logs must be drained, otherwise the stream can stall.
    void drainLog(serial, client.output);

    return session;
  }

  async #pump(serial: string, session: Session): Promise<void> {
    let reason = t("err.mirrorEnded");
    try {
      const reader = session.video.stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        this.sink.packet(
          serial,
          value.type === "configuration"
            ? { type: "configuration", data: value.data }
            : { type: "data", keyframe: value.keyframe, data: value.data },
        );
      }
    } catch (e) {
      reason = e instanceof Error ? e.message : String(e);
    }
    // Don't report if the session has already been replaced by a new one.
    const current = this.#sessions.get(serial);
    if (current && (await current.catch(() => undefined)) === session) {
      this.#sessions.delete(serial);
      this.sink.stopped(serial, reason);
    }
  }

  async stop(serial: string): Promise<void> {
    const pending = this.#sessions.get(serial);
    if (!pending) return;
    this.#sessions.delete(serial);
    try {
      const { client } = await pending;
      await client.close();
    } catch {
      // already closed or never opened
    }
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.#sessions.keys()].map((s) => this.stop(s)));
  }

  forgetDevice(serial: string): void {
    this.#pushed.delete(serial);
    void this.stop(serial);
  }

  async #ready(serial: string): Promise<Session | undefined> {
    try {
      return await this.#sessions.get(serial);
    } catch {
      return undefined;
    }
  }

  // Per-device control errors are swallowed so one dropped device doesn't break broadcast to the rest.

  async touch(serials: string[], event: TouchEvent): Promise<void> {
    await Promise.all(
      serials.map(async (serial) => {
        const s = await this.#ready(serial);
        const ctl = s?.client.controller;
        if (!s || !ctl) return;
        const { width, height } = s.video;
        await ctl
          .injectTouch({
            action: TOUCH_ACTIONS[event.action],
            pointerId: ScrcpyPointerId.Finger,
            pointerX: clamp01(event.x) * width,
            pointerY: clamp01(event.y) * height,
            videoWidth: width,
            videoHeight: height,
            pressure: event.action === "up" ? 0 : 1,
            actionButton: 0,
            buttons: 0,
          })
          .catch(() => {});
      }),
    );
  }

  async scroll(serials: string[], x: number, y: number, dx: number, dy: number): Promise<void> {
    await Promise.all(
      serials.map(async (serial) => {
        const s = await this.#ready(serial);
        const ctl = s?.client.controller;
        if (!s || !ctl) return;
        const { width, height } = s.video;
        await ctl
          .injectScroll({
            pointerX: clamp01(x) * width,
            pointerY: clamp01(y) * height,
            videoWidth: width,
            videoHeight: height,
            scrollX: clamp(dx, -1, 1),
            scrollY: clamp(dy, -1, 1),
            buttons: 0,
          })
          .catch(() => {});
      }),
    );
  }

  async key(serials: string[], key: NavKey): Promise<void> {
    const keyCode = KEYS[key];
    await Promise.all(
      serials.map(async (serial) => {
        const ctl = (await this.#ready(serial))?.client.controller;
        if (!ctl) return;
        try {
          for (const action of [AndroidKeyEventAction.Down, AndroidKeyEventAction.Up]) {
            await ctl.injectKeyCode({ action, keyCode, repeat: 0, metaState: 0 });
          }
        } catch {
          // device disconnected
        }
      }),
    );
  }

  async text(serials: string[], text: string): Promise<void> {
    await Promise.all(
      serials.map(async (serial) => {
        const ctl = (await this.#ready(serial))?.client.controller;
        await ctl?.injectText(text).catch(() => {});
      }),
    );
  }
}

async function drainLog(serial: string, output: ReadableStream<string>): Promise<void> {
  try {
    const reader = output.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      if (/ERROR|WARN/.test(value)) console.warn(`[scrcpy ${serial}] ${value}`);
    }
  } catch {
    // closed together with the session
  }
}

function clamp(v: number, min: number, max: number): number {
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : 0;
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}
