import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { BitmapVideoFrameRenderer, WebCodecsVideoDecoder } from "@yume-chan/scrcpy-decoder-webcodecs";
import { ScrcpyVideoCodecId, type ScrcpyMediaStreamPacket } from "@yume-chan/scrcpy";
import type { DeviceInfo, NavKey, RunStatus } from "@shared/types";
import { useT } from "../settings";
import { route } from "../video";

interface Props {
  device: DeviceInfo;
  selected: boolean;
  focused: boolean;
  recording: boolean;
  /** Выполняющийся на устройстве сценарий. */
  run?: RunStatus;
  /** Меняется вместе с настройками трансляции — тогда поток перезапускается. */
  streamKey: string;
  /** На какие устройства отправлять ввод с этой плитки (с учётом режима трансляции). */
  targets: () => string[];
  onToggleSelect: () => void;
  onToggleFocus: () => void;
}

type Status = { kind: "connecting" } | { kind: "live" } | { kind: "error"; message: string };

export function DeviceTile({ device, selected, focused, recording, run, streamKey, targets, onToggleSelect, onToggleFocus }: Props) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<Status>({ kind: "connecting" });
  const [attempt, setAttempt] = useState(0);
  const pointerDown = useRef(false);
  const online = device.state === "device";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!online || !canvas) return;

    let cancelled = false;
    setStatus({ kind: "connecting" });

    // Декодер создаём до запуска потока, чтобы не потерять первый пакет с конфигурацией кодека.
    const decoder = new WebCodecsVideoDecoder({
      codec: ScrcpyVideoCodecId.H264,
      // Bitmap-рендерер не тратит WebGL-контексты: их в Chromium не больше ~16 на страницу, а устройств бывает больше.
      renderer: new BitmapVideoFrameRenderer(canvas),
    });
    const writer = decoder.writable.getWriter();
    // Поток может перезапуститься из main (например, сценарием) — тогда плитка снова оживает сама.
    let live = false;

    const unroute = route(device.serial, {
      packet(packet) {
        writer.write(packet as ScrcpyMediaStreamPacket).catch(() => {});
        if (!live && packet.type === "data") {
          live = true;
          setStatus({ kind: "live" });
        }
      },
      stopped(reason) {
        live = false;
        if (!cancelled) setStatus({ kind: "error", message: reason });
      },
    });

    void window.farm.mirror.start(device.serial).then((res) => {
      if (!cancelled && !res.success) setStatus({ kind: "error", message: res.error ?? t("tile.mirrorFailed") });
    });

    return () => {
      cancelled = true;
      unroute();
      void window.farm.mirror.stop(device.serial);
      writer.releaseLock();
      decoder.dispose();
    };
  }, [device.serial, online, attempt, streamKey]);

  // --- Ввод ---

  function point(e: PointerEvent | WheelEvent) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  }

  function onPointerDown(e: PointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0 || status.kind !== "live") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointerDown.current = true;
    window.farm.control.touch(targets(), { action: "down", ...point(e) });
  }

  function onPointerMove(e: PointerEvent<HTMLCanvasElement>) {
    if (!pointerDown.current) return;
    window.farm.control.touch(targets(), { action: "move", ...point(e) });
  }

  function onPointerUp(e: PointerEvent<HTMLCanvasElement>) {
    if (!pointerDown.current) return;
    pointerDown.current = false;
    window.farm.control.touch(targets(), { action: "up", ...point(e) });
  }

  function onWheel(e: WheelEvent<HTMLCanvasElement>) {
    if (status.kind !== "live") return;
    const { x, y } = point(e);
    window.farm.control.scroll(targets(), x, y, -e.deltaX / 100, -e.deltaY / 100);
  }

  const key = (k: NavKey) => window.farm.control.key(targets(), k);

  const title = [device.brand, device.model].filter(Boolean).join(" ") || device.serial;

  return (
    <div className={`tile${selected ? " selected" : ""}${focused ? " focused" : ""}${recording ? " recording" : ""}`}>
      <header className="tile-header">
        <label className="tile-check" title={t("tile.select")}>
          <input type="checkbox" checked={selected} onChange={onToggleSelect} />
        </label>
        <div className="tile-title" title={device.serial}>
          <span className="tile-name">{title}</span>
          <span className="tile-meta">
            {device.androidVersion ? `Android ${device.androidVersion}` : device.serial}
            {device.battery !== undefined && ` · ${device.battery}%`}
          </span>
        </div>
        {recording && (
          <span className="badge badge-rec" title={t("tile.recording")}>
            ● rec
          </span>
        )}
        {run && (
          <span className="badge badge-run" title={t("tile.run", { name: run.scenarioName, step: run.stepIndex + 1, count: run.stepCount, iteration: run.iteration })}>
            ▶ {run.stepIndex + 1}/{run.stepCount}
          </span>
        )}
        {device.proxy ? (
          <span className="badge badge-proxy" title={t("tile.proxy", { proxy: device.proxy })}>
            proxy
          </span>
        ) : null}
        <button className="icon-btn" onClick={onToggleFocus} title={focused ? t("tile.zoomOut") : t("tile.zoomIn")}>
          {focused ? "⤡" : "⤢"}
        </button>
      </header>

      <div className="screen">
        {online ? (
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
            onContextMenu={(e) => {
              e.preventDefault();
              key("back");
            }}
          />
        ) : null}
        {!online && (
          <div className="screen-overlay">
            {device.state === "unauthorized" ? t("tile.unauthorized") : t("tile.offline")}
          </div>
        )}
        {online && status.kind === "connecting" && <div className="screen-overlay">{t("tile.connecting")}</div>}
        {online && status.kind === "error" && (
          <div className="screen-overlay error">
            <span>{status.message}</span>
            <button className="btn" onClick={() => setAttempt((n) => n + 1)}>
              {t("tile.reconnect")}
            </button>
          </div>
        )}
      </div>

      <footer className="tile-nav">
        <button className="icon-btn" onClick={() => key("back")} title={t("key.back")}>
          ◁
        </button>
        <button className="icon-btn" onClick={() => key("home")} title={t("key.home")}>
          ○
        </button>
        <button className="icon-btn" onClick={() => key("recents")} title={t("key.recents")}>
          ▢
        </button>
        <button className="icon-btn" onClick={() => key("power")} title={t("key.power")}>
          ⏻
        </button>
      </footer>
    </div>
  );
}
