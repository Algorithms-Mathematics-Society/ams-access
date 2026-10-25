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
  await win.setFullscreen(false).catch(() => {});
  // macOS onboarding covers the screen with simple full-screen, which
  // setFullscreen(false) does not leave.
  await win.setSimpleFullscreen(false).catch(() => {});
  await win.setAlwaysOnTop(false).catch(() => {});
  await win.setDecorations(true).catch(() => {});

  await tauri.core.invoke("unlock_desktop").catch(() => {});
  await tauri.core.invoke("disable_keyboard_intercept").catch(() => {});
  await tauri.core.invoke("disable_network_lockdown").catch(() => {});

  const remaining = await tauri.core
    .invoke<RestoreStatus>("get_lockdown_restore_status")
    .catch(() => null);
  router.push(remaining?.pending ? "/home?restore=pending" : destination);
}
