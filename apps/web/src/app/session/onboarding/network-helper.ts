export type NetworkHelperProgress = {
  phase: "checking" | "installing" | "pass" | "warn";
  message: string;
};

type HelperOptions = {
  invoke: (command: string) => Promise<unknown>;
  signal: AbortSignal;
  onProgress: (progress: NetworkHelperProgress) => void;
};

// This is the native informational worker's admission error, not evidence
// that the daemon is missing. Retry only this known transient failure.
const BUSY = "Device checks are busy. Retry shortly.";
const READY = "Network lockdown helper ready";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "helper check failed");
}

export function networkHelperFailureMessage(error: unknown): string {
  const message = errorMessage(error);
  if (message === BUSY) return "Device checks are still busy. Retry the connection check.";
  if (message.includes("admin_auth_cancelled"))
    return "Administrator approval was cancelled. Retry when you are ready, or continue with warning.";
  if (message.includes("admin_auth_failed"))
    return "Administrator approval failed. Check the credentials or ask an organizer for help, then retry.";
  if (message.includes("pkexec_not_available"))
    return "Administrator authorization is unavailable. Ask an organizer to install the helper, or continue with warning.";
  if (message.includes("systemd_not_available"))
    return "The required system service manager is unavailable. Ask an organizer for a supported installation, or continue with warning.";
  if (message.includes("helper_binary_missing") || message.includes("helper_unit_missing"))
    return "This app package is missing network helper files. Ask an organizer for a complete supported package.";
  if (message.includes("helper_startup_timeout") || message.includes("socket not ready"))
    return "The network helper was installed but did not become ready. Retry, or ask an organizer to check the service.";
  if (message.includes("installation is already running"))
    return "Another network helper installation is still running. Wait for it to finish, then retry.";
  return "Could not verify the network lockdown helper. Retry the connection check, or continue with warning.";
}

function waitForRetry(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

/**
 * Prepare the daemon using strict bridge results. Only a measured `false`
 * authorizes installation; busy, failed and malformed responses never do.
 * Cancellation cannot stop an already launched native installer, but it stops
 * further probes, installation attempts and UI updates after leaving the stage.
 */
export async function ensureNetworkHelper({
  invoke,
  signal,
  onProgress,
}: HelperOptions): Promise<boolean> {
  // AbortSignal.throwIfAborted is unavailable in the earliest supported macOS WebKit.
  const assertActive = () => {
    if (signal.aborted) throw new Error("Helper check cancelled");
  };
  const update = (progress: NetworkHelperProgress) => {
    if (!signal.aborted) onProgress(progress);
  };
  const checkRunning = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      assertActive();
      try {
        const running = await invoke("network_helper_running");
        assertActive();
        if (typeof running !== "boolean") throw new Error("Invalid helper status");
        return running;
      } catch (error) {
        if (signal.aborted || errorMessage(error) !== BUSY || attempt === 2) throw error;
        update({ phase: "checking", message: "Device checks are busy. Retrying helper check…" });
        await waitForRetry(250 * (attempt + 1), signal);
      }
    }
    throw new Error("Helper check attempts exhausted");
  };

  try {
    assertActive();
    const platform = (await invoke("get_platform")) as { os?: unknown } | null;
    assertActive();
    if (platform?.os === "windows") return true;
    if (platform?.os !== "macos" && platform?.os !== "linux") {
      throw new Error("Unknown platform");
    }
    update({ phase: "checking", message: "Checking network lockdown helper" });
    if (await checkRunning()) {
      update({ phase: "pass", message: READY });
      return true;
    }

    assertActive();
    update({ phase: "installing", message: "Administrator approval requested" });
    await invoke("install_network_helper");
    assertActive();
    const ready = await checkRunning();
    update({
      phase: ready ? "pass" : "warn",
      message: ready
        ? READY
        : "The network lockdown helper was installed but did not start. Retry, or continue: you can still enter, and the invigilator is told.",
    });
    return ready;
  } catch (error) {
    if (signal.aborted) return false;
    update({
      phase: "warn",
      message: networkHelperFailureMessage(error),
    });
    return false;
  }
}
