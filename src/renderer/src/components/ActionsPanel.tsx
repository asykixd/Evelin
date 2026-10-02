import { useState, type FormEvent } from "react";
import { keyLabel } from "@shared/scenario";
import type { DeviceResult, NavKey } from "@shared/types";
import { useSettings, useT } from "../settings";

interface Props {
  targets: string[];
  run: (title: string, action: (serials: string[]) => Promise<DeviceResult[]>) => Promise<void>;
}

const NAV: NavKey[] = ["back", "home", "recents", "power", "volume_up", "volume_down"];

export function ActionsPanel({ targets, run }: Props) {
  const t = useT();
  const { settings } = useSettings();
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
        <h3>{t("actions.keys")}</h3>
        <div className="btn-grid">
          {NAV.map((key) => (
            <button key={key} className="btn" disabled={targets.length === 0} onClick={() => window.farm.control.key(targets, key)}>
              {key === "volume_up" || key === "volume_down" ? t(`keyShort.${key}`) : keyLabel(key)}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3>{t("actions.text")}</h3>
        <form
          className="row"
          onSubmit={submit(() => {
            if (!text) return;
            window.farm.control.text(targets, text);
            setText("");
          })}
        >
          <input className="input" placeholder={t("actions.textPlaceholder")} value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn" disabled={targets.length === 0 || !text}>
            {t("actions.type")}
          </button>
        </form>
      </section>

      <section>
        <h3>{t("actions.apps")}</h3>
        <form className="row" onSubmit={submit(() => pkg && void exec("launch", t("actions.launchTitle", { pkg }), (s) => window.farm.batch.launchApp(s, pkg)))}>
          <input className="input" placeholder="com.example.app" value={pkg} onChange={(e) => setPkg(e.target.value.trim())} />
          <button className="btn" disabled={disabled || !pkg}>
            {busy === "launch" ? "…" : t("actions.launch")}
          </button>
        </form>
        <button className="btn wide" disabled={disabled} onClick={() => exec("install", t("actions.installTitle"), window.farm.batch.installApk)}>
          {busy === "install" ? t("actions.installing") : t("actions.install")}
        </button>
      </section>

      <section>
        <h3>{t("actions.device")}</h3>
        <div className="btn-grid">
          <button className="btn" disabled={disabled} onClick={() => exec("wake", t("actions.wake"), window.farm.batch.wake)}>
            {t("actions.wake")}
          </button>
          <button className="btn" disabled={disabled} onClick={() => exec("shot", t("actions.screenshotsTitle"), window.farm.batch.screenshot)}>
            {busy === "shot" ? "…" : t("actions.screenshots")}
          </button>
          <button
            className="btn danger"
            disabled={disabled}
            onClick={() => {
              if (!settings.confirmDanger || confirm(t("actions.rebootConfirm", { n: targets.length })))
                void exec("reboot", t("actions.rebootTitle"), window.farm.batch.reboot);
            }}
          >
            {t("actions.reboot")}
          </button>
        </div>
      </section>

      <section>
        <h3>ADB shell</h3>
        <form className="col" onSubmit={submit(() => command.trim() && void exec("shell", `$ ${command}`, (s) => window.farm.batch.shell(s, command)))}>
          <input className="input mono" placeholder="getprop ro.product.model" value={command} onChange={(e) => setCommand(e.target.value)} />
          <button className="btn wide" disabled={disabled || !command.trim()}>
            {busy === "shell" ? t("actions.running") : t("actions.run")}
          </button>
        </form>
      </section>
    </div>
  );
}
