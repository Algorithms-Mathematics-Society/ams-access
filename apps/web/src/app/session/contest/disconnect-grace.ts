/** Local presentation delay only: never probes the network or changes an attempt. */
export const DISCONNECT_GRACE_MS = 12_000;
export function startDisconnectGrace(interrupted: boolean, show: (visible: boolean) => void) {
  show(false);
  if (!interrupted) return () => {};
  const timer = setTimeout(() => show(true), DISCONNECT_GRACE_MS);
  return () => clearTimeout(timer);
}
