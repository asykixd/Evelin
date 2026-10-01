import { useEffect, useState } from "react";
import type { DeviceResult, ProxyState } from "@shared/types";

interface Props {
  targets: string[];
  run: (title: string, action: (serials: string[]) => Promise<DeviceResult[]>) => Promise<void>;
}

export function ProxyPanel({ targets, run }: Props) {
  const [state, setState] = useState<ProxyState | undefined>();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.farm.proxy.state().then(setState);
  }, []);

  async function guard(fn: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
        <h3>На устройствах</h3>
        <p className="hint">
          Прокси раздаются по кругу: сначала CyberYozh, затем из файла. Используется системный HTTP-прокси Android
          (<code>settings global http_proxy</code>) — авторизация и SOCKS им не поддерживаются.
        </p>
        <div className="btn-grid">
          <button className="btn primary" disabled={disabled || !state?.proxies.length} onClick={() => guard(() => run("Назначить прокси", window.farm.proxy.assign))}>
            Назначить
          </button>
          <button className="btn" disabled={disabled} onClick={() => guard(() => run("Сбросить прокси", window.farm.proxy.clear))}>
            Сбросить
          </button>
          <button className="btn" disabled={disabled} onClick={() => guard(() => run("Проверка IP", window.farm.proxy.test))}>
            Проверить IP
          </button>
        </div>
      </section>

      <section>
        <h3>Список прокси</h3>
        <div className="stat-row">
          <span>
            Из файла: <b>{fileCount}</b>
          </span>
          <span>
            CyberYozh: <b>{yozhCount}</b>
          </span>
        </div>
        <div className="btn-grid">
          <button className="btn" disabled={busy} onClick={() => guard(async () => setState(await window.farm.proxy.importFile()))}>
            Импорт из файла…
          </button>
          <button
            className="btn"
            disabled={busy || fileCount === 0}
            onClick={() => {
              if (confirm("Удалить все прокси, загруженные из файла?")) void guard(async () => setState(await window.farm.proxy.clearFileProxies()));
            }}
          >
            Очистить
          </button>
        </div>
        <p className="hint">
          Формат строк: <code>type://host:port[:login[:password]]</code>, строки с <code>#</code> — комментарии.
        </p>
        {state && state.proxies.length > 0 && (
          <ul className="proxy-list">
            {state.proxies.slice(0, 50).map((p, i) => (
              <li key={`${p.source}-${p.host}-${p.port}-${i}`}>
                <span className={`badge ${p.source === "cyberyozh" ? "badge-yozh" : ""}`}>{p.type}</span>
                <span className="mono">
                  {p.host}:{p.port}
                </span>
                {p.login && (
                  <span className="muted" title="С авторизацией">
                    🔒
                  </span>
                )}
              </li>
            ))}
            {state.proxies.length > 50 && <li className="muted">…и ещё {state.proxies.length - 50}</li>}
          </ul>
        )}
      </section>

      <section>
        <h3>CyberYozh</h3>
        {state && !state.encryptionAvailable && <p className="hint error">Шифрование ОС недоступно — токен и прокси не будут сохранены.</p>}
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void guard(async () => {
              setState(await window.farm.proxy.setCyberyozhToken(token));
              setToken("");
            });
          }}
        >
          <input
            className="input"
            type="password"
            autoComplete="off"
            placeholder={state?.hasCyberyozhToken ? "Токен сохранён (введите новый)" : "API-токен"}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <button className="btn" disabled={busy || (!token && !state?.hasCyberyozhToken)}>
            {token || !state?.hasCyberyozhToken ? "Сохранить" : "Удалить"}
          </button>
        </form>
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
          Обновить список CyberYozh
        </button>
        {error && <p className="hint error">{error}</p>}
      </section>
    </div>
  );
}
