/**
 * Leave for home with everything lockdown or setup changed put back.
 *
 * Shared because a candidate can be stranded on more than one screen: an
 * error page reached mid-setup still has the window fullscreen and the
 * keyboard and network locked. Settings that could not be restored are
 * listed, with their fixes, by the restore card in Settings;
 * ?restore=pending opens it.
 */
import type { RestoreStatus } from "@ams/api-client";

const STEP_TIMEOUT_MS = 10_000;

/** The promise's value, or `fallback` when it fails or outlasts the timeout. */
function within<T>(promise: Promise<T>, fallback: T): Promise<T> {
  // A native call stuck behind the lockdown mutex must not trap the candidate
  // on the very button meant to get them out.
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), STEP_TIMEOUT_MS)),
  ]);
}

const ok = (promise: Promise<unknown>) =>
  within(
    promise.then(() => true),
    false
  );

export async function exitToHome(
  router: { push: (href: string) => void },
  destination = "/home"
): Promise<void> {
  const tauri = window.__TAURI__;
  if (!tauri) {
    router.push(destination);
    return;
  }

  const win = tauri.window.getCurrentWindow();
  await ok(win.setFullscreen(false));
  // macOS onboarding covers the screen with simple full-screen, which
  // setFullscreen(false) does not leave.
  await ok(win.setSimpleFullscreen(false));
  await ok(win.setAlwaysOnTop(false));
  await ok(win.setDecorations(true));

  const desktop = await ok(tauri.core.invoke("unlock_desktop"));
  await ok(tauri.core.invoke("disable_keyboard_intercept"));
  // The macOS restore status does not cover the pf firewall, so a failed
  // network release has to send the candidate to Restore on its own.
  const network = await ok(tauri.core.invoke("disable_network_lockdown"));
  const status = await within<RestoreStatus | null>(
    tauri.core.invoke<RestoreStatus>("get_lockdown_restore_status"),
    null
  );
  const pending = !desktop || !network || !status || status.pending;
  router.push(pending ? "/home?restore=pending" : destination);
}
