import { useEffect, useState, type ReactNode } from "react";
import { describeStep, keyLabel, newStep, NAV_KEYS, stepLabel } from "@shared/scenario";
import type { NavKey, Scenario, Step, StepType } from "@shared/types";
import { errorText } from "../errors";
import { useT } from "../settings";

interface Props {
  scenario: Scenario;
  scenarios: Scenario[];
  onSaved: (list: Scenario[]) => void;
  onClose: () => void;
}

const ADDABLE: StepType[] = [
  "tap",
  "swipe",
  "key",
  "text",
  "wait",
  "launchApp",
  "stopApp",
  "clearAppData",
  "proxyNext",
  "proxyClear",
  "shell",
  "runScenario",
];

export function ScenarioEditor({ scenario, scenarios, onSaved, onClose }: Props) {
  const t = useT();
  const [draft, setDraft] = useState<Scenario>(scenario);
  const [addType, setAddType] = useState<StepType>("tap");
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const dirty = draft !== scenario;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function close() {
    if (!dirty || confirm(t("editor.closeConfirm"))) onClose();
  }

  const patch = (p: Partial<Scenario>) => setDraft((d) => ({ ...d, ...p }));
  const setSteps = (fn: (steps: Step[]) => Step[]) => setDraft((d) => ({ ...d, steps: fn(d.steps) }));
  const updateStep = (id: string, p: Partial<Step>) => setSteps((steps) => steps.map((s) => (s.id === id ? ({ ...s, ...p } as Step) : s)));
  const move = (i: number, delta: number) =>
    setSteps((steps) => {
      const j = i + delta;
      if (j < 0 || j >= steps.length) return steps;
      const next = [...steps];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  async function save() {
    setSaving(true);
    setError(undefined);
    try {
      onSaved(await window.farm.scenarios.save({ ...draft, updatedAt: Date.now() }));
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  const nestable = scenarios.filter((s) => s.id !== draft.id);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal">
        <header className="modal-header">
          <input className="input title-input" value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder={t("editor.name")} />
          <button className="icon-btn" onClick={close} title={t("common.close")}>
            ✕
          </button>
        </header>

        <div className="modal-settings">
          <Field label={t("editor.repeat")} hint={t("editor.repeatHint")}>
            <input className="input num" type="number" min={0} value={draft.repeat} onChange={(e) => patch({ repeat: Math.max(0, int(e.target.value)) })} />
          </Field>
          <Field label={t("editor.pause")}>
            <input className="input num" type="number" min={0} step={500} value={draft.pauseMs} onChange={(e) => patch({ pauseMs: Math.max(0, int(e.target.value)) })} />
          </Field>
          <label className="check">
            <input type="checkbox" checked={draft.continueOnError} onChange={(e) => patch({ continueOnError: e.target.checked })} />
            {t("editor.continueOnError")}
          </label>
        </div>

        <div className="steps">
          {draft.steps.length === 0 && <p className="hint pad">{t("editor.noSteps")}</p>}
          {draft.steps.map((step, i) => (
            <div key={step.id} className={`step${step.enabled ? "" : " disabled"}`}>
              <div className="step-index">{i + 1}</div>
              <input type="checkbox" title={t("editor.enabled")} checked={step.enabled} onChange={(e) => updateStep(step.id, { enabled: e.target.checked })} />
              <div className="step-body">
                <div className="step-title">
                  <span className={`step-type t-${step.type}`}>{stepLabel(step.type)}</span>
                  <span className="muted">{describeStep(step, scenarios)}</span>
                </div>
                <StepParams step={step} scenarios={nestable} update={(p) => updateStep(step.id, p)} />
              </div>
              <label className="every" title={t("editor.everyHint")}>
                {t("editor.everyBefore")}
                <input
                  className="input num tiny"
                  type="number"
                  min={1}
                  value={step.everyNth ?? 1}
                  onChange={(e) => updateStep(step.id, { everyNth: Math.max(1, int(e.target.value)) })}
                />
                {t("editor.everyAfter")}
              </label>
              <div className="step-actions">
                <button className="icon-btn" title={t("editor.up")} disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button className="icon-btn" title={t("editor.down")} disabled={i === draft.steps.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </button>
                <button className="icon-btn" title={t("common.duplicate")} onClick={() => setSteps((s) => [...s.slice(0, i + 1), { ...step, id: crypto.randomUUID() }, ...s.slice(i + 1)])}>
                  ⧉
                </button>
                <button className="icon-btn" title={t("common.delete")} onClick={() => setSteps((s) => s.filter((x) => x.id !== step.id))}>
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>

        <footer className="modal-footer">
          <div className="row-tight">
            <select className="input" value={addType} onChange={(e) => setAddType(e.target.value as StepType)}>
              {ADDABLE.map((type) => (
                <option key={type} value={type}>
                  {stepLabel(type)}
                </option>
              ))}
            </select>
            <button className="btn" onClick={() => setSteps((s) => [...s, newStep(addType)])}>
              {t("editor.addStep")}
            </button>
          </div>
          <div className="row-tight">
            {error && <span className="fail small">{error}</span>}
            <button className="btn" onClick={close}>
              {t("common.cancel")}
            </button>
            <button className="btn primary" disabled={saving} onClick={save}>
              {t("common.save")}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function StepParams({ step, scenarios, update }: { step: Step; scenarios: Scenario[]; update: (p: Partial<Step>) => void }) {
  const t = useT();
  switch (step.type) {
    case "tap":
      return (
        <div className="params">
          <Pct label="X" value={step.x} onChange={(x) => update({ x })} />
          <Pct label="Y" value={step.y} onChange={(y) => update({ y })} />
        </div>
      );
    case "swipe":
      return (
        <div className="params">
          <Pct label="X1" value={step.x1} onChange={(x1) => update({ x1 })} />
          <Pct label="Y1" value={step.y1} onChange={(y1) => update({ y1 })} />
          <Pct label="X2" value={step.x2} onChange={(x2) => update({ x2 })} />
          <Pct label="Y2" value={step.y2} onChange={(y2) => update({ y2 })} />
          <Num label={t("editor.ms")} value={step.duration} min={10} onChange={(duration) => update({ duration })} />
        </div>
      );
    case "key":
      return (
        <div className="params">
          <select className="input" value={step.key} onChange={(e) => update({ key: e.target.value as NavKey })}>
            {NAV_KEYS.map((k) => (
              <option key={k} value={k}>
                {keyLabel(k)}
              </option>
            ))}
          </select>
        </div>
      );
    case "text":
      return (
        <div className="params">
          <input className="input" value={step.text} placeholder={t("editor.text")} onChange={(e) => update({ text: e.target.value })} />
        </div>
      );
    case "wait":
      return (
        <div className="params">
          <Num label={t("editor.fromMs")} value={step.ms} onChange={(ms) => update({ ms })} />
          <Num label={t("editor.toMs")} value={step.maxMs ?? 0} onChange={(maxMs) => update({ maxMs: maxMs || undefined })} hint={t("editor.noRandom")} />
        </div>
      );
    case "launchApp":
    case "stopApp":
    case "clearAppData":
      return (
        <div className="params">
          <input className="input mono" value={step.package} placeholder="com.example.app" onChange={(e) => update({ package: e.target.value.trim() })} />
        </div>
      );
    case "shell":
      return (
        <div className="params">
          <input className="input mono" value={step.command} placeholder="input keyevent KEYCODE_WAKEUP" onChange={(e) => update({ command: e.target.value })} />
        </div>
      );
    case "runScenario":
      return (
        <div className="params">
          <select className="input" value={step.scenarioId} onChange={(e) => update({ scenarioId: e.target.value })}>
            <option value="">{t("editor.pickScenario")}</option>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      );
    case "gesture":
    case "proxyNext":
    case "proxyClear":
      return null;
  }
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field" title={hint}>
      <span className="muted">{label}</span>
      {children}
    </label>
  );
}

function Pct({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="param">
      {label}
      <input
        className="input num tiny"
        type="number"
        min={0}
        max={100}
        step={0.5}
        value={Math.round(value * 1000) / 10}
        onChange={(e) => onChange(Math.min(1, Math.max(0, Number(e.target.value) / 100)))}
      />
      %
    </label>
  );
}

function Num({ label, value, min = 0, hint, onChange }: { label: string; value: number; min?: number; hint?: string; onChange: (v: number) => void }) {
  return (
    <label className="param" title={hint}>
      {label}
      <input className="input num" type="number" min={min} step={50} value={value} onChange={(e) => onChange(Math.max(min, int(e.target.value)))} />
    </label>
  );
}

function int(v: string): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : 0;
}
