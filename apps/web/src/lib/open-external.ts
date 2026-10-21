/**
 * Open a URL in the candidate's own browser, outside the exam shell.
 *
 * Shared because the update prompt is reachable from more than one screen.
 * `window.open` inside a locked-down webview either does nothing or
 * navigates the shell itself, so the native command is tried first; the
 * fallback is for the browser dev build, where there is no native layer.
 */

type TauriLike = { core?: { invoke: (cmd: string, args: unknown) => Promise<unknown> } };

export function openExternal(url: string): void {
  const tauri = (window as unknown as { __TAURI__?: TauriLike }).__TAURI__;
  if (tauri?.core?.invoke) {
    void tauri.core.invoke("open_external_url", { url }).catch(() => {
      window.open(url, "_blank", "noopener,noreferrer");
    });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
