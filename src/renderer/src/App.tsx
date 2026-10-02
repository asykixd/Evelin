import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DeviceInfo, DeviceResult, RecordingStatus, RunStatus, Scenario } from "@shared/types";
import { DeviceTile } from "./components/DeviceTile";
import { ActionsPanel } from "./components/ActionsPanel";
import { ProxyPanel } from "./components/ProxyPanel";
import { LogPanel, type LogEntry } from "./components/LogPanel";
import { ScenarioEditor } from "./components/ScenarioEditor";
import { ScenariosPanel } from "./components/ScenariosPanel";
import { SettingsModal } from "./components/SettingsModal";
import { useSettings, useT } from "./settings";

type Tab = "actions" | "scenarios" | "proxy";

const TILE_WIDTH_KEY = "evelin.tileWidth";

function savedTileWidth(): number {
  try {
    const n = Number(localStorage.getItem(TILE_WIDTH_KEY));
    return n >= 160 && n <= 420 ? n : 240;
  } catch {
    return 240;
  }
}

export function App() {
  const t = useT();
  const { settings } = useSettings();
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState<string | undefined>();
  const [broadcast, setBroadcast] = useState(false);
  const [tileWidth, setTileWidth] = useState(savedTileWidth);
  const [tab, setTab] = useState<Tab>("actions");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [runs, setRuns] = useState<RunStatus[]>([]);
  const [recording, setRecording] = useState<RecordingStatus | null>(null);
  const [editing, setEditing] = useState<Scenario | undefined>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Смена качества трансляции в настройках переподключает все плитки.
  const streamKey = JSON.stringify(settings.stream);

  useEffect(() => {
    try {
      localStorage.setItem(TILE_WIDTH_KEY, String(tileWidth));
    } catch {
      // хранилище недоступно — размер просто не запомнится
    }
  }, [tileWidth]);

  useEffect(() => {
    void window.farm.devices.list().then(setDevices);
    void window.farm.scenarios.list().then(setScenarios);
    void window.farm.scenarios.runs().then(setRuns);
    const offs = [window.farm.devices.onChange(setDevices), window.farm.scenarios.onRuns(setRuns), window.farm.recorder.onStatus(setRecording)];
    return () => offs.forEach((off) => off());
  }, []);

  // Убираем из выделения отключившиеся устройства.
  useEffect(() => {
    const present = new Set(devices.map((d) => d.serial));
    setSelected((prev) => {
      const next = new Set([...prev].filter((s) => present.has(s)));
      return next.size === prev.size ? prev : next;
    });
    if (focused && !present.has(focused)) setFocused(undefined);
  }, [devices, focused]);

  // Плитки читают актуальное состояние через ref, чтобы не пересоздавать обработчики на каждое изменение выделения.
  const stateRef = useRef({ broadcast, selected });
  stateRef.current = { broadcast, selected };

  const targetsFor = useCallback((serial: string) => {
    const { broadcast, selected } = stateRef.current;
    return broadcast && selected.has(serial) ? [...selected] : [serial];
  }, []);

  const online = useMemo(() => devices.filter((d) => d.state === "device"), [devices]);
  // Пакетные действия применяются к выбранным устройствам, а если ничего не выбрано — ко всем подключённым.
  const actionTargets = useMemo(
    () => (selected.size > 0 ? [...selected] : online.map((d) => d.serial)),
    [selected, online],
  );

  const toggle = (serial: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(serial)) next.delete(serial);
      else next.add(serial);
      return next;
    });

  const nameOf = useCallback(
    (serial: string) => {
      const d = devices.find((x) => x.serial === serial);
      return d?.model ? `${d.model} (${serial})` : serial;
    },
    [devices],
  );

  const report = useCallback(
    (title: string, results: DeviceResult[]) => {
      if (results.length === 0) return;
      const entry: LogEntry = {
        id: crypto.randomUUID(),
        time: new Date(),
        title,
        results: results.map((r) => ({ ...r, name: nameOf(r.serial) })),
      };
      setLog((prev) => [entry, ...prev].slice(0, 100));
    },
    [nameOf],
  );

  const run = useCallback(
    async (title: string, action: (serials: string[]) => Promise<DeviceResult[]>) => {
      if (actionTargets.length === 0) return;
      try {
        report(title, await action(actionTargets));
      } catch (e) {
        report(title, [{ serial: "—", success: false, error: e instanceof Error ? e.message : String(e) }]);
      }
    },
    [actionTargets, report],
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Evelin</div>
        <div className="topbar-stats">
          <span>
            {t("top.devices")} <b>{online.length}</b>
            {devices.length > online.length && <span className="muted"> / {devices.length}</span>}
          </span>
          <span>
            {t("top.selected")} <b>{selected.size}</b>
          </span>
        </div>
        <div className="topbar-controls">
          <button className="btn" onClick={() => setSelected(new Set(online.map((d) => d.serial)))}>
            {t("top.selectAll")}
          </button>
          <button className="btn" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
            {t("top.deselect")}
          </button>
          <label className={`toggle${broadcast ? " on" : ""}`} title={t("top.broadcastHint")}>
            <input type="checkbox" checked={broadcast} onChange={(e) => setBroadcast(e.target.checked)} />
            {t("top.broadcast")}
          </label>
          <label className="slider" title={t("top.tileSize")}>
            <input type="range" min={160} max={420} step={10} value={tileWidth} onChange={(e) => setTileWidth(Number(e.target.value))} />
          </label>
          <button className="icon-btn settings-btn" title={t("top.settings")} onClick={() => setSettingsOpen(true)}>
            ⚙
          </button>
        </div>
      </header>

      <main className="content">
        {devices.length === 0 ? (
          <div className="empty">
            <h2>{t("empty.title")}</h2>
            <p>{t("empty.text")}</p>
          </div>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${tileWidth}px, 1fr))` }}>
            {devices.map((d) => (
              <DeviceTile
                key={d.serial}
                device={d}
                selected={selected.has(d.serial)}
                focused={focused === d.serial}
                recording={recording?.serial === d.serial}
                run={runs.find((r) => r.serial === d.serial && r.state === "running")}
                streamKey={streamKey}
                targets={() => targetsFor(d.serial)}
                onToggleSelect={() => toggle(d.serial)}
                onToggleFocus={() => setFocused((f) => (f === d.serial ? undefined : d.serial))}
              />
            ))}
          </div>
        )}
      </main>

      <aside className="sidebar">
        <nav className="tabs">
          <button className={tab === "actions" ? "active" : ""} onClick={() => setTab("actions")}>
            {t("tab.actions")}
          </button>
          <button className={tab === "scenarios" ? "active" : ""} onClick={() => setTab("scenarios")}>
            {t("tab.scenarios")}
            {runs.some((r) => r.state === "running") && <span className="tab-dot" />}
          </button>
          <button className={tab === "proxy" ? "active" : ""} onClick={() => setTab("proxy")}>
            {t("tab.proxy")}
          </button>
        </nav>
        <div className="targets-hint">
          {selected.size > 0 ? t("targets.selected", { n: selected.size }) : t("targets.all", { n: online.length })}
        </div>
        <div className="sidebar-body">
          {tab === "actions" && <ActionsPanel targets={actionTargets} run={run} />}
          {tab === "scenarios" && (
            <ScenariosPanel
              devices={devices}
              targets={actionTargets}
              preferredSerial={focused ?? [...selected][0]}
              scenarios={scenarios}
              setScenarios={setScenarios}
              runs={runs}
              recording={recording}
              onEdit={setEditing}
            />
          )}
          {tab === "proxy" && <ProxyPanel targets={actionTargets} run={run} onOpenSettings={() => setSettingsOpen(true)} />}
        </div>
        <LogPanel entries={log} onClear={() => setLog([])} />
      </aside>

      {editing && <ScenarioEditor key={editing.id} scenario={editing} scenarios={scenarios} onSaved={setScenarios} onClose={() => setEditing(undefined)} />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
