// Shared non-UI support for the onboarding flow: Tauri bridge wrappers,
// timing utilities, media helpers, and the stage table. Extracted from
// page.tsx (first tranche of the per-stage split — see fable.md item 15).

import { resolveApiBase } from "@/lib/api-base";

export const API_URL = resolveApiBase();
export const BLAZEFACE_MODEL_URL = "/models/blazeface/model.json";

export function getNetworkProbeHost() {
  // Readiness uses a neutral connectivity canary so AMS service outages do not
  // look like local network failures.
  return "www.google.com";
}

export function getNetworkLockdownAllowlistHost() {
  try {
    return new URL(API_URL).hostname;
  } catch {}
  return "localhost";
}

export function getOrCreateDeviceId() {
  const existing = localStorage.getItem("ams_device_id");
  if (existing) return existing;
  const generated =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem("ams_device_id", generated);
  return generated;
}

export function normalizeVerificationWindowMinutes(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function verificationWindowLabel(minutes: number | null | undefined) {
  return minutes ? `${minutes}-minute` : "configured";
}

export function getVerificationOpenMs(windowMeta: ContestWindowMeta | null) {
  if (!windowMeta) return null;
  const start = new Date(windowMeta.startAt).getTime();
  if (!Number.isFinite(start) || !windowMeta.verificationWindowMinutes) return null;
  return start - windowMeta.verificationWindowMinutes * 60 * 1000;
}

// ─── Tauri bridge ─────────────────────────────────────────────────────────────
declare const window: Window & {
  __TAURI__?: {
    core: { invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T> };
    window: {
      getCurrentWindow: () => {
        setFullscreen: (v: boolean) => Promise<void>;
        setAlwaysOnTop: (v: boolean) => Promise<void>;
        setDecorations: (v: boolean) => Promise<void>;
        availableMonitors: () => Promise<MonitorInfo[]>;
        setResizable: (v: boolean) => Promise<void>;
      };
    };
  };
};

export interface MonitorInfo {
  name: string | null;
  position: { x: number; y: number };
  size: { width: number; height: number };
  scaleFactor: number;
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  try {
    return (await window.__TAURI__?.core.invoke<T>(cmd, args)) ?? null;
  } catch {
    return null;
  }
}

export async function invokeStrict<T>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T | null> {
  if (!window.__TAURI__) return null;
  return await window.__TAURI__.core.invoke<T>(cmd, args);
}

export async function tauriWindow() {
  return window.__TAURI__?.window.getCurrentWindow() ?? null;
}

export function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timer));
  });
}

export function withNullableTimeout<T>(promise: Promise<T | null>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise
      .then(resolve)
      .catch(() => resolve(null))
      .finally(() => clearTimeout(timer));
  });
}

export function stopMediaStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

export function getUserMediaWithTimeout(
  constraints: MediaStreamConstraints,
  ms = 8000
): Promise<MediaStream> {
  let timedOut = false;
  const request = navigator.mediaDevices.getUserMedia(constraints);
  request.then((stream) => {
    if (timedOut) {
      stopMediaStream(stream);
    }
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new Error("Camera request timed out"));
    }, ms);

    request
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timer));
  });
}

export async function waitForVideoReady(video: HTMLVideoElement, ms = 2500) {
  if (video.readyState >= 2 && video.videoWidth > 0) return;

  await withTimeout(
    new Promise<void>((resolve) => {
      const onReady = () => {
        video.removeEventListener("loadeddata", onReady);
        video.removeEventListener("canplay", onReady);
        resolve();
      };

      video.addEventListener("loadeddata", onReady, { once: true });
      video.addEventListener("canplay", onReady, { once: true });
    }),
    ms,
    "Camera preview timed out"
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────
export type StageStatus = "pending" | "checking" | "pass" | "warn" | "fail";

export interface Stage {
  id: number;
  label: string;
  group: string;
  status: StageStatus;
  note?: string;
}

export type ContestWindowMeta = {
  startAt: string;
  /** Null for a practice contest, which has no end. */
  endAt: string | null;
  timezone?: string;
  verificationWindowMinutes: number | null;
};

// Every stage here must *measure something*. Two that did not have been
// removed: "Preparing Your Session" and "Starting Session" were `setTimeout`
// chains that printed green passes on a fixed schedule — they would have
// reported a ready session on a machine with no camera, no network and no
// contest. "Starting Session" was worse than useless: its five-second
// countdown sat in front of the real lockdown work in the final stage, so the
// one moment where something genuinely happens was the one moment that looked
// like a progress bar finishing.
//
// The ids are the ordering and nothing else reads them for identity, so a
// stage can be added or removed here alone. `FINAL_STAGE` is derived rather
// than written down, because the last time it was a literal (`>= 15`) it had
// to agree with this table in four separate places.
export const STAGES: Omit<Stage, "status">[] = [
  { id: 1, label: "Secure Full-Screen", group: "Workspace Lockdown" },
  { id: 2, label: "Display Check", group: "Workspace Lockdown" },
  { id: 3, label: "Keyboard Setup", group: "Workspace Lockdown" },
  { id: 4, label: "Setup Verification", group: "System Checks" },
  { id: 5, label: "Application Check", group: "System Checks" },
  { id: 6, label: "Device Compatibility", group: "System Checks" },
  { id: 7, label: "Camera Setup", group: "Media Setup" },
  { id: 8, label: "Face Scan", group: "Identity Scan" },
  { id: 9, label: "Presence Check", group: "Identity Scan" },
  { id: 10, label: "Microphone Check", group: "Media Setup" },
  { id: 11, label: "Connection Check", group: "Finalizing" },
  { id: 12, label: "Final Review", group: "Finalizing" },
  { id: 13, label: "Entering Contest", group: "Finalizing" },
];

/** The stage that performs the actual secure start. Nothing follows it. */
export const FINAL_STAGE = STAGES.length;

/** The summary stage, which is also where a policy block is shown. */
export const REVIEW_STAGE = FINAL_STAGE - 1;

export const STAGE_META: Record<number, { checking: string; todo: string | null; onFail: string }> =
  {
    1: {
      checking: "Full-screen and window focus mode",
      todo: null,
      onFail: "Contest cannot start without full-screen mode",
    },
    2: {
      checking: "Number of connected displays",
      todo: "Disconnect any external monitors if prompted, then scan again",
      onFail: "Multiple screens are not permitted during a contest",
    },
    3: {
      checking: "Keyboard shortcut lockdown",
      todo: null,
      onFail: "Some shortcuts may remain accessible — recorded, and you may still enter",
    },
    4: {
      checking: "Full-screen and keyboard controls",
      todo: null,
      onFail: "Warnings are recorded but do not block entry",
    },
    5: {
      checking: "Restricted applications running on this device",
      todo: "Close any flagged apps when prompted, then scan again",
      onFail: "Entry is blocked until restricted apps are closed",
    },
    6: {
      checking: "Whether this device is running inside a virtual machine",
      todo: null,
      onFail: "Session is flagged for review — you may still enter",
    },
    7: {
      checking: "Camera access and video feed",
      todo: "Allow camera access when your OS asks",
      onFail: "Camera is required — fix the permission and try again",
    },
    8: {
      checking: "Face position and identity capture",
      todo: "Look directly at the camera and hold still until captured",
      onFail: "Setup waits until a valid face is captured — contact your proctor if stuck",
    },
    9: {
      checking: "Live presence via camera feed",
      todo: "Stay visible in front of your camera",
      onFail: "Presence must be confirmed before continuing",
    },
    10: {
      checking: "Microphone access and audio signal",
      todo: "Allow microphone access when prompted",
      onFail: "Microphone is optional — setup continues with an advisory warning",
    },
    11: {
      checking: "Network connection and response time",
      todo: "Make sure you have a stable internet connection",
      onFail: "Poor connection is recorded — you may still enter",
    },
  };
