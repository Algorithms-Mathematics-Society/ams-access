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

  let releaseFailed = false;
  const attempt = async (release: () => Promise<unknown>) => {
    try {
      await release();
    } catch {
      releaseFailed = true;
    }
  };

  try {
    const win = tauri.window.getCurrentWindow();
    await attempt(() => win.setFullscreen(false));
    // macOS onboarding covers the screen with simple full-screen, which
    // setFullscreen(false) does not leave.
    await attempt(() => win.setSimpleFullscreen(false));
    await attempt(() => win.setAlwaysOnTop(false));
    await attempt(() => win.setDecorations(true));
  } catch {
    releaseFailed = true;
  }

  await attempt(() => tauri.core.invoke("unlock_desktop"));
  await attempt(() => tauri.core.invoke("disable_keyboard_intercept"));
  await attempt(() => tauri.core.invoke("disable_network_lockdown"));

  let remaining: RestoreStatus | null = null;
  try {
    remaining = await tauri.core.invoke<RestoreStatus>("get_lockdown_restore_status");
  } catch {
    // An unavailable status cannot confirm that the machine was restored.
  }
  router.push(
    releaseFailed || remaining?.pending !== false ? "/home?restore=pending" : destination
  );
}
