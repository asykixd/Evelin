/** Strips Electron's "Error invoking remote method '…': Error: " prefix. */
export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, "");
}
