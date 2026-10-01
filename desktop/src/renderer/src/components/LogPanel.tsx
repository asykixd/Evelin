import type { DeviceResult } from "@shared/types";

export interface LogEntry {
  id: string;
  time: Date;
  title: string;
  results: (DeviceResult & { name: string })[];
}

export function LogPanel({ entries, onClear }: { entries: LogEntry[]; onClear: () => void }) {
  return (
    <section className="log">
      <header className="log-header">
        <h3>Журнал</h3>
        {entries.length > 0 && (
          <button className="link" onClick={onClear}>
            очистить
          </button>
        )}
      </header>
      <div className="log-body">
        {entries.length === 0 && <p className="muted">Здесь будут результаты операций.</p>}
        {entries.map((e) => {
          const ok = e.results.filter((r) => r.success).length;
          return (
            <details key={e.id} className="log-entry" open={ok !== e.results.length}>
              <summary>
                <span className="muted">{e.time.toLocaleTimeString()}</span> {e.title}{" "}
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
