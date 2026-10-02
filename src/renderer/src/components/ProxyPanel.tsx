import { useEffect, useState } from "react";
import type { DeviceResult, ProxyState } from "@shared/types";
import { errorText } from "../errors";
import { useSettings, useT } from "../settings";

interface Props {
  targets: string[];
  run: (title: string, action: (serials: string[]) => Promise<DeviceResult[]>) => Promise<void>;
  onOpenSettings: () => void;
}

export function ProxyPanel({ targets, run, onOpenSettings }: Props) {
  const t = useT();
  const { settings } = useSettings();
  const [state, setState] = useState<ProxyState | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.farm.proxy.state().then(setState);
    return window.farm.proxy.onChange(setState);
  }, []);

  async function guard(fn: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const fileCount = state?.proxies.filter((p) => p.source === "file").length ?? 0;
  const yozhCount = state?.proxies.filter((p) => p.source === "cyberyozh").length ?? 0;
  const disabled = busy || targets.length === 0;

  return (
    <div className="panel">
      <section>
        <h3>{t("proxy.onDevices")}</h3>
        <p className="hint">{withCode(t("proxy.hint"), { setting: "settings global http_proxy" })}</p>
        <div className="btn-grid">
          <button className="btn primary" disabled={disabled || !state?.proxies.length} onClick={() => guard(() => run(t("proxy.assignTitle"), window.farm.proxy.assign))}>
            {t("proxy.assign")}
          </button>
          <button className="btn" disabled={disabled} onClick={() => guard(() => run(t("proxy.clearTitle"), window.farm.proxy.clear))}>
            {t("proxy.clear")}
          </button>
          <button className="btn" disabled={disabled} onClick={() => guard(() => run(t("proxy.testTitle"), window.farm.proxy.test))}>
            {t("proxy.test")}
          </button>
        </div>
      </section>

      <section>
        <h3>{t("proxy.list")}</h3>
        <div className="stat-row">
          <span>
            {t("proxy.fromFile")} <b>{fileCount}</b>
          </span>
          <span>
            CyberYozh: <b>{yozhCount}</b>
          </span>
        </div>
        <div className="btn-grid">
          <button className="btn" disabled={busy} onClick={() => guard(async () => setState(await window.farm.proxy.importFile()))}>
            {t("proxy.import")}
          </button>
          <button
            className="btn"
            disabled={busy || fileCount === 0}
            onClick={() => {
              if (!settings.confirmDanger || confirm(t("proxy.clearFileConfirm")))
                void guard(async () => setState(await window.farm.proxy.clearFileProxies()));
            }}
          >
            {t("common.clear")}
          </button>
        </div>
        <p className="hint">{withCode(t("proxy.format"), { format: "type://host:port[:login[:password]]", hash: "#" })}</p>
        {state && state.proxies.length > 0 && (
          <ul className="proxy-list">
            {state.proxies.slice(0, 50).map((p, i) => (
              <li key={`${p.source}-${p.host}-${p.port}-${i}`}>
                <span className={`badge ${p.source === "cyberyozh" ? "badge-yozh" : ""}`}>{p.type}</span>
                <span className="mono">
                  {p.host}:{p.port}
                </span>
                {p.login && (
                  <span className="muted" title={t("proxy.withAuth")}>
                    🔒
                  </span>
                )}
              </li>
            ))}
            {state.proxies.length > 50 && <li className="muted">{t("proxy.more", { n: state.proxies.length - 50 })}</li>}
          </ul>
        )}
      </section>

      <section>
        <h3>CyberYozh</h3>
        {state && !state.hasCyberyozhToken ? (
          <p className="hint">
            {t("proxy.noToken")}{" "}
            <button className="link" onClick={onOpenSettings}>
              {t("proxy.openSettings")}
            </button>
          </p>
        ) : (
          <button
            className="btn wide"
            disabled={busy || !state?.hasCyberyozhToken}
            onClick={() =>
              guard(async () => {
                const res = await window.farm.proxy.refreshCyberyozh();
                setState(res.state);
                if (res.error) setError(res.error);
              })
            }
          >
            {t("proxy.refreshYozh")}
          </button>
        )}
        {error && <p className="hint error">{error}</p>}
      </section>
    </div>
  );
}

/** Substitutes `{name}` placeholders with <code> fragments. */
function withCode(text: string, parts: Record<string, string>) {
  return text.split(/(\{\w+\})/).map((chunk, i) => {
    const name = /^\{(\w+)\}$/.exec(chunk)?.[1];
    return name && name in parts ? <code key={i}>{parts[name]}</code> : chunk;
  });
}
