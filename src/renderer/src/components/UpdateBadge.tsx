import { useEffect, useState } from "react";
import type { UpdateStatus } from "@shared/types";
import { errorText } from "../errors";
import { useT } from "../settings";

export function UpdateBadge() {
  const t = useT();
  const [status, setStatus] = useState<UpdateStatus>();
  const [installError, setInstallError] = useState<string>();

  useEffect(() => {
    void window.farm.updates.status().then(setStatus);
    return window.farm.updates.onStatus(setStatus);
  }, []);

  if (!status) return null;

  const hint =
    status.state === "checking"
      ? t("upd.checking")
      : status.state === "latest"
        ? t("upd.latest")
        : (status.error ?? t("upd.check"));
  const busy = status.state === "checking" || status.state === "downloading" || status.state === "ready";
  const version = status.latest ?? "";
  const install = () => {
    setInstallError(undefined);
    window.farm.updates.install().catch((e) => setInstallError(errorText(e)));
  };

  return (
    <div className="update">
      <button
        className={`version${status.state === "error" ? " failed" : ""}`}
        title={`${hint}\n${t("upd.clickToCheck")}`}
        disabled={busy}
        onClick={() => void window.farm.updates.check()}
      >
        v{status.current}
        {status.state === "checking" && "…"}
      </button>
      {status.state === "available" && !status.canInstall && status.url && (
        <a className="update-pill" href={status.url} target="_blank" rel="noreferrer" title={status.error ?? t("upd.openRelease")}>
          {t("upd.available", { version })}
        </a>
      )}
      {status.state === "available" && status.canInstall && (
        <button className="update-pill" onClick={() => void window.farm.updates.download()} title={t("upd.updateHint")}>
          {t("upd.update", { version })}
        </button>
      )}
      {status.state === "downloading" && (
        <span className="update-pill muted">{t("upd.downloading", { percent: Math.round((status.progress ?? 0) * 100) })}</span>
      )}
      {status.state === "ready" && (
        <button className="update-pill ready" onClick={install} title={installError ?? t("upd.restartHint")}>
          {t("upd.restart", { version })}
        </button>
      )}
    </div>
  );
}
