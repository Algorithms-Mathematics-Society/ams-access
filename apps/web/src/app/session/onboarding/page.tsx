"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@astryxdesign/core/AppShell";
import { Button } from "@astryxdesign/core/Button";
import { Banner } from "@astryxdesign/core/Banner";
import { Card } from "@astryxdesign/core/Card";
import { Divider } from "@astryxdesign/core/Divider";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import { Link } from "@astryxdesign/core/Link";
import { SetupContestContext } from "./components/SetupContestContext";
import { Spinner } from "./components/ui";

import {
  applyOrganizerOverrides,
  collectDeviceState,
  fetchOrganizerOverrides,
  startSecureSession,
  hasNativeBridge,
  browserDeviceState,
  strictContestPolicy,
  type OrganizerOverride,
} from "@ams/api-client";
import { fetchJson, SessionBindingError } from "@/lib/api-client";
import { authHeaders, participantToken } from "@/lib/candidate-auth";
import { getContest, serverNow, type ContestIndex } from "@/lib/proctor-api";
import { cameraSession } from "@/lib/camera-session";
import { blockedMessage, decideEntry, shouldRunChecks } from "./entry-gate";
import { isGatingRelaxed, warnGatingRelaxed } from "@/lib/gating";
import { decideNetworkLockdown } from "./network-gate";
import { readinessBlockMessage } from "./components/labels";
import { Stage1_Fullscreen } from "./components/stages/Stage1_Fullscreen";
import { Stage2_MonitorDetection } from "./components/stages/Stage2_MonitorDetection";
import { Stage3_KeyboardLockdown } from "./components/stages/Stage3_KeyboardLockdown";
import { Stage4_EnvironmentValidation } from "./components/stages/Stage4_EnvironmentValidation";
import { Stage5_RestrictedApps } from "./components/stages/Stage5_RestrictedApps";
import { Stage6_VMDetection } from "./components/stages/Stage6_VMDetection";
import { Stage7_CameraInit } from "./components/stages/Stage7_CameraInit";
import { Stage8_FaceCalibration } from "./components/stages/Stage8_FaceCalibration";
import { Stage9_PresenceVerification } from "./components/stages/Stage9_PresenceVerification";
import { Stage10_AudioVerification } from "./components/stages/Stage10_AudioVerification";
import { Stage11_NetworkValidation } from "./components/stages/Stage11_NetworkValidation";
import { Stage12_IntegrityConfirmation } from "./components/stages/Stage12_IntegrityConfirmation";
import { createStageAdvanceController } from "./components/stage-advance";
import { ProgressBar } from "./components/ProgressBar";
import { DryRunSummary } from "./components/DryRunSummary";

import {
  API_URL,
  FINAL_STAGE,
  REVIEW_STAGE,
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

// Astryx Kbd uses modifier glyphs; this shortcut intentionally spells out its keys.
function SetupExitShortcut() {
  return (
    <HStack
      as="span"
      className="setup-exit-shortcut"
      gap={1}
      align="center"
      role="img"
      aria-label="Control + Shift + Q"
      style={{ flexShrink: 0 }}
    >
      {["Ctrl", "Shift", "Q"].map((key) => (
        <kbd
          key={key}
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: "var(--spacing-5)",
            minHeight: "var(--spacing-5)",
            paddingInline: "var(--spacing-1)",
            borderRadius: "var(--radius-element)",
            border: "var(--border-width) solid var(--color-border)",
            background: "var(--color-background-muted)",
            color: "var(--color-text-secondary)",
            fontFamily: "var(--font-family-body)",
            fontSize: "var(--font-size-xs)",
            fontWeight: "var(--font-weight-medium)",
            lineHeight: 1,
          }}
        >
          {key}
        </kbd>
      ))}
    </HStack>
  );
}

// Tauri global typing for the direct window.__TAURI__ uses in this file.
declare const window: Window & {
  __TAURI__?: {
    core: { invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T> };
    window: {
      availableMonitors: () => Promise<MonitorInfo[]>;
      getCurrentWindow: () => {
        setFullscreen: (v: boolean) => Promise<void>;
        isFullscreen: () => Promise<boolean>;
        setAlwaysOnTop: (v: boolean) => Promise<void>;
        setDecorations: (v: boolean) => Promise<void>;
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
  const [warningDetails, setWarningDetails] = useState<Record<number, string>>({});
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [policyBlock, setPolicyBlock] = useState<string | null>(null);
  const [contestWindow, setContestWindow] = useState<ContestWindowMeta | null>(null);
  // The server's own view of the window, including `phase`. The entry gate is
  // derived from this rather than from local clock arithmetic.
  const [contestIndex, setContestIndex] = useState<ContestIndex | null>(null);
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
  // Render a stable shell during hydration; query-dependent copy is client-only.
  // This does not change the contest query, gates, checks or native effects.
  const [presentationReady, setPresentationReady] = useState(false);
  useEffect(() => setPresentationReady(true), []);
  const wideLayout = useMediaQuery("(min-width: 960px)");

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
      setCurrentStage(FINAL_STAGE);
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
    setCurrentStage(FINAL_STAGE);
    setReadyForStart(true);
    setPolicyBlock(null);
    setTransitioning(false);
  }, [isTestAccount]);

  // The camera is deliberately NOT released here. This effect used to stop
  // every track on unmount — and the unmount that matters is the one caused by
  // `router.push` into the contest, so the flow closed the camera device and
  // the contest room immediately reopened it. Two opens across a navigation
  // the candidate never asked for, on the hardware least willing to be
  // reopened quickly. `cameraSession` owns the stream now and outlives this
  // page; the release points are the emergency exit, a completed dry run, and
  // the end of the exam.

  useEffect(() => {
    if (!contestId) return;
    let cancelled = false;
    // `/participant/contests/{uid}` — authenticated, and it returns the
    // server's own `phase` and `server_time` alongside the window. The old
    // call went to `/contests/{id}`, a staff route, unauthenticated: it 403s
    // for a participant, so `contestWindow` stayed null and every client-side
    // time gate silently disabled itself.
    getContest(contestId)
      .then((index) => {
        if (cancelled) return;
        setContestIndex(index);
        setContestWindow({
          startAt: index.starts_at,
          endAt: index.ends_at,
          verificationWindowMinutes: index.verification_window_minutes,
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

  /**
   * Whether the server will let this candidate in, right now.
   *
   * Was 100 lines juggling `eligibility_status` and `session_window_state`
   * from `GET /contests/{id}/session-window` — a staff route, called
   * unauthenticated, which 403s for a participant. On 403 it returned
   * `state: "UNKNOWN"`, which fell through to a local fallback that returned
   * `{ ok: true }` whenever the window was also unknown. So the gate the
   * entire entry flow depended on silently evaporated.
   *
   * `/participant/contests/{uid}` returns the server's own `phase`, which is
   * the answer, so the whole thing is one call and one decision.
   */
  async function evaluateEntryGateFromServer() {
    if (!contestId) return { ok: false, reason: "Missing contest id.", state: "UNKNOWN" };
    if (isTestAccount) return { ok: true, reason: null as string | null, state: "LIVE" };
    try {
      const index = await getContest(contestId);
      setContestIndex(index);
      const decision = decideEntry(index, serverNow());
      return {
        ok: shouldRunChecks(decision),
        reason: blockedMessage(decision),
        state: decision.kind.toUpperCase(),
      };
    } catch {
      // Fail closed. Not knowing whether the contest is open is not a reason
      // to open it.
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
      // A dry run ends here rather than entering a contest, so the camera has
      // nothing left to serve.
      cameraSession.release();
      cameraStreamRef.current = null;
      setCameraStream(null);

      setReadyForStart(false);
      setTransitioning(false);
      setDryRunComplete(true);
      return;
    }

    // One authenticated call. `evaluateEntryGateFromServer` also refreshes
    // `contestIndex`, so the window and the decision cannot disagree — the
    // previous code fetched them separately and then reconciled two answers
    // with a `state === "UNKNOWN"` fallback that opened the gate whenever
    // both were unknown.
    const gate = await evaluateEntryGateFromServer();
    const windowMeta = contestWindow;

    if (!gate.ok && !isTestAccount) {
      setCurrentStage(REVIEW_STAGE);
      setTransitioning(false);
      setReadyForStart(false);
      setPolicyBlock(gate.reason);
      return;
    }

    if (windowMeta && !isTestAccount) {
      const remaining = new Date(windowMeta.startAt).getTime() - Date.now();
      if (remaining > 0) {
        setCurrentStage(FINAL_STAGE);
        setTransitioning(false);
        setReadyForStart(true);
        setPolicyBlock(null);
        return;
      }
    }
    const devices = await navigator.mediaDevices?.enumerateDevices?.().catch(() => []);
    // Outside the Tauri shell there is no native layer to ask, and
    // `collectDeviceState` throws "Tauri bridge unavailable" — which left
    // onboarding stuck for ever on "Checking contest entry…" with an uncaught
    // error behind it. Every native-only field stays null, which the readiness
    // evaluator reads as "not probed", so this cannot make an unsupervised
    // machine look supervised. A packaged build always has the bridge and so
    // always takes the real path below.
    const nativeAvailable = hasNativeBridge();
    const cameraLive =
      cameraStreamRef.current?.getVideoTracks().some((track) => track.readyState === "live") ||
      devices?.some((device) => device.kind === "videoinput") ||
      false;
    const microphoneLive = devices?.some((device) => device.kind === "audioinput") || false;
    const deviceState = !nativeAvailable
      ? browserDeviceState({
          cameraAvailable: cameraLive,
          microphoneAvailable: microphoneLive,
          platform: platform ?? null,
        })
      : await collectDeviceState({
          // Real connectivity probe (neutral canary host) feeds the readiness
          // gate. Under the test flag we skip it and force a healthy network.
          networkHost: isGatingRelaxed() ? undefined : getNetworkProbeHost(),
          apiUrl: API_URL,
          cameraAvailable: cameraLive,
          microphoneAvailable: microphoneLive,
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

      // Platform-aware strict policy. Prefer the platform reported by
      // collect_device_state (authoritative at start time); fall back to the
      // get_platform value resolved at mount. On Windows this makes camera /
      // external_display / remote_server required+block so the Rust-side
      // merge_requirements keeps the Windows enforcement; off-Windows they stay
      // advisory and behavior is unchanged.
      //
      // Resolved before the network gate below, which needs the same value.
      // `get_platform` reports only the coarse `os` ("windows"), and the gate's
      // whole decision turns on the native label — windows_no_firewall vs
      // windows_no_admin — which only collect_device_state carries.
      const devicePlatform = deviceState.platform ?? platform ?? undefined;

      // SEC-3: egress lockdown is the core anti-cheat control, so a build that
      // was meant to raise a firewall and did not get one enters anyway, with a
      // durable server-visible violation so the proctor can see the session ran
      // with open internet and weigh it against the rest of the signal.
      //
      // Nobody is stopped here. A privilege the candidate can decline cannot
      // carry a gate: it would fail open for anyone who says no and fall shut on
      // an ordinary unelevated machine that did nothing wrong. What survives is
      // whether a firewall was expected, which decides whether the open egress
      // is worth reporting. decideNetworkLockdown owns that; see network-gate.ts.
      // Outside the desktop shell (dev / browser preview) there is nothing to
      // lock, so this is skipped.
      const tauriBridge = window.__TAURI__;
      if (tauriBridge) {
        let engaged = false;
        let lockdownError: string | null = null;
        try {
          // Bound the call: a hung/half-installed helper must not freeze the
          // final stage. withTimeout rejects on timeout AND propagates the
          // helper's real error, so the record carries a usable reason.
          engaged = await withTimeout(
            tauriBridge.core.invoke<boolean>("enable_network_lockdown", {
              allowedDomains: [getNetworkLockdownAllowlistHost()],
            }),
            8000,
            "network lockdown timed out after 8s (helper unresponsive?)"
          );
        } catch (err) {
          lockdownError = err instanceof Error ? err.message : String(err);
        }

        const gate = decideNetworkLockdown({
          platform: devicePlatform ?? null,
          engaged,
          error: lockdownError,
          relaxed: isGatingRelaxed(),
        });

        // Recorded before the block check, not after — the blocked case is the
        // one an invigilator actually needs to read.
        if (gate.violation) {
          await invoke("log_violation", { kind: gate.eventKind, detail: gate.detail }).catch(
            () => {}
          );
        }
        await invoke("log_proctoring_event", {
          kind: gate.eventKind,
          detail: gate.detail,
          payload: {
            allowed_domains: [getNetworkLockdownAllowlistHost()],
            platform: devicePlatform ?? null,
          },
        }).catch(() => {});

        // No block. Egress lockdown needs privilege the shell does not hold and
        // the candidate can decline, so gating on it would fail open for anyone
        // unwilling and fall shut on an ordinary machine. The violation above is
        // the control; this is just the local trace of it.
        // The server-side violation above is the control. This is only the local
        // trace, and it must not claim TEST MODE: on a shipping build this path
        // is reached by an ordinary candidate who declined an admin prompt.
        if (gate.violation && isGatingRelaxed()) {
          warnGatingRelaxed(
            `network lockdown NOT engaged at launch (${gate.detail}) — entering contest with OPEN internet`
          );
        }
      }

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

      // Locks the desktop, arms the keyboard intercept and applies egress
      // rules — all native, none of which exist in a browser. Skipped there
      // rather than throwing: the session is already an unproctored dev one,
      // which the readiness modal states outright before letting anyone in.
      if (nativeAvailable)
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
          setCurrentStage(FINAL_STAGE);
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
          setCurrentStage(FINAL_STAGE);
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
      setCurrentStage(REVIEW_STAGE);
      setTransitioning(false);
      setReadyForStart(false);
      setPolicyBlock(msg);
    }
  }, [contestId, router, contestWindow, readyForStart, dryRun, platform, overrides, isTestAccount]);

  useEffect(() => {
    if (!contestWindow) return;
    if (currentStage !== FINAL_STAGE) return;
    if (waitMs <= 0 && readyForStart) {
      void finalizeSecureStart();
    }
  }, [contestWindow, currentStage, waitMs, contestId, readyForStart, finalizeSecureStart]);

  // Keep completion callbacks stable throughout a visit. Presentation changes
  // must not restart child checks, and old checks must not advance a later visit.
  const finalizeSecureStartRef = useRef(finalizeSecureStart);
  useLayoutEffect(() => {
    finalizeSecureStartRef.current = finalizeSecureStart;
  }, [finalizeSecureStart]);
  const stageRun = useMemo(() => ({ stage: currentStage }), [currentStage]);
  const advanceControllerRef = useRef<ReturnType<typeof createStageAdvanceController> | null>(null);
  if (!advanceControllerRef.current) {
    advanceControllerRef.current = createStageAdvanceController({
      finalStage: FINAL_STAGE,
      onBegin: (stage, status) => {
        setTransitioning(true);
        setResults((r) => ({ ...r, [stage]: status }));
        if (status !== "warn")
          setWarningDetails((previous) => {
            const next = { ...previous };
            delete next[stage];
            return next;
          });
      },
      onAdvance: (nextStage) => {
        setCurrentStage(nextStage);
        setTransitioning(false);
      },
      onFinalize: () => {
        void finalizeSecureStartRef.current();
      },
    });
  }
  const advanceController = advanceControllerRef.current;
  useLayoutEffect(() => {
    advanceController.activate(stageRun);
    // A policy jump or retry may supersede the pending animation timer.
    // Its cleanup cancels advancement, so reset that presentation state here.
    setTransitioning(false);
    return () => advanceController.deactivate(stageRun);
  }, [advanceController, stageRun]);

  const advance = useCallback(
    (status: StageStatus = "pass") => {
      advanceController.advance(stageRun, status);
    },
    [advanceController, stageRun]
  );
  const advancePass = useCallback(() => advance("pass"), [advance]);
  const advanceWarn = useCallback(
    (detail?: string) => {
      if (advanceController.advance(stageRun, "warn") && detail) {
        setWarningDetails((previous) => ({ ...previous, [stageRun.stage]: detail }));
      }
    },
    [advanceController, stageRun]
  );
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
    cameraSession.release();
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

  // One decision, from the server's own `phase`. This replaced
  // `isTooEarly`/`isAfterStart`/`isEnded`, three local clock comparisons
  // against a window fetched from a route that 403s — and `isAfterStart` in
  // particular was true for the whole contest, hiding every stage from anyone
  // who arrived after the start, **including every approved resume**.
  const entry = contestIndex ? decideEntry(contestIndex, serverNow()) : ({ kind: "open" } as const);
  const isTooEarly = isTestAccount ? false : entry.kind === "too_early";
  const isEnded = isTestAccount ? false : entry.kind === "ended";
  const verifyOpensInMs = entry.kind === "too_early" ? entry.opensInMs : 0;
  const canRunChecks = isTestAccount || shouldRunChecks(entry);
  const entryBlockedMessage = isTestAccount ? null : blockedMessage(entry);
  const showWaitLock = currentStage === FINAL_STAGE && readyForStart;

  // Frame budget: 1120px page, 248px progress rail, 40px gutter and a
  // flexible check panel. Below 960px, progress becomes a compact top region.
  return (
    <AppShell height="fill" variant="section" contentPadding={0} style={{ height: "100dvh" }}>
      <VStack
        data-onboarding-page
        gap={8}
        style={{
          width: "100%",
          maxWidth: "calc(var(--spacing-10) * 28)",
          minHeight: "100dvh",
          marginInline: "auto",
          padding: "clamp(var(--spacing-4), 4vw, var(--spacing-10))",
          fontFamily: "var(--font-sans)",
          color: "var(--color-text-primary)",
        }}
      >
        <HStack as="header" justify="between" align="center" gap={4} wrap="wrap">
          <HStack gap={3} align="center">
            <svg
              viewBox="0 0 176 166"
              fill="none"
              aria-hidden="true"
              style={{ width: "var(--spacing-6)", height: "var(--spacing-6)", flexShrink: 0 }}
            >
              <path d="M4 162L88 4L172 162" stroke="var(--color-accent-base)" strokeWidth="6" />
            </svg>
            <Text type="large" weight="semibold">
              Access
            </Text>
            <Text type="supporting" color="secondary">
              Device setup
            </Text>
          </HStack>
          <HStack gap={3} align="center" wrap="wrap">
            {wideLayout && <SetupExitShortcut />}
            <Button
              type="button"
              variant="secondary"
              label="Exit setup"
              onClick={() => void emergencyExit()}
              aria-label="Exit setup. Shortcut: Control Shift Q."
              aria-keyshortcuts="Control+Shift+Q"
              tooltip="Shortcut: Ctrl + Shift + Q"
            />
          </HStack>
        </HStack>
        <Divider />

        {!presentationReady ? (
          <VStack gap={4} align="center" style={{ paddingBlock: "var(--spacing-10)" }}>
            <Spinner />
            <Text color="secondary">Preparing your setup…</Text>
          </VStack>
        ) : (
          <>
            <SetupContestContext
              contest={contestIndex}
              dryRun={dryRun}
              hasContest={Boolean(contestId)}
              sponsorPlacement={
                !dryRun && !policyBlock && !entryBlockedMessage
                  ? currentStage === 0
                    ? "introduction"
                    : currentStage === FINAL_STAGE && readyForStart && waitMs > 0
                      ? "waiting"
                      : undefined
                  : undefined
              }
            />
            {policyBlock && (
              <Banner
                status={
                  platform === "macos" && policyBlock.includes("accessibility_denied")
                    ? "warning"
                    : "error"
                }
                title={
                  platform === "macos" && policyBlock.includes("accessibility_denied")
                    ? "Grant Accessibility permission"
                    : "Setup needs your attention"
                }
                role="alert"
                description={
                  platform === "macos" && policyBlock.includes("accessibility_denied") ? (
                    <VStack gap={4}>
                      <Text>
                        AMS Access needs Accessibility permission to block exam keyboard shortcuts.
                        Open System Settings, find AMS Access under Privacy &amp; Security →
                        Accessibility, and toggle it on. Then run the device check again.
                      </Text>
                      <HStack gap={3} wrap="wrap">
                        <Button
                          label="Open Accessibility settings"
                          onClick={() => void invoke("open_accessibility_settings")}
                        />
                        <Button
                          label="Run checks again"
                          variant="secondary"
                          onClick={() => {
                            setPolicyBlock(null);
                            setCurrentStage(4);
                          }}
                        />
                      </HStack>
                    </VStack>
                  ) : (
                    <Text style={{ whiteSpace: "pre-line", overflowWrap: "anywhere" }}>
                      {policyBlock}
                    </Text>
                  )
                }
              />
            )}
            {currentStage === 0 && !dryRunComplete && (
              <HStack
                gap={10}
                align="start"
                wrap="wrap"
                style={{ paddingBlock: "clamp(var(--spacing-4), 5vh, var(--spacing-10))" }}
              >
                <VStack gap={5} style={{ flex: "1 1 calc(var(--spacing-10) * 9)", minWidth: 0 }}>
                  <Text type="supporting" color="secondary">
                    {dryRun ? "PRACTICE SETUP" : "PRE-CONTEST SETUP"}
                  </Text>
                  <Heading
                    level={1}
                    style={{
                      fontSize: "clamp(var(--font-size-3xl), 3.5vw, var(--font-size-5xl))",
                      lineHeight: "var(--text-display-2-leading)",
                      maxWidth: "16ch",
                    }}
                  >
                    {dryRun ? "Get familiar with your setup." : "A few checks. Then you’re ready."}
                  </Heading>
                  <Text
                    type="large"
                    color="secondary"
                    style={{ maxWidth: "40ch", fontWeight: "var(--font-weight-normal)" }}
                  >
                    {dryRun
                      ? "Rehearse your exam-day setup. Nothing is submitted, and you won’t enter a contest."
                      : "We’ll guide you through your device and camera checks before you enter the contest."}
                  </Text>
                  <Text color="secondary">
                    Allow a few minutes. Some steps may need your permission.
                  </Text>
                  <Link href="/privacy">Read the privacy policy before setup</Link>
                  <Text type="supporting" color="secondary" style={{ maxWidth: "48ch" }}>
                    Keep this app open during setup. If you need to leave, use Exit setup so the app
                    can restore your device settings.
                  </Text>
                </VStack>
                <VStack gap={6} style={{ flex: "1 1 calc(var(--spacing-10) * 10)", minWidth: 0 }}>
                  <VStack
                    gap={0}
                    as="ol"
                    aria-label="What setup checks"
                    style={{ listStyle: "none", margin: 0, padding: 0 }}
                  >
                    {[
                      ["Your workspace", "Fullscreen, connected displays and keyboard setup."],
                      ["Your device", "Restricted apps and device compatibility."],
                      ["Your camera", "Camera access, face scan and presence check."],
                      ["Audio & connection", "Microphone access and connection checks."],
                    ].map(([title, detail], index) => (
                      <HStack
                        as="li"
                        key={title}
                        gap={4}
                        align="start"
                        style={{
                          paddingBlock: "var(--spacing-5)",
                          borderBottom: "var(--border-width) solid var(--color-border)",
                        }}
                      >
                        <Text
                          type="supporting"
                          color="secondary"
                          style={{
                            paddingTop: "var(--spacing-1)",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          0{index + 1}
                        </Text>
                        <VStack gap={1} style={{ minWidth: 0 }}>
                          <Text weight="semibold">{title}</Text>
                          <Text color="secondary">{detail}</Text>
                        </VStack>
                      </HStack>
                    ))}
                  </VStack>
                  <Button
                    type="button"
                    variant="primary"
                    size="lg"
                    label="Begin setup"
                    onClick={() => setCurrentStage(1)}
                    style={{
                      width: "100%",
                      minHeight: "calc(var(--spacing-10) + var(--spacing-1))",
                    }}
                  />
                  <Text type="supporting" color="secondary">
                    {dryRun
                      ? "A practice run helps you find issues before exam day."
                      : "Your contest’s requirements determine whether you can continue."}
                  </Text>
                </VStack>
              </HStack>
            )}

            {dryRunComplete && (
              <VStack
                style={{
                  width: "100%",
                  maxWidth: "calc(var(--spacing-10) * 20)",
                  marginInline: "auto",
                }}
              >
                <DryRunSummary
                  results={results}
                  warningDetails={warningDetails}
                  networkOutcome={dryRunNetwork}
                  onDone={() => router.push("/home")}
                />
              </VStack>
            )}

            {currentStage > 0 && !dryRunComplete && (
              <HStack
                gap={10}
                align="start"
                style={{
                  flexDirection: wideLayout ? "row" : "column",
                  paddingBottom: "var(--spacing-8)",
                }}
              >
                <VStack
                  as="aside"
                  style={{
                    width: wideLayout ? "calc(var(--spacing-8) * 8)" : "100%",
                    flexShrink: 0,
                  }}
                >
                  <ProgressBar
                    current={currentStage}
                    results={results}
                    compact={!wideLayout}
                    blocked={Boolean(policyBlock) || Boolean(entryBlockedMessage)}
                  />
                </VStack>
                <VStack gap={5} style={{ flex: 1, width: "100%", minWidth: 0 }}>
                  <Heading level={1} style={{ fontSize: "var(--font-size-xl)" }}>
                    {dryRun ? "Practice setup" : "Pre-contest setup"}
                  </Heading>
                  <Card
                    padding={0}
                    style={{
                      width: "100%",
                      minWidth: 0,
                      border: 0,
                      borderRadius: "var(--radius-container)",
                      background: "var(--color-background-card)",
                    }}
                  >
                    <VStack
                      gap={5}
                      data-onboarding-stage={currentStage}
                      style={{
                        padding: "clamp(var(--spacing-4), 3vw, var(--spacing-8))",
                        minWidth: 0,
                        opacity: transitioning ? 0.5 : 1,
                      }}
                    >
                      {isTooEarly && (
                        <Banner
                          status="warning"
                          title="Verification not open yet"
                          description={
                            <VStack gap={2}>
                              <Text>
                                Opens in {formatCountdown(verifyOpensInMs)} (
                                {contestWindow?.timezone || "UTC"})
                              </Text>
                              <Text>
                                You can start setup only in the configured verification window
                                before contest start.
                              </Text>
                            </VStack>
                          }
                        />
                      )}
                      {isEnded && (
                        <Banner
                          status="error"
                          title="Contest has ended"
                          description="Return home to review your contests."
                        />
                      )}
                      {canRunChecks && (
                        <>
                          {STAGE_META[currentStage] && (
                            <VStack
                              gap={2}
                              style={{
                                paddingBottom: "var(--spacing-4)",
                                borderBottom: "var(--border-width) solid var(--color-border)",
                              }}
                            >
                              <Text type="supporting" color="secondary">
                                {STAGE_META[currentStage].checking}
                              </Text>
                              {STAGE_META[currentStage].todo && (
                                <Text weight="medium">{STAGE_META[currentStage].todo}</Text>
                              )}
                            </VStack>
                          )}
                          {currentStage === FINAL_STAGE && dryRun && (
                            <VStack gap={4} role="status">
                              <Heading level={2}>Finishing your practice setup.</Heading>
                              <Text color="secondary">
                                Keep this window open while the app finishes its checks and restores
                                your device settings.
                              </Text>
                              <HStack gap={3} align="center">
                                <Spinner />
                                <Text type="supporting" color="secondary">
                                  Preparing your setup summary…
                                </Text>
                              </HStack>
                            </VStack>
                          )}
                          {currentStage === FINAL_STAGE &&
                            !dryRun &&
                            contestWindow &&
                            waitMs > 0 && (
                              <VStack gap={5}>
                                <Heading level={2}>
                                  {readyForStart
                                    ? "Ready for the start."
                                    : "Preparing your contest."}
                                </Heading>
                                <Text color="secondary">
                                  {readyForStart
                                    ? "Your workspace will open automatically when the contest begins. Keep this app open."
                                    : "Wait while your entry checks finish."}
                                </Text>
                                <VStack gap={2}>
                                  <Text type="supporting" color="secondary">
                                    Starts in
                                  </Text>
                                  <Text
                                    style={{
                                      fontSize: "var(--font-size-4xl)",
                                      fontVariantNumeric: "tabular-nums",
                                      lineHeight: "var(--text-display-1-leading)",
                                    }}
                                  >
                                    {formatCountdown(waitMs)}
                                  </Text>
                                  <Text type="supporting" color="secondary">
                                    {contestWindow.timezone || "UTC"}
                                  </Text>
                                </VStack>
                              </VStack>
                            )}
                          {currentStage === FINAL_STAGE &&
                            !dryRun &&
                            (!contestWindow || waitMs <= 0) && (
                              <VStack gap={4}>
                                <Heading level={2}>Opening your contest.</Heading>
                                <Text color="secondary">
                                  Keep this window open while your secure workspace is prepared.
                                </Text>
                                <HStack gap={3} align="center">
                                  <Spinner />
                                  <Text type="supporting" color="secondary">
                                    Checking contest entry…
                                  </Text>
                                </HStack>
                              </VStack>
                            )}
                          {currentStage === 1 && (
                            <Stage1_Fullscreen onPass={advancePass} onWarn={advanceWarn} />
                          )}
                          {currentStage === 2 && (
                            <Stage2_MonitorDetection
                              onPass={advancePass}
                              platform={platform}
                              externalDisplayOverride={externalDisplayOverride}
                            />
                          )}
                          {currentStage === 3 && (
                            <Stage3_KeyboardLockdown onPass={advancePass} onWarn={advanceWarn} />
                          )}
                          {currentStage === 4 && (
                            <Stage4_EnvironmentValidation onPass={advancePass} />
                          )}
                          {currentStage === 5 && (
                            <Stage5_RestrictedApps onPass={advancePass} onWarn={advanceWarn} />
                          )}
                          {currentStage === 6 && (
                            <Stage6_VMDetection onPass={advancePass} onWarn={advanceWarn} />
                          )}
                          {currentStage === 7 && (
                            <Stage7_CameraInit
                              onPass={advancePass}
                              onCameraReady={setCameraStream}
                            />
                          )}
                          {currentStage === 8 && (
                            <Stage8_FaceCalibration
                              stream={cameraStream}
                              onPass={advancePass}
                              dryRun={dryRun}
                              onFaceFallback={handleFaceFallback}
                            />
                          )}
                          {currentStage === 9 && (
                            <Stage9_PresenceVerification
                              stream={cameraStream}
                              onPass={advancePass}
                              onWarn={advanceWarn}
                            />
                          )}
                          {currentStage === 10 && (
                            <Stage10_AudioVerification onPass={advancePass} onWarn={advanceWarn} />
                          )}
                          {currentStage === 11 && (
                            <Stage11_NetworkValidation onPass={advancePass} onWarn={advanceWarn} />
                          )}
                          {currentStage === REVIEW_STAGE && (
                            <Stage12_IntegrityConfirmation
                              results={results}
                              warningDetails={warningDetails}
                              onPass={advancePass}
                              blocked={Boolean(policyBlock) || Boolean(entryBlockedMessage)}
                            />
                          )}
                        </>
                      )}
                    </VStack>
                  </Card>
                  {wideLayout ? (
                    <Text type="supporting" color="secondary">
                      Need to leave? Exit setup is always available at the top of this page.
                    </Text>
                  ) : (
                    <HStack gap={2} align="center" wrap="wrap">
                      <Text type="supporting" color="secondary">
                        Exit setup at the top, or press
                      </Text>
                      <SetupExitShortcut />
                    </HStack>
                  )}
                </VStack>
              </HStack>
            )}
          </>
        )}
      </VStack>
    </AppShell>
  );
}
