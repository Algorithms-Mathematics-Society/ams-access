type SetupWindow = {
  setFullscreen(value: boolean): Promise<void>;
  setSimpleFullscreen(value: boolean): Promise<void>;
  setAlwaysOnTop(value: boolean): Promise<void>;
  setDecorations(value: boolean): Promise<void>;
  isFullscreen(): Promise<boolean>;
};

let pendingFullscreenWork = 0;
export function hasPendingFullscreenWork(): boolean {
  return pendingFullscreenWork > 0;
}

/** Serialize acquisition and rollback so a late fullscreen grant cannot undo a
 * newer setup. Cancellation is local; native promises retain ownership. */
export function createFullscreenLifecycle() {
  let pending: Promise<void> = Promise.resolve();
  return function start(options: {
    getWindow: () => Promise<SetupWindow | null>;
    isMacos: () => Promise<boolean>;
    ready: (win: SetupWindow | null, macos: boolean) => Promise<void>;
  }) {
    let cancelled = false;
    pendingFullscreenWork += 1;
    const operation = pending.then(async () => {
      if (cancelled) return;
      const win = await options.getWindow();
      if (cancelled) return;
      const macos = await options.isMacos();
      if (cancelled) return;
      const acquired: Array<() => Promise<void>> = [];
      try {
        if (win) {
          const changes: Array<[() => Promise<void>, () => Promise<void>]> = [
            [
              () => (macos ? win.setSimpleFullscreen(true) : win.setFullscreen(true)),
              () => (macos ? win.setSimpleFullscreen(false) : win.setFullscreen(false)),
            ],
            [() => win.setAlwaysOnTop(true), () => win.setAlwaysOnTop(false)],
            [() => win.setDecorations(false), () => win.setDecorations(true)],
          ];
          for (const [apply, restore] of changes) {
            if (cancelled) break;
            // Rejected calls may have partially changed native state as well.
            acquired.push(restore);
            await apply().catch(() => {});
          }
        }
        if (!cancelled) await options.ready(win, macos);
      } finally {
        if (cancelled) {
          for (const restore of acquired.reverse()) await restore().catch(() => {});
        }
      }
    });
    pending = operation
      .catch(() => {})
      .finally(() => {
        pendingFullscreenWork -= 1;
      });
    return {
      cancel() {
        cancelled = true;
      },
      settled: pending,
    };
  };
}
