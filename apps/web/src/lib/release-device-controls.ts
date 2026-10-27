import type { RestoreStatus } from "@ams/api-client";

export type ReleaseStep = {
  id: string;
  label: string;
  state: "confirmed" | "failed" | "unknown";
};
export type LocalReleaseResult = {
  outcome: "confirmed" | "partial" | "unknown" | "browser";
  steps: ReleaseStep[];
  restoreStatus: RestoreStatus | null;
};
type NativeBridge = NonNullable<Window["__TAURI__"]>;

/** Each deadline bounds presentation only; it never cancels a native command. */
export function createDeviceRelease(getBridge: () => NativeBridge | undefined, stepMs = 1000) {
  let active: Promise<LocalReleaseResult> | null = null;
  return function release(): Promise<LocalReleaseResult> {
    if (active) return active;
    const outstanding: Promise<unknown>[] = [];
    const run = async (): Promise<LocalReleaseResult> => {
      const bridge = getBridge();
      if (!bridge) return { outcome: "browser", steps: [], restoreStatus: null };
      const steps: ReleaseStep[] = [];
      async function attempt<T>(
        id: string,
        label: string,
        work: () => Promise<T>
      ): Promise<T | undefined> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const native = Promise.resolve().then(work);
        // Retain even timed-out work so Retry cannot issue conflicting duplicate calls.
        outstanding.push(native.catch(() => undefined));
        const result = await Promise.race([
          native.then(
            (value) => ({ state: "confirmed" as const, value }),
            () => ({ state: "failed" as const })
          ),
          new Promise<{ state: "unknown" }>((resolve) => {
            timer = setTimeout(() => resolve({ state: "unknown" }), stepMs);
          }),
        ]);
        clearTimeout(timer);
        steps.push({ id, label, state: result.state });
        return "value" in result ? result.value : undefined;
      }
      // Platform is needed because simple fullscreen is macOS-only. Failure to
      // identify it is not a passed check; still attempt its independent release.
      const platform = await attempt("platform", "Platform verification", () =>
        bridge.core.invoke<{ os: string }>("get_platform")
      );
      if (!platform || !["windows", "linux", "macos"].includes(platform.os)) {
        steps[steps.length - 1].state = "unknown";
      }
      const win = () => bridge.window.getCurrentWindow();
      await attempt("fullscreen", "Fullscreen", () => win().setFullscreen(false));
      if (
        !platform ||
        !["windows", "linux", "macos"].includes(platform.os) ||
        platform.os === "macos"
      ) {
        await attempt("simple-fullscreen", "macOS fullscreen", () =>
          win().setSimpleFullscreen(false)
        );
      }
      await attempt("topmost", "Window priority", () => win().setAlwaysOnTop(false));
      await attempt("decorations", "Window controls", () => win().setDecorations(true));
      await attempt("desktop", "Desktop settings", () => bridge.core.invoke("unlock_desktop"));
      await attempt("keyboard", "Keyboard controls", () =>
        bridge.core.invoke("disable_keyboard_intercept")
      );
      await attempt("network", "Network restrictions", () =>
        bridge.core.invoke("disable_network_lockdown")
      );
      const status = await attempt("verification", "Restoration verification", () =>
        bridge.core.invoke<RestoreStatus>("get_lockdown_restore_status")
      );
      const validStatus =
        status &&
        typeof status.pending === "boolean" &&
        Array.isArray(status.items) &&
        status.items.every(
          (item) => item && typeof item.label === "string" && typeof item.fix_command === "string"
        );
      const restoreStatus = validStatus ? status : null;
      if (!restoreStatus) steps[steps.length - 1].state = "unknown";
      const incomplete =
        steps.some((step) => step.state !== "confirmed") || !restoreStatus || restoreStatus.pending;
      return {
        outcome: !incomplete
          ? "confirmed"
          : steps.some((step) => step.state === "failed") || restoreStatus?.pending
            ? "partial"
            : "unknown",
        steps,
        restoreStatus,
      };
    };
    const current = run();
    active = current;
    // A timeout returns an actionable unknown result while the native work stays
    // owned. Clear only once every native operation has really settled.
    void current.then(
      async () => {
        await Promise.all(outstanding);
        if (active === current) active = null;
      },
      () => {
        if (active === current) active = null;
      }
    );
    return current;
  };
}

const releaseNative = createDeviceRelease(() =>
  typeof window === "undefined" ? undefined : window.__TAURI__
);
let lastRelease: LocalReleaseResult | null = null;
export function getLastReleaseResult(): LocalReleaseResult | null {
  return lastRelease;
}
export async function releaseDeviceControls(): Promise<LocalReleaseResult> {
  const result = await releaseNative();
  lastRelease = result;
  return result;
}

/** Desktop verification does not cover network or window failures. */
export function releaseRestoreStatus(result: LocalReleaseResult): RestoreStatus | null {
  if (result.outcome === "confirmed" || result.outcome === "browser") return null;
  return {
    pending: true,
    items: [
      ...(result.restoreStatus?.items ?? []),
      ...result.steps
        .filter((step) => step.state !== "confirmed")
        .map((step) => ({
          label: `${step.label}: ${step.state === "failed" ? "could not be restored" : "not verified"}`,
          fix_command: "",
        })),
    ],
  };
}
