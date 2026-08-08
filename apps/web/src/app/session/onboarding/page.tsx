"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  applyOrganizerOverrides,
  collectDeviceState,
  fetchOrganizerOverrides,
  startSecureSession,
  strictContestPolicy,
  type OrganizerOverride,
} from "@ams/api-client";
import { fetchJson, SessionBindingError } from "@/lib/api-client";
import { authHeaders, participantToken } from "@/lib/candidate-auth";
import { isGatingRelaxed, warnGatingRelaxed } from "@/lib/gating";
import { useTheme } from "./components/hooks";
import { PHASE_FRIENDLY_NAME, readinessBlockMessage } from "./components/labels";
import { Stage1_SessionIsolation } from "./components/stages/Stage1_SessionIsolation";
import { Stage2_Fullscreen } from "./components/stages/Stage2_Fullscreen";
import { Stage3_MonitorDetection } from "./components/stages/Stage3_MonitorDetection";
import { Stage4_KeyboardLockdown } from "./components/stages/Stage4_KeyboardLockdown";
import { Stage5_EnvironmentValidation } from "./components/stages/Stage5_EnvironmentValidation";
import { Stage6_RestrictedApps } from "./components/stages/Stage6_RestrictedApps";
import { Stage7_VMDetection } from "./components/stages/Stage7_VMDetection";
import { Stage8_CameraInit } from "./components/stages/Stage8_CameraInit";
import { Stage9_FaceCalibration } from "./components/stages/Stage9_FaceCalibration";
import { Stage10_PresenceVerification } from "./components/stages/Stage10_PresenceVerification";
import { Stage11_AudioVerification } from "./components/stages/Stage11_AudioVerification";
import { Stage12_NetworkValidation } from "./components/stages/Stage12_NetworkValidation";
import { Stage13_IntegrityConfirmation } from "./components/stages/Stage13_IntegrityConfirmation";
import { Stage14_LockInCountdown } from "./components/stages/Stage14_LockInCountdown";
import { ProgressBar } from "./components/ProgressBar";
import { DryRunSummary } from "./components/DryRunSummary";

import {
  API_URL,
  STAGES,
  STAGE_META,
  delay,
  getNetworkLockdownAllowlistHost,
  getNetworkProbeHost,
  getOrCreateDeviceId,
  getVerificationOpenMs,
  invoke,
  normalizeVerificationWindowMinutes,
  tauriWindow,
  verificationWindowLabel,
  withTimeout,
  type ContestWindowMeta,
  type MonitorInfo,
  type Stage,
  type StageStatus,
} from "./support";

// Tauri global typing for the direct window.__TAURI__ uses in this file.
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

// ─── Main orchestrator ────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const contestId =
    typeof window !== "undefined"
      ? (new URLSearchParams(window.location.search).get("contestId") ?? "")
      : "";
  // Pre-flight dry-run ("practice run"): runs the full readiness gauntlet but
  // never creates a session or enters a contest, and tears down all lockdown at
  // the end. Lets candidates rehearse exam-day setup days early.
  const dryRun =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("mode") === "dry-run"
      : false;
  const [dryRunComplete, setDryRunComplete] = useState(false);
  const [dryRunNetwork, setDryRunNetwork] = useState<"skipped" | "ok" | "failed">("skipped");
  const [currentStage, setCurrentStage] = useState(0);
  const [results, setResults] = useState<Record<number, StageStatus>>({});
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [policyBlock, setPolicyBlock] = useState<string | null>(null);
  const [contestWindow, setContestWindow] = useState<ContestWindowMeta | null>(null);
  const [waitMs, setWaitMs] = useState<number>(0);
  const [readyForStart, setReadyForStart] = useState(false);
  const [sessionPrepared, setSessionPrepared] = useState(false);
  const [isTestAccount, setIsTestAccount] = useState(false);
  // Authoritative device platform ("windows" | "macos" | "linux"), resolved
  // once via the Tauri `get_platform` command. Drives the Windows-only entry
  // enforcement (external display / remote-desktop / camera) — every new block
  // is gated on this being "windows", so macOS/Linux behavior is unchanged.
  const [platform, setPlatform] = useState<string | null>(null);
  // Organizer overrides for this device, fetched early so the Windows display
  // hard-block (Stage 3) can be relaxed for a pre-approved candidate. They are
  // also re-fetched and applied to the policy in finalizeSecureStart.
  const [overrides, setOverrides] = useState<OrganizerOverride[]>([]);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  // Set when the candidate proceeds past the face check via the equity fallback;
  // recorded durably once the session exists so a proctor can review it.
  const faceFallbackRef = useRef(false);
  const theme = useTheme();
  const isLight = theme === "light";

  // Keep ref in sync with state so the unmount cleanup below sees the latest stream.
  useEffect(() => {
    cameraStreamRef.current = cameraStream;
  }, [cameraStream]);

  // Resolve the authoritative device platform once. Outside the Tauri shell
  // (dev / browser preview) this stays null, so no Windows-only block engages.
  useEffect(() => {
    let cancelled = false;
    invoke<{ os: string }>("get_platform")
      .then((p) => {
        if (!cancelled && typeof p?.os === "string") setPlatform(p.os);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch organizer overrides early so the Windows display hard-block can be
  // relaxed for a pre-approved candidate before they reach Stage 3. A fetch
  // failure (offline / endpoint absent) yields no overrides — the candidate is
  // never hard-failed on the fetch itself; enforcement just stays at baseline.
  useEffect(() => {
    if (!contestId) return;
    let cancelled = false;
    fetchOrganizerOverrides(API_URL, contestId, getOrCreateDeviceId(), participantToken() ?? "")
      .then((list) => {
        if (!cancelled) setOverrides(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [contestId]);

  useEffect(() => {
    if (isTestAccount && currentStage === 0 && !dryRunComplete) {
      setCurrentStage(15);
      setReadyForStart(true);
      setPolicyBlock(null);
    }
  }, [currentStage, dryRunComplete, isTestAccount]);

  const externalDisplayOverride = overrides.some((o) => o.check_kind === "external_display");

  useEffect(() => {
    // A fast-path that skips every onboarding gate, for working on the stages
    // themselves without sitting through them. It is keyed on a
    // candidate-controllable localStorage value, so it MUST also require the
    // build-time relax flag — otherwise setting the key in devtools would
    // bypass proctoring in a shipping build. Flag off ⇒ no fast path.
    //
    // Keyed on its own dev flag rather than on a "tester@" email: sign-in is
    // by printed slip now and no email is stored at all, so the old check
    // could never fire and was dead code that read as live.
    if (!isGatingRelaxed()) {
      setIsTestAccount(false);
      return;
    }
    const enabled = localStorage.getItem("ams_dev_skip_onboarding") === "1";
    if (enabled) warnGatingRelaxed("onboarding fast-path active (ams_dev_skip_onboarding)");
    setIsTestAccount(enabled);
  }, []);

  useEffect(() => {
    if (!isTestAccount) return;
    setCurrentStage(15);
    setReadyForStart(true);
    setPolicyBlock(null);
    setTransitioning(false);
  }, [isTestAccount]);

  // Stop camera tracks ONLY when this page unmounts (after router.push to contest).
  // Stopping on every cameraStream change would kill the active stream mid-flow
  // if Stage 8 ever re-acquires (e.g. due to StrictMode or unstable callback deps).
  useEffect(() => {
    return () => {
      cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (!contestId) return;
    let cancelled = false;
    fetchJson<{
      start_at?: string;
      end_at?: string;
      timezone?: string;
      verification_window_minutes?: number | null;
    }>(`${API_URL}/contests/${contestId}`, {}, { dedupeKey: `contest:${contestId}`, retries: 2 })
      .then((meta) => {
        if (cancelled || !meta?.start_at || !meta?.end_at) return;
        setContestWindow({
          startAt: meta.start_at,
          endAt: meta.end_at,
          timezone: meta.timezone,
          verificationWindowMinutes: normalizeVerificationWindowMinutes(
            meta.verification_window_minutes
          ),
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [contestId]);

  useEffect(() => {
    if (!contestWindow) return;
    const tick = () => {
      const startMs = new Date(contestWindow.startAt).getTime();
      const now = Date.now();
      setWaitMs(Math.max(0, startMs - now));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [contestWindow]);

  async function evaluateEntryGateFromServer() {
    if (!contestId) return { ok: false, reason: "Missing contest id.", state: "UNKNOWN" };
    if (isTestAccount) return { ok: true, reason: null as string | null, state: "LIVE" };
    try {
      let body: {
        eligibility_status?: string;
        blocked_reason?: string;
        session_window_state?: string;
        start_at?: string;
        end_at?: string;
        verification_window_minutes?: number | null;
      } | null = null;
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          body = await fetchJson<{
            eligibility_status?: string;
            blocked_reason?: string;
            session_window_state?: string;
            start_at?: string;
            end_at?: string;
            verification_window_minutes?: number | null;
          }>(
            `${API_URL}/contests/${contestId}/session-window`,
            {},
            { dedupeKey: `contest-window:${contestId}:${attempt}`, retries: 0 }
          );
          break;
        } catch (err) {
          // Re-throw server errors (HTTP 4xx/5xx) — only retry network/timeout failures.
          if (err instanceof Error && /^HTTP \d/.test(err.message)) throw err;
          lastErr = err;
          await new Promise((r) => setTimeout(r, 600));
        }
      }
      if (!body) {
        void lastErr;
        return { ok: false, reason: "Unable to validate contest entry window.", state: "UNKNOWN" };
      }
      if (body.start_at && body.end_at) {
        setContestWindow((prev) => ({
          startAt: body.start_at ?? prev?.startAt ?? "",
          endAt: body.end_at ?? prev?.endAt ?? "",
          timezone: prev?.timezone,
          verificationWindowMinutes:
            normalizeVerificationWindowMinutes(body.verification_window_minutes) ??
            prev?.verificationWindowMinutes ??
            null,
        }));
      }
      const status = String(body.eligibility_status ?? "blocked").toLowerCase();
      const windowState = (body.session_window_state ?? "").toUpperCase();

      // Authoritative backend window state takes precedence over secondary
      // eligibility_status so that the 30-min late-entry buffer is honored
      // and genuinely-closed windows are never allowed through.
      //
      // Priority order:
      //  1. LIVE           → allow entry unconditionally (contest is active, late
      //                       entry within the 30-min buffer is permitted).
      //  2. LATE_CLOSED    → hard-block; 30-min late-entry window has passed.
      //  3. ENDED          → hard-block; contest is over.
      //  4. eligibility_status === "allowed" → allow (covers pre-start VERIFY_WINDOW_OPEN).
      //  5. eligibility_status === "wait"    → not-open yet (verification window).
      //  6. Anything else  → block (unknown / NOT_OPEN / default-safe).
      if (windowState === "LIVE") return { ok: true, reason: null as string | null, state: "LIVE" };
      if (windowState === "LATE_CLOSED")
        return {
          ok: false,
          reason:
            body.blocked_reason ||
            "Entry closed — you can only join within 30 minutes of the contest start.",
          state: "LATE_CLOSED",
        };
      if (windowState === "ENDED")
        return {
          ok: false,
          reason: body.blocked_reason || "This contest has ended.",
          state: "ENDED",
        };
      if (status === "allowed")
        return {
          ok: true,
          reason: null as string | null,
          state: body.session_window_state ?? "VERIFY_WINDOW_OPEN",
        };
      if (status === "wait")
        return {
          ok: false,
          reason: body.blocked_reason || "Verification is not open for this contest yet.",
          state: body.session_window_state ?? "NOT_OPEN",
        };
      // Default-safe: unknown state → block.
      return {
        ok: false,
        reason: body.blocked_reason || "Join window is closed once contest starts.",
        state: body.session_window_state ?? "UNKNOWN",
      };
    } catch {
      return { ok: false, reason: "Unable to validate contest entry window.", state: "UNKNOWN" };
    }
  }

  function formatCountdown(ms: number) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  const finalizeSecureStart = useCallback(async () => {
    setPolicyBlock(null);

    // ── Dry-run rehearsal ────────────────────────────────────────────────────
    // Exercise the network lockdown (so install/permission friction surfaces),
    // then release ALL lockdown. Never create a session or enter a contest.
    if (dryRun) {
      const tauriBridge = window.__TAURI__;
      if (tauriBridge) {
        try {
          const ok = await tauriBridge.core.invoke<boolean>("enable_network_lockdown", {
            allowedDomains: [getNetworkLockdownAllowlistHost()],
          });
          setDryRunNetwork(ok ? "ok" : "failed");
        } catch {
          setDryRunNetwork("failed");
        }
        // Always release — a rehearsal must never leave the machine locked down.
        await tauriBridge.core.invoke("disable_network_lockdown").catch(() => {});
      }

      const win = await tauriWindow();
      if (win) {
        await win.setFullscreen(false).catch(() => {});
        await win.setAlwaysOnTop(false).catch(() => {});
        await win.setDecorations(true).catch(() => {});
      }
      await window.__TAURI__?.core.invoke("unlock_desktop").catch(() => {});
      await window.__TAURI__?.core.invoke("disable_keyboard_intercept").catch(() => {});
      cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
      setCameraStream(null);

      setReadyForStart(false);
      setTransitioning(false);
      setDryRunComplete(true);
      return;
    }

    let windowMeta = contestWindow;
    const windowMetaRequest =
      !windowMeta && contestId
        ? fetchJson<{
            start_at?: string;
            end_at?: string;
            timezone?: string;
            verification_window_minutes?: number | null;
          }>(
            `${API_URL}/contests/${contestId}`,
            {},
            {
              dedupeKey: `contest:${contestId}`,
              retries: 2,
            }
          ).catch(() => null)
        : Promise.resolve(null);

    const [fetchedWindowMeta, gate] = await Promise.all([
      windowMetaRequest,
      evaluateEntryGateFromServer(),
    ]);

    if (fetchedWindowMeta?.start_at && fetchedWindowMeta?.end_at) {
      windowMeta = {
        startAt: fetchedWindowMeta.start_at,
        endAt: fetchedWindowMeta.end_at,
        timezone: fetchedWindowMeta.timezone,
        verificationWindowMinutes: normalizeVerificationWindowMinutes(
          fetchedWindowMeta.verification_window_minutes
        ),
      };
      setContestWindow(windowMeta);
    }
    const localGate = (() => {
      if (!windowMeta) return { ok: true, reason: null as string | null };
      const now = Date.now();
      const start = new Date(windowMeta.startAt).getTime();
      const end = new Date(windowMeta.endAt).getTime();
      const open = getVerificationOpenMs(windowMeta);
      if (now >= end) return { ok: false, reason: "Contest has ended." };
      if (open !== null && now < open)
        return {
          ok: false,
          reason: `Verification opens in the ${verificationWindowLabel(
            windowMeta.verificationWindowMinutes
          )} window before contest start.`,
        };
      return { ok: true, reason: null as string | null };
    })();
    const effectiveGate = gate.state === "UNKNOWN" ? localGate : gate;

    if (!effectiveGate.ok && !isTestAccount) {
      setCurrentStage(13);
      setTransitioning(false);
      setReadyForStart(false);
      setPolicyBlock(effectiveGate.reason);
      return;
    }

    if (windowMeta && !isTestAccount) {
      const remaining = new Date(windowMeta.startAt).getTime() - Date.now();
      if (remaining > 0) {
        setCurrentStage(15);
        setTransitioning(false);
        setReadyForStart(true);
        setPolicyBlock(null);
        return;
      }
    }
    const devices = await navigator.mediaDevices?.enumerateDevices?.().catch(() => []);
    const deviceState = await collectDeviceState({
      // Real connectivity probe (neutral canary host) feeds the readiness gate.
      // Under the test flag we skip it and force a healthy network below.
      networkHost: isGatingRelaxed() ? undefined : getNetworkProbeHost(),
      apiUrl: API_URL,
      cameraAvailable:
        cameraStreamRef.current?.getVideoTracks().some((track) => track.readyState === "live") ||
        devices?.some((device) => device.kind === "videoinput") ||
        false,
      microphoneAvailable: devices?.some((device) => device.kind === "audioinput") || false,
      activateKeyboard: true,
    });
    if (isGatingRelaxed()) {
      // TEST-ONLY (build-time flag): present a healthy network + installed helper
      // so the readiness gate treats network as fine. Default builds use the real
      // probe results collected above (and the core-rs network/clock-skew gate).
      warnGatingRelaxed("launch device-state network forced healthy");
      deviceState.network = { reachable: true, latency_ms: 1, jitter_ms: 0, quality: "excellent" };
      deviceState.network_helper_ready = true;
    }

    try {
      // The candidate's identity for this contest is the OTP login_email
      // (the generated_username) stored at sign-in. Never fall back to a shared
      // placeholder: that collapses every candidate onto one session. If it is
      // missing, the sign-in did not complete — abort the launch and send them back.
      // Lowercased to match the server, which stores and compares candidate_email
      // case-insensitively — keeps the client value byte-identical to the stored row.
      if (!sessionPrepared) {
        const body = await fetchJson<{ uid?: string }>(
          `${API_URL}/participant/sessions`,
          {
            method: "POST",
            headers: authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({
              // The contest uid, and the machine. Identity comes from the
              // participant token — the old body sent a candidate email,
              // which was both unverified and no longer a thing this system
              // has.
              contest_uid: contestId,
              device_fingerprint: getOrCreateDeviceId(),
              os_name: navigator.platform,
            }),
          },
          { dedupeKey: `session:create:${contestId}`, retries: 2 }
        );
        if (body?.uid) {
          localStorage.setItem(
            "ams_active_session",
            JSON.stringify({
              id: body.uid,
              contest_id: contestId,
              updated_at: new Date().toISOString(),
            })
          );
          // SEC-3/SEC-4: arm the proctoring event uploader as soon as the
          // session exists, so onboarding-phase events — including a failed
          // network lockdown below — stream to the server promptly instead of
          // waiting for the contest screen to mount.
          await invoke("configure_event_stream", {
            apiUrl: API_URL,
            sessionId: body.uid,
            // Session endpoints are authenticated; without the token the
            // uploader would 401 for ever and the spool would grow unbounded.
            token: participantToken(),
          }).catch(() => {});
          // Now that the session exists and the event stream is armed, durably
          // record a face-check fallback so the proctor sees it server-side.
          if (faceFallbackRef.current) {
            await invoke("log_proctoring_event", {
              kind: "face_verification_fallback",
              detail: "Candidate proceeded past the face check for manual proctor review.",
              payload: { stage: 9 },
            }).catch(() => {});
          }
        }
        setSessionPrepared(true);
      }

      // SEC-3: network lockdown is the core anti-cheat control — never enter a
      // contest with it silently un-applied. Outside the desktop shell (dev /
      // browser preview) there is nothing to lock, so skip. Inside it, a failure
      // is a hard stop with a durable, server-visible violation so the proctor
      // sees the attempt rather than the candidate slipping in with open internet.
      const tauriBridge = window.__TAURI__;
      if (tauriBridge) {
        let lockdownEngaged = false;
        let lockdownError: string | null = null;
        try {
          // Bound the call: a hung/half-installed helper must not freeze the
          // final stage. withTimeout rejects on timeout AND propagates the
          // helper's real error, so the catch surfaces a clear reason and the
          // hard-block path below fires.
          lockdownEngaged = await withTimeout(
            tauriBridge.core.invoke<boolean>("enable_network_lockdown", {
              allowedDomains: [getNetworkLockdownAllowlistHost()],
            }),
            8000,
            "network lockdown timed out after 8s (helper unresponsive?)"
          );
        } catch (err) {
          lockdownError = err instanceof Error ? err.message : String(err);
        }

        if (!lockdownEngaged) {
          const detail = lockdownError ?? "enable_network_lockdown returned false";
          // Always record the failure server-side first, so the proctor sees the
          // attempt regardless of which path we take below.
          await invoke("log_violation", { kind: "network_lockdown_failed", detail }).catch(
            () => {}
          );
          await invoke("log_proctoring_event", {
            kind: "network_lockdown_failed",
            detail,
            payload: { allowed_domains: [getNetworkLockdownAllowlistHost()] },
          }).catch(() => {});

          if (isGatingRelaxed()) {
            // TEST MODE ONLY — gated on the build-time NEXT_PUBLIC_AMS_RELAX_GATING
            // flag, which a candidate cannot set. Relaxed builds proceed into the
            // contest even though the privileged network helper never engaged, so
            // the full contest flow can be exercised on machines without the helper
            // (e.g. dev Linux boxes). The failure is still logged above as a
            // server-visible violation, and the "relaxed mode" badge is shown. This
            // branch must NEVER be reachable in a shipping build — strict builds
            // fall through to the hard stop below.
            warnGatingRelaxed(
              `network lockdown NOT engaged at launch (${detail}) — entering contest with OPEN internet`
            );
            // fall through to launch
          } else {
            setReadyForStart(false);
            setTransitioning(false);
            setPolicyBlock(
              "We couldn't secure your network for the exam — the proctoring network component may not be installed or still needs your permission. Re-run device setup, then try again. Starting now would leave your internet open, which a secured contest does not allow."
            );
            return;
          }
        }

        await invoke("log_proctoring_event", {
          kind: "network_lockdown_engaged",
          detail: "Outbound traffic restricted to the exam allowlist.",
          payload: { allowed_domains: [getNetworkLockdownAllowlistHost()] },
        }).catch(() => {});
      }

      // Platform-aware strict policy. Prefer the platform reported by
      // collect_device_state (authoritative at start time); fall back to the
      // get_platform value resolved at mount. On Windows this makes camera /
      // external_display / remote_server required+block so the Rust-side
      // merge_requirements keeps the Windows enforcement; off-Windows they stay
      // advisory and behavior is unchanged.
      const devicePlatform = deviceState.platform ?? platform ?? undefined;
      const deviceId = getOrCreateDeviceId();
      // Re-fetch overrides at the gate so a freshly issued waiver is honored.
      // A fetch failure yields the base policy — we never trap the candidate on
      // a transient overrides-endpoint error.
      let liveOverrides: OrganizerOverride[] = overrides;
      try {
        liveOverrides = await fetchOrganizerOverrides(
          API_URL,
          contestId,
          deviceId,
          participantToken() ?? ""
        );
        setOverrides(liveOverrides);
      } catch {
        liveOverrides = overrides;
      }
      const policy = applyOrganizerOverrides(strictContestPolicy(devicePlatform), liveOverrides);

      await startSecureSession({
        contestId,
        deviceId,
        policy,
        deviceState,
        // Entry-gate attestation: the evaluated readiness report is
        // delivered to the backend so the server has a durable record of
        // what this device claimed — including when the gate blocked, which
        // is the report an invigilator actually needs. Best-effort: the
        // client, not the server, decides whether to proceed.
        apiUrl: API_URL,
        token: participantToken(),
      });

      if (windowMeta && !isTestAccount) {
        const remaining = new Date(windowMeta.startAt).getTime() - Date.now();
        if (remaining > 0) {
          setCurrentStage(15);
          setTransitioning(false);
          setReadyForStart(true);
          setPolicyBlock(null);
          return;
        }
      }

      // Lockdown hard-stop (symmetric to the network-lockdown gate above):
      // lock_desktop runs inside startSecureSession but can fail (e.g. the
      // keyboard hook is denied) while reporting no error, leaving the desktop
      // unlocked. Entering then would both defeat proctoring AND make the
      // contest page's lock guard bounce the candidate straight back here — an
      // infinite loop. So we probe the authoritative lock state and hard-stop
      // instead of navigating. Outside the desktop shell there is nothing to
      // lock, so this is skipped (browser/dev).
      //
      // macOS exception: the CGEventTap keyboard hook requires Accessibility
      // permission which may not be granted; the readiness policy already marks
      // macOS keyboard lockdown as advisory (warning, not block). Full-screen
      // still engages on macOS, so an unlocked-keyboard state is expected and
      // must NOT prevent contest entry. Hard-block only applies to Linux/Windows
      // where keyboard lockdown is mandatory.
      if (tauriBridge) {
        let lockEngaged = false;
        try {
          lockEngaged = await tauriBridge.core.invoke<boolean>("is_lockdown_engaged");
        } catch {
          lockEngaged = false;
        }
        if (!lockEngaged) {
          await invoke("log_violation", {
            kind: "lockdown_failed",
            detail: "is_lockdown_engaged returned false after start_secure_session",
          }).catch(() => {});
          await invoke("log_proctoring_event", {
            kind: "lockdown_failed",
            detail: "Desktop lockdown (keyboard / full-screen) did not engage.",
          }).catch(() => {});
          // On macOS the keyboard CGEventTap is advisory — full-screen lockdown
          // still engages. Proceed into the contest but surface a security event
          // so the proctor is aware. On Linux/Windows keyboard lockdown is
          // mandatory; hard-block if it didn't engage.
          const isMacOS = (deviceState.platform ?? platform ?? "").toLowerCase() === "macos";
          if (!isMacOS) {
            setReadyForStart(false);
            setTransitioning(false);
            setPolicyBlock(
              "We couldn't lock down your screen for the exam — keyboard/full-screen lockdown didn't engage. Re-run device setup and try again. A secured contest can't start without it."
            );
            return;
          }
          // macOS: log advisory warning and continue into contest.
          await invoke("log_proctoring_event", {
            kind: "keyboard_lockdown_advisory",
            detail:
              "macOS keyboard lockdown did not engage (Accessibility permission not granted); full-screen lockdown active. Advisory only — contest entry proceeding.",
          }).catch(() => {});
        }
      }

      setReadyForStart(false);
      router.push(`/session/contest?contestId=${contestId}`);
    } catch (error) {
      // SESSION_DEVICE_MISMATCH / SESSION_IDLE_TIMEOUT: the backend rejected this
      // device binding.  Route the candidate to /home so they can use the existing
      // resume-request flow (submitResumeRequest) to rejoin from their device.
      if (error instanceof SessionBindingError) {
        setTransitioning(false);
        setReadyForStart(false);
        setPolicyBlock(
          error.code === "SESSION_DEVICE_MISMATCH"
            ? "This session was started on a different device. Return to the home screen to request re-entry from your organizer."
            : "Your session timed out due to inactivity. Return to the home screen to request re-entry."
        );
        // Give the candidate 3 s to read the message, then navigate home so they
        // can use the organizer-approved resume flow.
        setTimeout(() => {
          router.push("/home");
        }, 3000);
        return;
      }
      const rawMsg =
        error instanceof Error ? error.message : "Readiness policy blocked contest launch.";
      if (windowMeta && !isTestAccount) {
        const remaining = new Date(windowMeta.startAt).getTime() - Date.now();
        if (remaining > 0 && rawMsg.toLowerCase().includes("not accepting sessions")) {
          setCurrentStage(15);
          setTransitioning(false);
          setReadyForStart(true);
          setPolicyBlock(null);
          return;
        }
      }
      // start_secure_session throws the JSON-encoded readiness report when the
      // decision is Blocked. Translate it into a candidate-facing message so the
      // Windows-only external_display / remote_server blocks surface their
      // detail strings instead of a raw JSON blob.
      const msg = readinessBlockMessage(rawMsg) ?? rawMsg;
      setCurrentStage(13);
      setTransitioning(false);
      setReadyForStart(false);
      setPolicyBlock(msg);
    }
  }, [contestId, router, contestWindow, readyForStart, dryRun, platform, overrides, isTestAccount]);

  useEffect(() => {
    if (!contestWindow) return;
    if (currentStage !== 15) return;
    if (waitMs <= 0 && readyForStart) {
      void finalizeSecureStart();
    }
  }, [contestWindow, currentStage, waitMs, contestId, readyForStart, finalizeSecureStart]);

  const advance = useCallback(
    (status: StageStatus = "pass") => {
      if (transitioning) return;
      setTransitioning(true);
      setResults((r) => ({ ...r, [currentStage]: status }));
      setTimeout(() => {
        setCurrentStage((s) => {
          const next = s + 1;
          if (next >= 15) {
            void finalizeSecureStart();
            return next;
          }
          return next;
        });
        setTransitioning(false);
      }, 300);
    },
    [currentStage, transitioning, finalizeSecureStart]
  );

  const advancePass = useCallback(() => advance("pass"), [advance]);
  const advanceWarn = useCallback(() => advance("warn"), [advance]);
  // Equity fallback from the face check: flag for proctor review, record it
  // best-effort now (buffered until the session exists, then re-logged durably in
  // finalizeSecureStart), and advance as a warning rather than a clean pass.
  const handleFaceFallback = useCallback(() => {
    faceFallbackRef.current = true;
    void invoke("log_proctoring_event", {
      kind: "face_verification_fallback",
      detail: "Candidate proceeded past the face check for manual proctor review.",
      payload: { stage: 9, dry_run: dryRun },
    }).catch(() => {});
    advanceWarn();
  }, [advanceWarn, dryRun]);
  const emergencyExit = useCallback(async () => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    setCameraStream(null);

    const win = await tauriWindow();
    if (win) {
      await win.setFullscreen(false).catch(() => {});
      await win.setAlwaysOnTop(false).catch(() => {});
      await win.setDecorations(true).catch(() => {});
    }
    try {
      await window.__TAURI__?.core.invoke("unlock_desktop");
    } catch {}
    try {
      await window.__TAURI__?.core.invoke("disable_keyboard_intercept");
    } catch {}
    try {
      await window.__TAURI__?.core.invoke("disable_network_lockdown");
    } catch {}
    router.push("/home");
  }, [router]);

  useEffect(() => {
    function handleEmergencyKey(e: KeyboardEvent) {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "q") {
        e.preventDefault();
        void emergencyExit();
      }
    }

    window.addEventListener("keydown", handleEmergencyKey, true);
    return () => window.removeEventListener("keydown", handleEmergencyKey, true);
  }, [emergencyExit]);

  const nowMs = Date.now();
  const startMs = contestWindow ? new Date(contestWindow.startAt).getTime() : 0;
  const endMs = contestWindow ? new Date(contestWindow.endAt).getTime() : 0;
  const verifyOpenMs = getVerificationOpenMs(contestWindow);
  const isTooEarly = isTestAccount ? false : verifyOpenMs !== null ? nowMs < verifyOpenMs : false;
  const isAfterStart = isTestAccount
    ? false
    : contestWindow
      ? nowMs >= startMs && nowMs < endMs
      : false;
  const isEnded = isTestAccount ? false : contestWindow ? nowMs >= endMs : false;
  const verifyOpensInMs = verifyOpenMs !== null ? Math.max(0, verifyOpenMs - nowMs) : 0;
  const showWaitLock = currentStage === 15 && readyForStart;

  return (
    <main
      style={{
        background: "#0F0F0F",
        minHeight: "100vh",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        userSelect: "none",
        color: "#FFF",
        transition: "background var(--transition-slow), color var(--transition-slow)",
      }}
    >
      <div
        style={{
          position: "fixed",
          top: 16,
          right: 16,
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: "6px",
        }}
      >
        <button
          type="button"
          className="onb-btn onb-btn--danger"
          onClick={() => void emergencyExit()}
          aria-label="Exit setup. Shortcut: Control Shift Q."
          title="Shortcut: Ctrl + Shift + Q"
          style={{
            background: "transparent",
            border: "none",
            borderRadius: 0,
            color: "rgba(239,68,68,0.8)",
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            padding: "4px 2px",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "#ef4444";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "rgba(239,68,68,0.8)";
          }}
        >
          Exit setup
        </button>
        <span
          style={{
            color: "#a1a1aa",
            fontSize: "11px",
            fontFamily: "'JetBrains Mono', monospace",
            background: "rgba(15, 15, 15, 0.82)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "var(--radius-sm)",
            padding: "4px 7px",
          }}
        >
          Shortcut: Ctrl + Shift + Q
        </span>
      </div>

      {policyBlock && (
        <div
          style={{
            margin: "20px auto 0",
            maxWidth: 560,
            border:
              platform === "macos" && policyBlock.includes("accessibility_denied")
                ? "1px solid #78350f"
                : "1px solid rgba(239,68,68,0.28)",
            background:
              platform === "macos" && policyBlock.includes("accessibility_denied")
                ? "#1c1007"
                : "rgba(239,68,68,0.08)",
            color:
              platform === "macos" && policyBlock.includes("accessibility_denied")
                ? "#fdba74"
                : "#fca5a5",
            borderRadius: "var(--radius-md)",
            padding: "16px 20px",
            fontSize: "11px",
            fontFamily: "'JetBrains Mono', monospace",
            whiteSpace: "pre-line",
          }}
        >
          {platform === "macos" && policyBlock.includes("accessibility_denied") ? (
            <>
              <p
                style={{
                  margin: "0 0 6px",
                  fontSize: "13px",
                  fontWeight: 700,
                  color: "#fb923c",
                }}
              >
                Grant Accessibility permission
              </p>
              <p
                style={{ margin: "0 0 14px", fontSize: "12px", lineHeight: 1.6, color: "#fdba74" }}
              >
                AMS Access needs Accessibility permission to block exam keyboard shortcuts. Open
                System Settings, find AMS Access under Privacy &amp; Security → Accessibility, and
                toggle it on. Then run the device check again.
              </p>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <button
                  className="onb-btn onb-btn--primary"
                  onClick={() => void invoke("open_accessibility_settings")}
                >
                  Open Accessibility Settings
                </button>
                <button
                  className="onb-btn onb-btn--secondary"
                  onClick={() => {
                    setPolicyBlock(null);
                    setCurrentStage(4);
                  }}
                >
                  Run checks again
                </button>
              </div>
            </>
          ) : (
            policyBlock
          )}
        </div>
      )}
      {currentStage > 0 && <ProgressBar current={currentStage} results={results} />}

      <div
        style={{
          display: "flex",
          minHeight: "100vh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "48px 32px",
          opacity: transitioning ? 0 : 1,
          transform: transitioning ? "translateY(6px) scale(0.99)" : "translateY(0) scale(1)",
          transition: "opacity var(--transition-standard), transform var(--transition-standard)",
        }}
      >
        {/* Dry-run rehearsal summary replaces the stage flow once complete. */}
        {dryRunComplete && (
          <DryRunSummary
            results={results}
            networkOutcome={dryRunNetwork}
            onDone={() => router.push("/home")}
          />
        )}

        {/* Group label — hidden on intro screen */}
        {currentStage > 0 && !dryRunComplete && (
          <div style={{ marginBottom: "4px", textAlign: "center" }}>
            <p
              style={{
                fontSize: "11px",
                letterSpacing: "0.12em",
                color: "#3F3F46",
                textTransform: "uppercase",
                fontWeight: 500,
              }}
            >
              {PHASE_FRIENDLY_NAME[STAGES[currentStage - 1]?.group ?? ""] ??
                STAGES[currentStage - 1]?.group}
            </p>
          </div>
        )}

        {/* Intro screen — shown before stage 1 begins */}
        {currentStage === 0 && !dryRunComplete && (
          <div
            style={{
              maxWidth: "480px",
              width: "100%",
              background: "#0F0F0F",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "var(--radius-lg)",
              boxShadow: "0 24px 60px rgba(0, 0, 0, 0.48)",
              padding: "40px 44px",
            }}
          >
            <h2
              style={{
                fontSize: "19px",
                fontWeight: 700,
                color: "#f8fafc",
                letterSpacing: "-0.02em",
                marginBottom: "8px",
              }}
            >
              {dryRun ? "Practice run" : "Before you begin"}
            </h2>
            <p
              style={{
                fontSize: "13px",
                color: "rgba(255,255,255,0.58)",
                marginBottom: "28px",
                lineHeight: 1.6,
              }}
            >
              {dryRun
                ? "Rehearse your exam-day setup now. Nothing is submitted, you won't enter a contest, and your machine is unlocked at the end. Takes about 2 minutes."
                : "This usually takes about 2 minutes."}
            </p>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "10px",
                marginBottom: "32px",
              }}
            >
              {[
                "Fullscreen and display check",
                "Device security and app scan",
                "Camera and face scan",
                "Microphone and network check",
              ].map((item) => (
                <div key={item} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div
                    style={{
                      width: "5px",
                      height: "5px",
                      borderRadius: "50%",
                      background: "rgb(var(--accent-rgb) / 0.7)",
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: "13px", color: "#ffffff" }}>{item}</span>
                </div>
              ))}
            </div>
            <p
              style={{
                fontSize: "12px",
                color: "rgba(255,255,255,0.45)",
                marginBottom: "32px",
                lineHeight: 1.6,
              }}
            >
              Do not close the app during setup. Your session will be interrupted if the window
              loses focus.
            </p>
            <button
              type="button"
              className="onb-btn onb-btn--primary"
              style={{ width: "100%" }}
              onClick={() => setCurrentStage(1)}
            >
              Begin setup
            </button>
          </div>
        )}

        {/* Stage content frame */}
        {currentStage > 0 && !dryRunComplete && (
          <div
            style={{
              maxWidth: "480px",
              width: "100%",
              background: "#0F0F0F",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: "var(--radius-lg)",
              boxShadow: "var(--elevation-3)",
              padding: "36px 40px",
              position: "relative",
              overflow: "hidden",
              transition: "var(--transition-standard)",
            }}
          >
            {/* Per-stage context strip */}
            {STAGE_META[currentStage] && (
              <div
                style={{
                  marginBottom: "20px",
                  paddingBottom: "16px",
                  borderBottom: "1px solid rgba(255,255,255,0.06)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                }}
              >
                <p
                  style={{
                    fontSize: "12px",
                    color: "rgba(255,255,255,0.45)",
                    lineHeight: 1.5,
                    margin: 0,
                  }}
                >
                  {STAGE_META[currentStage].checking}
                </p>
                {STAGE_META[currentStage].todo && (
                  <p
                    style={{
                      fontSize: "12px",
                      color: "var(--color-accent-base)",
                      lineHeight: 1.5,
                      margin: 0,
                    }}
                  >
                    → {STAGE_META[currentStage].todo}
                  </p>
                )}
              </div>
            )}

            {isTooEarly && (
              <div
                style={{
                  border: "1px solid rgba(245,158,11,0.35)",
                  background: "rgba(245,158,11,0.08)",
                  borderRadius: "var(--radius-lg)",
                  padding: "18px 16px",
                  color: "#fcd34d",
                  textAlign: "center",
                  marginBottom: 16,
                }}
              >
                <div style={{ fontSize: 19, fontWeight: 700, marginBottom: 8 }}>
                  Verification not open yet
                </div>
                <div style={{ fontSize: 13, color: "#fef3c7", marginBottom: 8 }}>
                  Opens in {formatCountdown(verifyOpensInMs)} ({contestWindow?.timezone || "UTC"})
                </div>
                <div style={{ fontSize: 12, color: "#a1a1aa" }}>
                  You can start setup only in the configured verification window before contest
                  start.
                </div>
              </div>
            )}
            {isAfterStart && !showWaitLock && (
              <div
                style={{
                  border: "1px solid rgba(239,68,68,0.35)",
                  background: "rgba(239,68,68,0.08)",
                  borderRadius: "var(--radius-lg)",
                  padding: "18px 16px",
                  color: "#fca5a5",
                  textAlign: "center",
                  marginBottom: 16,
                }}
              >
                Join window is closed once contest starts.
              </div>
            )}
            {isEnded && (
              <div
                style={{
                  border: "1px solid rgba(239,68,68,0.35)",
                  background: "rgba(239,68,68,0.08)",
                  borderRadius: "var(--radius-lg)",
                  padding: "18px 16px",
                  color: "#fca5a5",
                  textAlign: "center",
                  marginBottom: 16,
                }}
              >
                Contest has ended.
              </div>
            )}
            {!isTooEarly && (!isAfterStart || showWaitLock) && !isEnded && (
              <>
                {currentStage === 15 && !dryRun && contestWindow && waitMs > 0 && (
                  <div
                    style={{
                      border: "1px solid rgba(255, 255, 255, 0.05)",
                      background: "#0F0F0F",
                      borderRadius: 0,
                      padding: "32px 32px",
                      textAlign: "left",
                      fontFamily: "var(--font-mono), 'JetBrains Mono', 'Fira Code', monospace",
                      width: "100%",
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "130px 1fr",
                        rowGap: "14px",
                        fontSize: "13px",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ color: "rgba(255,255,255,0.58)" }}>Status</div>
                      <div style={{ color: "#22c55e" }}>Verification complete</div>

                      <div style={{ color: "rgba(255,255,255,0.58)" }}>Next step</div>
                      <div style={{ color: "#FFF" }}>Contest workspace</div>

                      <div style={{ color: "rgba(255,255,255,0.58)" }}>Contest controls</div>
                      <div style={{ color: "#FFF" }}>Ready</div>

                      <div style={{ color: "rgba(255,255,255,0.58)" }}>Action</div>
                      <div style={{ color: "var(--color-accent-base)" }}>
                        Waiting to enter contest...
                      </div>

                      <div
                        style={{
                          gridColumn: "1 / -1",
                          height: "1px",
                          background: "rgba(255,255,255,0.05)",
                          margin: "16px 0 8px 0",
                        }}
                      />

                      <div style={{ color: "rgba(255,255,255,0.58)" }}>Starts in</div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: "12px" }}>
                        <span
                          style={{
                            fontSize: "var(--text-2xl)",
                            fontWeight: 700,
                            color: "#FFFFFF",
                            lineHeight: 1,
                            letterSpacing: "-0.02em",
                          }}
                        >
                          {formatCountdown(waitMs)}
                        </span>
                        <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.58)" }}>
                          ({contestWindow.timezone || "UTC"})
                        </span>
                      </div>
                    </div>
                  </div>
                )}
                {currentStage === 15 && !dryRun && (!contestWindow || waitMs <= 0) && (
                  <div
                    style={{
                      border: "1px solid rgba(255, 255, 255, 0.05)",
                      background: "#0F0F0F",
                      borderRadius: 0,
                      padding: "32px 32px",
                      textAlign: "left",
                      fontFamily: "var(--font-mono), 'JetBrains Mono', 'Fira Code', monospace",
                      width: "100%",
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "130px 1fr",
                        rowGap: "14px",
                        fontSize: "13px",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ color: "rgba(255,255,255,0.58)" }}>Status</div>
                      <div style={{ color: "#22c55e" }}>Verification complete</div>

                      <div style={{ color: "rgba(255,255,255,0.58)" }}>Next step</div>
                      <div style={{ color: "#FFF" }}>Contest workspace</div>

                      <div style={{ color: "rgba(255,255,255,0.58)" }}>Contest controls</div>
                      <div style={{ color: "#FFF" }}>Ready</div>

                      <div style={{ color: "rgba(255,255,255,0.58)" }}>Action</div>
                      <div
                        style={{
                          color: "var(--color-accent-base)",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        Opening contest workspace...
                        <div
                          style={{
                            width: 12,
                            height: 12,
                            borderTop: "2px solid var(--color-accent-base)",
                            borderRight: "2px solid rgb(var(--accent-rgb) / 0.3)",
                            borderBottom: "2px solid rgb(var(--accent-rgb) / 0.3)",
                            borderLeft: "2px solid rgb(var(--accent-rgb) / 0.3)",
                            borderRadius: "50%",
                            animation: "spin 0.9s linear infinite",
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )}
                {currentStage === 1 && <Stage1_SessionIsolation onPass={advancePass} />}
                {currentStage === 2 && <Stage2_Fullscreen onPass={advancePass} />}
                {currentStage === 3 && (
                  <Stage3_MonitorDetection
                    onPass={advancePass}
                    platform={platform}
                    externalDisplayOverride={externalDisplayOverride}
                  />
                )}
                {currentStage === 4 && <Stage4_KeyboardLockdown onPass={advancePass} />}
                {currentStage === 5 && <Stage5_EnvironmentValidation onPass={advancePass} />}
                {currentStage === 6 && <Stage6_RestrictedApps onPass={advancePass} />}
                {currentStage === 7 && (
                  <Stage7_VMDetection onPass={advancePass} onWarn={advanceWarn} />
                )}
                {currentStage === 8 && (
                  <Stage8_CameraInit onPass={advancePass} onCameraReady={setCameraStream} />
                )}
                {currentStage === 9 && (
                  <Stage9_FaceCalibration
                    stream={cameraStream}
                    onPass={advancePass}
                    dryRun={dryRun}
                    onFaceFallback={handleFaceFallback}
                  />
                )}
                {currentStage === 10 && (
                  <Stage10_PresenceVerification stream={cameraStream} onPass={advancePass} />
                )}
                {currentStage === 11 && (
                  <Stage11_AudioVerification onPass={advancePass} onWarn={advanceWarn} />
                )}
                {currentStage === 12 && (
                  <Stage12_NetworkValidation onPass={advancePass} onWarn={advanceWarn} />
                )}
                {currentStage === 13 && (
                  <Stage13_IntegrityConfirmation results={results} onPass={advancePass} />
                )}
                {currentStage === 14 && <Stage14_LockInCountdown onPass={advancePass} />}
              </>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
        @keyframes pulse-ring { 0%,100% { box-shadow: 0 0 0 0 rgba(255,255,255,0.06); } 50% { box-shadow: 0 0 0 14px transparent; } }
        @keyframes scaleYBar { from { transform: scaleY(0.4); } to { transform: scaleY(1); } }
        @keyframes countdown-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>
    </main>
  );
}
