import { useEffect, useState } from "react";
import { newScenario } from "@shared/scenario";
import type { DeviceInfo, RecordingStatus, RunStatus, Scenario } from "@shared/types";
import { errorText } from "../errors";

interface Props {
  devices: DeviceInfo[];
  targets: string[];
  /** Устройство для записи по умолчанию: увеличенное или первое выбранное. */
  preferredSerial?: string;
  scenarios: Scenario[];
  setScenarios: (s: Scenario[]) => void;
  runs: RunStatus[];
  recording: RecordingStatus | null;
  onEdit: (scenario: Scenario) => void;
}

const RUN_STATE: Record<RunStatus["state"], string> = {
  running: "выполняется",
  done: "готово",
  failed: "ошибка",
  stopped: "остановлен",
};

export function ScenariosPanel({ devices, targets, preferredSerial, scenarios, setScenarios, runs, recording, onEdit }: Props) {
  const online = devices.filter((d) => d.state === "device");
  const [recSerial, setRecSerial] = useState<string>("");
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [now, setNow] = useState(Date.now());

  const nameOf = (serial: string) => {
    const d = devices.find((x) => x.serial === serial);
    return d?.model ? `${d.model}` : serial;
  };

  // Если устройство для записи не выбрано или отключилось — берём предпочтительное.
  useEffect(() => {
    if (!recSerial || !online.some((d) => d.serial === recSerial)) setRecSerial(preferredSerial ?? online[0]?.serial ?? "");
  }, [preferredSerial, online, recSerial]);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [recording]);

  async function act(fn: () => Promise<unknown>) {
    setError(undefined);
    setNotice(undefined);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    }
  }

  const running = runs.filter((r) => r.state === "running");

  return (
    <div className="panel">
      <section>
        <h3>Запись действий</h3>
        {recording ? (
          <>
            <div className="rec-status">
              <span className="rec-dot" /> {nameOf(recording.serial)} · {formatDuration(now - recording.startedAt)} · событий: {recording.events}
            </div>
            <p className="hint">
              Действуйте прямо на телефоне или через его плитку в Evelin.
              {!recording.physical && (
                <>
                  {" "}
                  <span className="warn">Касания по самому телефону не записываются: {recording.physicalError}.</span>
                </>
              )}
            </p>
            <div className="btn-grid">
              <button
                className="btn primary"
                onClick={() =>
                  act(async () => {
                    const scenario = await window.farm.recorder.stop();
                    if (!scenario) return setNotice("Ничего не записано");
                    setScenarios(await window.farm.scenarios.list());
                    onEdit(scenario);
                  })
                }
              >
                ■ Сохранить
              </button>
              <button className="btn" onClick={() => act(() => window.farm.recorder.cancel())}>
                Отменить
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="row">
              <select className="input" value={recSerial} onChange={(e) => setRecSerial(e.target.value)} disabled={online.length === 0}>
                {online.map((d) => (
                  <option key={d.serial} value={d.serial}>
                    {d.model ?? d.serial}
                  </option>
                ))}
              </select>
              <button className="btn rec" disabled={!recSerial} onClick={() => act(() => window.farm.recorder.start(recSerial))}>
                ● Запись
              </button>
            </div>
            <p className="hint">Записываются касания, свайпы, кнопки, ввод текста, запуск приложений и паузы между действиями.</p>
          </>
        )}
      </section>

      {running.length > 0 && (
        <section>
          <h3>Выполняется</h3>
          <ul className="run-list">
            {running.map((r) => (
              <li key={r.runId}>
                <div className="run-main">
                  <b>{nameOf(r.serial)}</b> — {r.scenarioName}
                  <div className="muted">
                    шаг {r.stepIndex + 1}/{r.stepCount} · повтор {r.iteration}
                  </div>
                </div>
                <button className="icon-btn" title="Остановить" onClick={() => act(() => window.farm.scenarios.stop([r.serial]))}>
                  ■
                </button>
              </li>
            ))}
          </ul>
          <button className="btn danger wide" onClick={() => act(() => window.farm.scenarios.stop())}>
            Остановить все
          </button>
        </section>
      )}

      <section>
        <div className="section-head">
          <h3>Сценарии</h3>
          <div className="row-tight">
            <button className="link" onClick={() => onEdit(newScenario())}>
              + создать
            </button>
            <button
              className="link"
              onClick={() =>
                act(async () => {
                  const res = await window.farm.scenarios.importFile();
                  setScenarios(res.scenarios);
                  if (res.imported > 0) {
                    setNotice(
                      `Импортировано: ${res.imported}` +
                        (res.withShell > 0 ? `. Внимание: ${res.withShell} содержат ADB shell-команды — проверьте их перед запуском.` : ""),
                    );
                  }
                })
              }
            >
              импорт
            </button>
          </div>
        </div>
        {scenarios.length === 0 && <p className="hint">Пока пусто. Запишите действия или создайте сценарий вручную.</p>}
        <ul className="scenario-list">
          {scenarios.map((s) => {
            const last = runs.filter((r) => r.scenarioId === s.id && r.state !== "running");
            const failed = last.filter((r) => r.state === "failed");
            return (
              <li key={s.id}>
                <div className="scenario-main" onDoubleClick={() => onEdit(s)}>
                  <div className="scenario-name">{s.name}</div>
                  <div className="muted">
                    шагов: {s.steps.length} · {s.repeat === 0 ? "∞ повторов" : `повторов: ${s.repeat}`}
                    {last.length > 0 && (
                      <span className={failed.length ? "fail" : "ok"}>
                        {" "}
                        · {failed.length ? `ошибок: ${failed.length}` : RUN_STATE[last[0]!.state]}
                      </span>
                    )}
                  </div>
                  {failed[0]?.error && <div className="fail small">{failed[0].error}</div>}
                </div>
                <div className="scenario-actions">
                  <button
                    className="btn primary"
                    disabled={targets.length === 0 || s.steps.length === 0}
                    title={`Запустить на ${targets.length} устр.`}
                    onClick={() => act(() => window.farm.scenarios.run(s.id, targets))}
                  >
                    ▶ {targets.length}
                  </button>
                  <button className="icon-btn" title="Редактировать" onClick={() => onEdit(s)}>
                    ✎
                  </button>
                  <button
                    className="icon-btn"
                    title="Дублировать"
                    onClick={() => act(async () => setScenarios(await window.farm.scenarios.save({ ...s, id: crypto.randomUUID(), name: `${s.name} (копия)` })))}
                  >
                    ⧉
                  </button>
                  <button className="icon-btn" title="Экспорт в файл" onClick={() => act(() => window.farm.scenarios.exportFile(s.id))}>
                    ⇩
                  </button>
                  <button
                    className="icon-btn"
                    title="Удалить"
                    onClick={() => {
                      if (confirm(`Удалить сценарий «${s.name}»?`)) void act(async () => setScenarios(await window.farm.scenarios.remove(s.id)));
                    }}
                  >
                    ✕
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        {notice && <p className="hint">{notice}</p>}
        {error && <p className="hint error">{error}</p>}
      </section>
    </div>
  );
}

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
