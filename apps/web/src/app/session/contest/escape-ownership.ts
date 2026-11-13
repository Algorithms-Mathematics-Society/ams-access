// The native keyboard hook consumes bare Escape unless an in-app control owns it.
// Serialize writes so an editor blur/teardown cannot re-block an open popover.
let editorFocused = false;
const ordinaryOwners = new Set<symbol>();
let nativeWrite = Promise.resolve();

function syncNativeEscape() {
  nativeWrite = nativeWrite.then(async () => {
    const blocked = !editorFocused && ordinaryOwners.size === 0;
    type TauriGlobal = {
      core: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
    };
    const tauri = (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;
    await tauri?.core.invoke("set_escape_blocked", { blocked });
  }).catch(() => {});
}

export function setEditorEscapeFocused(focused: boolean) {
  editorFocused = focused;
  syncNativeEscape();
}

export function acquireOrdinaryEscape(): () => void {
  const owner = Symbol("ordinary Escape owner");
  ordinaryOwners.add(owner);
  syncNativeEscape();
  return () => {
    if (!ordinaryOwners.delete(owner)) return;
    syncNativeEscape();
  };
}
