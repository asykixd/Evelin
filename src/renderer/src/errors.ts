/** Ошибки из ipcRenderer.invoke приходят с префиксом "Error invoking remote method '…': Error: " — убираем его. */
export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, "");
}
