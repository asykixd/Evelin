import { useState, type FormEvent } from "react";
import type { DeviceResult, NavKey } from "@shared/types";

interface Props {
  targets: string[];
  run: (title: string, action: (serials: string[]) => Promise<DeviceResult[]>) => Promise<void>;
}

const NAV: { key: NavKey; label: string }[] = [
  { key: "back", label: "Назад" },
  { key: "home", label: "Домой" },
  { key: "recents", label: "Недавние" },
  { key: "power", label: "Питание" },
  { key: "volume_up", label: "Громк. +" },
  { key: "volume_down", label: "Громк. −" },
];

export function ActionsPanel({ targets, run }: Props) {
  const [command, setCommand] = useState("");
  const [pkg, setPkg] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | undefined>();
  const disabled = targets.length === 0 || busy !== undefined;

  async function exec(id: string, title: string, action: (serials: string[]) => Promise<DeviceResult[]>) {
    setBusy(id);
    try {
      await run(title, action);
    } finally {
      setBusy(undefined);
    }
  }

  function submit(handler: () => void) {
    return (e: FormEvent) => {
      e.preventDefault();
      handler();
    };
  }

  return (
    <div className="panel">
      <section>
        <h3>Кнопки</h3>
        <div className="btn-grid">
          {NAV.map((n) => (
            <button key={n.key} className="btn" disabled={targets.length === 0} onClick={() => window.farm.control.key(targets, n.key)}>
              {n.label}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3>Ввод текста</h3>
        <form
          className="row"
          onSubmit={submit(() => {
            if (!text) return;
            window.farm.control.text(targets, text);
            setText("");
          })}
        >
          <input className="input" placeholder="Текст в активное поле" value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn" disabled={targets.length === 0 || !text}>
            Ввести
          </button>
        </form>
      </section>

      <section>
        <h3>Приложения</h3>
        <form className="row" onSubmit={submit(() => pkg && void exec("launch", `Запуск ${pkg}`, (s) => window.farm.batch.launchApp(s, pkg)))}>
          <input className="input" placeholder="com.example.app" value={pkg} onChange={(e) => setPkg(e.target.value.trim())} />
          <button className="btn" disabled={disabled || !pkg}>
            {busy === "launch" ? "…" : "Запустить"}
          </button>
        </form>
        <button className="btn wide" disabled={disabled} onClick={() => exec("install", "Установка APK", window.farm.batch.installApk)}>
          {busy === "install" ? "Установка…" : "Установить APK…"}
        </button>
      </section>

      <section>
        <h3>Устройство</h3>
        <div className="btn-grid">
          <button className="btn" disabled={disabled} onClick={() => exec("wake", "Разбудить", window.farm.batch.wake)}>
            Разбудить
          </button>
          <button className="btn" disabled={disabled} onClick={() => exec("shot", "Скриншоты", window.farm.batch.screenshot)}>
            {busy === "shot" ? "…" : "Скриншоты…"}
          </button>
          <button
            className="btn danger"
            disabled={disabled}
            onClick={() => {
              if (confirm(`Перезагрузить устройств: ${targets.length}?`)) void exec("reboot", "Перезагрузка", window.farm.batch.reboot);
            }}
          >
            Перезагрузить
          </button>
        </div>
      </section>

      <section>
        <h3>ADB shell</h3>
        <form className="col" onSubmit={submit(() => command.trim() && void exec("shell", `$ ${command}`, (s) => window.farm.batch.shell(s, command)))}>
          <input className="input mono" placeholder="getprop ro.product.model" value={command} onChange={(e) => setCommand(e.target.value)} />
          <button className="btn wide" disabled={disabled || !command.trim()}>
            {busy === "shell" ? "Выполняется…" : "Выполнить"}
          </button>
        </form>
      </section>
    </div>
  );
}
