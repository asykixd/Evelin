import { locale } from "@shared/i18n";
import type { DeviceResult } from "@shared/types";
import { useT } from "../settings";

export interface LogEntry {
  id: string;
  time: Date;
  title: string;
  results: (DeviceResult & { name: string })[];
}

export function LogPanel({ entries, onClear }: { entries: LogEntry[]; onClear: () => void }) {
  const t = useT();
  return (
    <section className="log">
      <header className="log-header">
        <h3>{t("log.title")}</h3>
        {entries.length > 0 && (
          <button className="link" onClick={onClear}>
            {t("log.clear")}
          </button>
        )}
      </header>
      <div className="log-body">
        {entries.length === 0 && <p className="muted">{t("log.empty")}</p>}
        {entries.map((e) => {
          const ok = e.results.filter((r) => r.success).length;
          return (
            <details key={e.id} className="log-entry" open={ok !== e.results.length}>
              <summary>
                <span className="muted">{e.time.toLocaleTimeString(locale())}</span> {e.title}{" "}
                <span className={ok === e.results.length ? "ok" : "fail"}>
                  {ok}/{e.results.length}
                </span>
              </summary>
              {e.results.map((r) => (
                <div key={r.serial} className={`log-result ${r.success ? "ok" : "fail"}`}>
                  <div className="log-device">{r.name}</div>
                  {(r.output || r.error) && <pre>{r.success ? r.output : r.error}</pre>}
                </div>
              ))}
            </details>
          );
        })}
      </div>
    </section>
  );
}
