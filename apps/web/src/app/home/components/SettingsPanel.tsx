"use client";

import { useState, useEffect, useRef, useMemo, memo } from "react";
import type { Dispatch, SetStateAction } from "react";
import { invoke } from "@ams/api-client";
import {
  getThemeColors,
  describeMediaError,
  getUserMediaWithTimeout,
  isCameraReleaseRaceError,
  sleep,
  CAMERA_RETRY_DELAY_MS,
  CAMERA_START_TIMEOUT_MS,
} from "./utils";
import type { ReadinessState, SecurityLogLevel, TelemetryQueryState } from "./types";

function PermissionLine({
  label,
  enabled,
  description,
  theme,
}: {
  label: string;
  enabled: boolean;
  description: string;
  theme: "dark" | "light";
}) {
  const c = useMemo(() => getThemeColors(theme), [theme]);
  return (
    <div
      style={{
        background: c.cardBg,
        border: `1px solid ${c.border}`,
        borderRadius: "var(--radius-md)",
        padding: "18px 22px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "20px",
      }}
    >
      <div>
        <h4 style={{ fontSize: "13px", fontWeight: 600, color: c.text, marginBottom: "4px" }}>
          {label}
        </h4>
        <p style={{ fontSize: "12px", color: c.textMuted, lineHeight: 1.4 }}>{description}</p>
      </div>
      <span
        style={{
          fontSize: "11px",
          fontWeight: 600,
          color: enabled ? "var(--home-status-ok)" : "#f59e0b",
          background: enabled ? "var(--home-status-ok-bg)" : "rgba(245,158,11,0.08)",
          border: `1px solid ${enabled ? "var(--home-status-ok-border)" : "rgba(245,158,11,0.2)"}`,
          padding: "4px 10px",
          borderRadius: "var(--radius-sm)",
          letterSpacing: "0.04em",
        }}
      >
        {enabled ? "Allowed" : "Denied"}
      </span>
    </div>
  );
}

function SecurityInfoRow({
  label,
  val,
  secure,
  theme,
}: {
  label: string;
  val: string;
  secure: boolean;
  theme: "dark" | "light";
}) {
  const c = useMemo(() => getThemeColors(theme), [theme]);
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "8px 12px",
        background: c.innerBg,
        border: `1px solid ${c.border}`,
        borderRadius: "var(--radius-sm)",
        alignItems: "center",
      }}
    >
      <span style={{ fontSize: "12px", color: c.textMutedStrong }}>{label}</span>
      <span
        style={{
          fontSize: "11px",
          fontFamily: "'JetBrains Mono', monospace",
          color: secure ? "var(--home-status-ok)" : "#ef4444",
        }}
      >
        {val}
      </span>
    </div>
  );
}

function ProcessListItem({
  name,
  restricted,
  theme,
}: {
  name: string;
  restricted: boolean;
  theme: "dark" | "light";
}) {
  const c = useMemo(() => getThemeColors(theme), [theme]);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 14px",
        background: c.innerBg,
        border: `1px solid ${c.border}`,
        borderRadius: "var(--radius-sm)",
      }}
    >
      <span style={{ fontSize: "12px", color: c.text }}>{name}</span>
      <span
        style={{
          fontSize: "11px",
          fontFamily: "'JetBrains Mono', monospace",
          color: restricted ? "#ef4444" : "var(--home-status-ok)",
          background: restricted ? "rgba(239,68,68,0.08)" : "var(--home-status-ok-bg)",
          padding: "2px 6px",
          borderRadius: "var(--radius-sm)",
        }}
      >
        {restricted ? "FLAGGED" : "CLEARED"}
      </span>
    </div>
  );
}

/**
 * Manual recovery control. Lockdown disables the macOS trackpad space-switch
 * gestures (via a persisted `defaults write`), holds the screen awake with a
 * `caffeinate` child, installs a keyboard intercept, and locks outbound network
 * at the firewall. All of that is unwound automatically when a contest ends or
 * the app exits — but if the app was force-quit or crashed mid-session, the
 * teardown never ran and the candidate is left with a half-locked machine
 * (most visibly: three/four-finger swipe stops working). This card lets them
 * put everything back without waiting for the next launch's crash recovery.
 *
 * Every call is best-effort and idempotent: running it when nothing is locked
 * is a harmless no-op, so it is always safe to press.
 */
const RestoreLockdownCard = memo(function RestoreLockdownCard({
  theme,
  onSecurityEvent,
}: {
  theme: "dark" | "light";
  onSecurityEvent: (event: string, level?: SecurityLogLevel) => void;
}) {
  const c = useMemo(() => getThemeColors(theme), [theme]);
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [detail, setDetail] = useState<string | null>(null);

  async function restore() {
    setStatus("working");
    setDetail(null);
    // unlock_desktop is the important one — it restores the trackpad gesture
    // prefs and reaps caffeinate. The other two clear the keyboard intercept
    // and flush the firewall allowlist. Independent and idempotent, so run them
    // together and report on the aggregate.
    const results = await Promise.allSettled([
      invoke("unlock_desktop"),
      invoke("disable_keyboard_intercept"),
      invoke("disable_network_lockdown"),
    ]);

    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    // Thrown by the api-client when not running inside the desktop shell.
    if (rejected.some((r) => String(r.reason).includes("bridge unavailable"))) {
      setStatus("error");
      setDetail("Recovery is only available inside the AMS Access desktop app.");
      return;
    }
    if (rejected.length > 0) {
      setStatus("error");
      setDetail(
        "Some settings could not be restored automatically. Relaunch AMS Access — it re-runs recovery on startup — or restart your Mac."
      );
      onSecurityEvent("RECOVERY: manual restore reported errors", "warn");
      return;
    }
    setStatus("done");
    setDetail(
      "Trackpad gestures, keyboard shortcuts, screen sleep, and network access have been restored."
    );
    onSecurityEvent("RECOVERY: system settings restored by user");
  }

  const working = status === "working";
  const accentBorder =
    status === "done"
      ? "rgba(34,197,94,0.3)"
      : status === "error"
        ? "rgba(239,68,68,0.3)"
        : c.border;

  return (
    <div
      style={{
        background: c.cardBg,
        border: `1px solid ${accentBorder}`,
        borderRadius: "var(--radius-md)",
        padding: "20px 22px",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "20px",
        }}
      >
        <div>
          <h4 style={{ fontSize: "13px", fontWeight: 600, color: c.text, marginBottom: "4px" }}>
            Restore device after a contest
          </h4>
          <p style={{ fontSize: "12px", color: c.textMuted, lineHeight: 1.5, maxWidth: "520px" }}>
            Re-enables trackpad swipe gestures, keyboard shortcuts, screen sleep, and full internet
            access. Use this if a session ended unexpectedly and your Mac still feels locked down —
            for example if three-finger swipe between desktops stopped working.
          </p>
        </div>
        <button
          onClick={() => void restore()}
          disabled={working}
          style={{
            flexShrink: 0,
            width: "auto",
            padding: "0 16px",
            minHeight: 40,
            background: c.accentLight,
            border: `1px solid ${c.accentBorder}`,
            borderRadius: "var(--radius-sm)",
            color: c.accentText,
            fontSize: "13px",
            fontWeight: 600,
            cursor: working ? "not-allowed" : "pointer",
            opacity: working ? 0.7 : 1,
            transition: "background var(--transition-fast), border-color var(--transition-fast)",
          }}
        >
          {working ? "Restoring..." : "Restore System Settings"}
        </button>
      </div>
      {detail && (
        <p
          style={{
            fontSize: "12px",
            lineHeight: 1.5,
            color:
              status === "done"
                ? "var(--home-status-ok)"
                : status === "error"
                  ? "#f87171"
                  : c.textMuted,
          }}
        >
          {detail}
        </p>
      )}
    </div>
  );
});

export const SettingsPanel = memo(function SettingsPanel({
  readiness,
  setReadiness,
  theme,
  onSecurityEvent,
  telemetry,
  refreshTelemetry,
}: {
  readiness: ReadinessState;
  setReadiness: Dispatch<SetStateAction<ReadinessState>>;
  theme: "dark" | "light";
  onSecurityEvent: (event: string, level?: SecurityLogLevel) => void;
  telemetry: TelemetryQueryState;
  refreshTelemetry: (force?: boolean, source?: string) => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<"hardware" | "permissions" | "security" | "about">(
    "hardware"
  );
  const [camStream, setCamStream] = useState<MediaStream | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCam, setSelectedCam] = useState("");
  const [camStats, setCamStats] = useState({
    resolution: "1280 x 720 px",
    fps: "30 FPS",
    aspect: "16:9",
  });
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const cameraTestInFlightRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const c = useMemo(() => getThemeColors(theme), [theme]);

  const [micLevel, setMicLevel] = useState(0);
  const [micActive, setMicActive] = useState(false);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const [speakerActive, setSpeakerActive] = useState(false);
  const [speakerVolume, setSpeakerVolume] = useState(50);
  const [speakerSuccess, setSpeakerSuccess] = useState<boolean | null>(null);

  const platformInfo = telemetry.platform;
  const securityEnv = telemetry.env;
  const processScan = telemetry.processes;
  const virtScan = telemetry.virt;
  const networkCheck = telemetry.network;
  const securityBusy = telemetry.isLoading;
  const lastScannedLabel = useMemo(
    () =>
      telemetry.lastScannedAt
        ? new Date(telemetry.lastScannedAt).toLocaleTimeString([], { hour12: false })
        : "not scanned",
    [telemetry.lastScannedAt]
  );

  const camStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  useEffect(() => {
    camStreamRef.current = camStream;
  }, [camStream]);
  useEffect(() => {
    micStreamRef.current = micStream;
  }, [micStream]);

  useEffect(() => {
    return () => {
      camStreamRef.current?.getTracks().forEach((track) => track.stop());
      micStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    if (camStream && videoRef.current) {
      videoRef.current.srcObject = camStream;
      videoRef.current.play().catch(() => {});
    }
  }, [camStream]);

  useEffect(() => {
    if (!camStream) return;
    const videoTrack = camStream.getVideoTracks()[0];
    if (!videoTrack) return;

    function handleTrackEnded() {
      setCamStream(null);
      setCameraError("Camera stream ended unexpectedly. Click to restart.");
      setReadiness((r) => ({ ...r, camera: "fail" }));
    }

    videoTrack.addEventListener("ended", handleTrackEnded);
    return () => {
      videoTrack.removeEventListener("ended", handleTrackEnded);
    };
  }, [camStream, setReadiness]);

  useEffect(() => {
    if (activeTab !== "hardware" && camStream) {
      camStream.getTracks().forEach((track) => track.stop());
      setCamStream(null);
    }
  }, [activeTab, camStream]);

  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((devices) => {
        setCameras(devices.filter((d) => d.kind === "videoinput"));
      })
      .catch(() => {});
    void refreshTelemetry(false, "SETTINGS");
  }, [refreshTelemetry]);

  async function runSecurityScan(force = false) {
    await refreshTelemetry(force, "SETTINGS");
  }

  async function startCameraTest() {
    if (cameraTestInFlightRef.current) return;
    cameraTestInFlightRef.current = true;
    setCameraBusy(true);
    setCameraError(null);

    try {
      if (camStream) {
        camStream.getTracks().forEach((track) => track.stop());
        setCamStream(null);
        await sleep(0);
      }

      const constraints: MediaStreamConstraints = {
        video: selectedCam
          ? { deviceId: { exact: selectedCam }, width: { ideal: 640 }, height: { ideal: 480 } }
          : { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
      };

      let stream: MediaStream | null = null;
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          stream = await getUserMediaWithTimeout(constraints, CAMERA_START_TIMEOUT_MS);
          break;
        } catch (err) {
          lastError = err;
          if (attempt === 1 || !isCameraReleaseRaceError(err)) break;
          await sleep(CAMERA_RETRY_DELAY_MS);
        }
      }

      if (!stream) throw lastError ?? new Error("Camera unavailable");

      setCamStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play().catch(() => {});
      }

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const settings = videoTrack.getSettings();
        const width = settings.width || 1280;
        const height = settings.height || 720;
        const frameRate = settings.frameRate || 30;
        setCamStats({
          resolution: `${width} x ${height} px`,
          fps: `${Math.round(frameRate)} FPS`,
          aspect: getAspectRatioLabel(width, height),
        });
      }

      void navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => setCameras(devices.filter((d) => d.kind === "videoinput")))
        .catch(() => {});
      setReadiness((r) => ({ ...r, camera: "ok" }));
      onSecurityEvent("HARDWARE: Camera stream verified");
    } catch (err) {
      console.error("Camera setup failed", err);
      setCameraError(describeMediaError(err, "camera"));
      setReadiness((r) => ({ ...r, camera: "fail" }));
      onSecurityEvent("HARDWARE: Camera stream verification failed", "error");
    } finally {
      cameraTestInFlightRef.current = false;
      setCameraBusy(false);
    }
  }

  function getAspectRatioLabel(w: number, h: number) {
    if (w / h === 16 / 9) return "16:9 Widescreen";
    if (w / h === 4 / 3) return "4:3 Standard";
    return `${(w / h).toFixed(2)}:1`;
  }

  async function toggleMicMonitor() {
    if (micActive) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (micStream) {
        micStream.getTracks().forEach((track) => track.stop());
      }
      if (audioContextRef.current) {
        await audioContextRef.current.close().catch(() => {});
      }
      setMicStream(null);
      setMicLevel(0);
      setMicActive(false);
      onSecurityEvent("HARDWARE: Microphone monitor stopped");
    } else {
      try {
        setMicError(null);
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setMicStream(stream);

        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtx();
        audioContextRef.current = ctx;

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyserRef.current = analyser;

        const source = ctx.createMediaStreamSource(stream);
        source.connect(analyser);

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const drawMicStats = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
          }
          const average = sum / bufferLength;
          const scaledVal = Math.min(Math.round((average / 90) * 100), 100);
          setMicLevel(scaledVal);
          animationFrameRef.current = requestAnimationFrame(drawMicStats);
        };
        drawMicStats();
        setMicActive(true);
        setReadiness((r) => ({ ...r, mic: "ok" }));
        onSecurityEvent("HARDWARE: Microphone stream verified");
      } catch (err) {
        console.error("Microphone capture failed", err);
        setMicError(describeMediaError(err, "microphone"));
        setReadiness((r) => ({ ...r, mic: "fail" }));
        onSecurityEvent("HARDWARE: Microphone stream verification failed", "error");
      }
    }
  }

  function testSpeakers() {
    setSpeakerActive(true);
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(440, audioCtx.currentTime);

      const volFraction = speakerVolume / 100;
      gainNode.gain.setValueAtTime(volFraction * 0.08, audioCtx.currentTime);

      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      osc.start();
      setTimeout(() => {
        osc.stop();
        audioCtx.close().catch(() => {});
        setSpeakerActive(false);
      }, 850);
    } catch (e) {
      console.error(e);
      setSpeakerActive(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "560px" }}>
      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          borderBottom: `1px solid ${c.border}`,
          marginBottom: "28px",
        }}
      >
        {(["hardware", "permissions", "security", "about"] as const).map((tab) => {
          const labels: Record<string, string> = {
            hardware: "Hardware Diagnostics",
            permissions: "Permissions Check",
            security: "Security Environment",
            about: "About / Legal",
          };
          const active = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: "12px 0",
                paddingBottom: "14px",
                marginRight: "28px",
                background: "transparent",
                border: "none",
                borderBottom: active ? `2px solid ${c.accent}` : "2px solid transparent",
                color: active ? c.text : c.textMuted,
                fontSize: "14px",
                fontWeight: active ? 600 : 400,
                cursor: "pointer",
                transition: "color var(--transition-fast), border-color var(--transition-fast)",
                outline: "none",
              }}
            >
              {labels[tab]}
            </button>
          );
        })}
      </div>

      {/* Settings Sub-Tab panels */}
      <div>
        {activeTab === "hardware" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
            {/* Camera Validation Capture card — full width */}
            <div
              style={{
                background: c.cardBg,
                border: `1px solid ${c.border}`,
                borderRadius: "var(--radius-md)",
                padding: "24px",
                display: "flex",
                flexDirection: "column",
                gap: "16px",
              }}
            >
              {/* Card header: title + status dot */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <h4 style={{ fontSize: "14px", fontWeight: 600, color: c.text }}>
                  Camera Validation Capture
                </h4>
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: camStream ? "#22c55e" : "#f59e0b",
                    display: "inline-block",
                    flexShrink: 0,
                  }}
                />
              </div>

              {/* 2-col inner: viewfinder | controls */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "20px",
                  alignItems: "start",
                }}
              >
                {/* Viewfinder */}
                <div
                  style={{
                    position: "relative",
                    width: "100%",
                    aspectRatio: "16 / 9",
                    borderRadius: "var(--radius-md)",
                    background: c.innerBg,
                    overflow: "hidden",
                    border: `1px solid ${c.border}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {camStream ? (
                    <video
                      ref={videoRef}
                      muted
                      playsInline
                      autoPlay
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        transform: "scaleX(-1)",
                      }}
                    />
                  ) : (
                    <span
                      style={{
                        fontSize: "11px",
                        fontFamily: "'JetBrains Mono', monospace",
                        letterSpacing: "0.08em",
                        color: c.textMuted,
                      }}
                    >
                      CAPTURE DISCONNECTED
                    </span>
                  )}

                  {/* Corner-bracket viewfinder overlays */}
                  <div
                    style={{
                      position: "absolute",
                      top: "12px",
                      left: "12px",
                      width: "16px",
                      height: "16px",
                      borderTop: `2px solid ${c.accent}`,
                      borderLeft: `2px solid ${c.accent}`,
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      top: "12px",
                      right: "12px",
                      width: "16px",
                      height: "16px",
                      borderTop: `2px solid ${c.accent}`,
                      borderRight: `2px solid ${c.accent}`,
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      bottom: "12px",
                      left: "12px",
                      width: "16px",
                      height: "16px",
                      borderBottom: `2px solid ${c.accent}`,
                      borderLeft: `2px solid ${c.accent}`,
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      bottom: "12px",
                      right: "12px",
                      width: "16px",
                      height: "16px",
                      borderBottom: `2px solid ${c.accent}`,
                      borderRight: `2px solid ${c.accent}`,
                    }}
                  />
                </div>

                {/* Controls column */}
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {/* CAPTURE DEVICE label + select */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        color: c.textMuted,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >
                      Capture Device
                    </span>
                    <select
                      aria-label="Camera interface"
                      value={selectedCam}
                      onChange={(e) => setSelectedCam(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "10px 14px",
                        background: c.innerBg,
                        border: `1px solid ${c.border}`,
                        borderRadius: "var(--radius-sm)",
                        color: cameras.length > 0 ? c.text : c.textMuted,
                        fontSize: "13px",
                        outline: "2px solid transparent",
                        cursor: "pointer",
                        colorScheme: theme === "dark" ? "dark" : "light",
                      }}
                    >
                      {cameras.length > 0 ? (
                        cameras.map((cam) => (
                          <option key={cam.deviceId} value={cam.deviceId}>
                            {cam.label || `Interface ${cam.deviceId.slice(0, 6)}`}
                          </option>
                        ))
                      ) : (
                        <option value="">No device detected</option>
                      )}
                    </select>
                  </div>

                  {/* Initialize Capture Feed + Re-scan devices */}
                  <div style={{ display: "flex", gap: "10px" }}>
                    <button
                      onClick={() => startCameraTest()}
                      disabled={cameraBusy}
                      style={{
                        flex: 1,
                        padding: "0 12px",
                        minHeight: 40,
                        background: c.accentLight,
                        border: `1px solid ${c.accentBorder}`,
                        borderRadius: "var(--radius-sm)",
                        color: c.accentText,
                        fontSize: "13px",
                        fontWeight: 500,
                        cursor: cameraBusy ? "not-allowed" : "pointer",
                        opacity: cameraBusy ? 0.72 : 1,
                        transition:
                          "background var(--transition-fast), border-color var(--transition-fast)",
                      }}
                    >
                      {cameraBusy
                        ? "Starting..."
                        : camStream
                          ? "Restart Capture Feed"
                          : "Initialize Capture Feed"}
                    </button>
                    <button
                      onClick={() =>
                        void navigator.mediaDevices
                          ?.enumerateDevices()
                          .then((ds) => setCameras(ds.filter((d) => d.kind === "videoinput")))
                          .catch(() => {})
                      }
                      style={{
                        flex: 1,
                        padding: "0 12px",
                        minHeight: 40,
                        background: "transparent",
                        border: `1px solid ${c.border}`,
                        borderRadius: "var(--radius-sm)",
                        color: c.textMuted,
                        fontSize: "13px",
                        cursor: "pointer",
                        transition:
                          "border-color var(--transition-fast), color var(--transition-fast)",
                      }}
                    >
                      Re-scan devices
                    </button>
                  </div>

                  {/* Streaming badge */}
                  {camStream && (
                    <span
                      style={{
                        fontSize: "11px",
                        color: "var(--home-status-ok)",
                        fontFamily: "'JetBrains Mono', monospace",
                        background: "var(--home-status-ok-bg)",
                        padding: "3px 8px",
                        borderRadius: "var(--radius-sm)",
                        display: "inline-block",
                        alignSelf: "flex-start",
                      }}
                    >
                      STREAMING ACTIVE
                    </span>
                  )}

                  {/* Camera error */}
                  {cameraError && (
                    <p style={{ fontSize: "12px", color: "#f87171", lineHeight: 1.5 }}>
                      {cameraError}. Run the app as your normal desktop user and close other apps
                      using the camera.
                    </p>
                  )}

                  {/* Stream stats */}
                  {camStream && (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr 1fr",
                        gap: "10px",
                        background: c.innerBg,
                        padding: "12px 16px",
                        borderRadius: "var(--radius-sm)",
                        border: `1px solid ${c.border}`,
                      }}
                    >
                      <div>
                        <p style={{ fontSize: "11px", color: c.textMuted, marginBottom: "2px" }}>
                          RESOLVING RES
                        </p>
                        <p
                          style={{
                            fontSize: "12px",
                            fontWeight: 600,
                            color: c.text,
                            fontFamily: "'JetBrains Mono', monospace",
                          }}
                        >
                          {camStats.resolution}
                        </p>
                      </div>
                      <div>
                        <p style={{ fontSize: "11px", color: c.textMuted, marginBottom: "2px" }}>
                          ACQUISITION RATE
                        </p>
                        <p
                          style={{
                            fontSize: "12px",
                            fontWeight: 600,
                            color: c.text,
                            fontFamily: "'JetBrains Mono', monospace",
                          }}
                        >
                          {camStats.fps}
                        </p>
                      </div>
                      <div>
                        <p style={{ fontSize: "11px", color: c.textMuted, marginBottom: "2px" }}>
                          ASPECT RATIO
                        </p>
                        <p
                          style={{
                            fontSize: "12px",
                            fontWeight: 600,
                            color: c.text,
                            fontFamily: "'JetBrains Mono', monospace",
                          }}
                        >
                          {camStats.aspect}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Helper text */}
                  <p style={{ fontSize: "12px", color: c.textMuted, lineHeight: 1.5 }}>
                    Widescreen 16:9 or 4:3 input accepted. Frames are scanned locally to extract
                    face-landmark telemetry, no video leaves the device.
                  </p>
                </div>
              </div>
            </div>

            {/* Audio | Speaker — 2-up grid */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "24px",
                alignItems: "stretch",
              }}
            >
              {/* Audio Microphone Calibration */}
              <div
                style={{
                  background: c.cardBg,
                  border: `1px solid ${c.border}`,
                  borderRadius: "var(--radius-md)",
                  padding: "24px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "18px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <h4 style={{ fontSize: "14px", fontWeight: 600, color: c.text }}>
                    Audio Microphone Calibration
                  </h4>
                  <span
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background: micActive ? "#22c55e" : c.textMuted,
                      display: "inline-block",
                      flexShrink: 0,
                    }}
                  />
                </div>
                <p style={{ fontSize: "13px", color: c.textMuted, lineHeight: 1.5 }}>
                  Calibrate active mic inputs to hold a clean environmental decibel threshold.
                </p>
                <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
                  <button
                    onClick={toggleMicMonitor}
                    style={{
                      flexShrink: 0,
                      padding: "0 16px",
                      minHeight: 40,
                      background: micActive ? "rgba(239,68,68,0.08)" : "var(--home-status-ok-bg)",
                      border: `1px solid ${micActive ? "rgba(239,68,68,0.3)" : "var(--home-status-ok-border-strong)"}`,
                      borderRadius: "var(--radius-sm)",
                      color: micActive ? "#ef4444" : "var(--home-status-ok)",
                      fontSize: "13px",
                      fontWeight: 500,
                      cursor: "pointer",
                      transition:
                        "background var(--transition-fast), border-color var(--transition-fast)",
                    }}
                  >
                    {micActive ? "Stop Decibel Monitor" : "Monitor Audio Feed"}
                  </button>
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        color: c.textMuted,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >
                      Input Level
                    </span>
                    <div
                      style={{
                        height: "6px",
                        background: c.innerBg,
                        borderRadius: "var(--radius-sm)",
                        overflow: "hidden",
                        border: `1px solid ${c.border}`,
                      }}
                    >
                      <div
                        style={{
                          width: `${micLevel}%`,
                          height: "100%",
                          background: "linear-gradient(90deg, #22c55e, var(--color-accent-base))",
                          transition: "width 100ms linear",
                        }}
                      />
                    </div>
                    <p
                      style={{
                        fontSize: "11px",
                        color: c.textMuted,
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >
                      REALTIME: {micLevel > 0 ? `${micLevel} dB · NOMINAL` : "STANDBY"}
                    </p>
                    {micError && (
                      <p
                        style={{
                          fontSize: "11px",
                          color: "#f87171",
                          lineHeight: 1.4,
                          marginTop: "6px",
                        }}
                      >
                        {micError}. Check OS privacy settings and close other recording apps.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Speaker Acoustic Output Test */}
              <div
                style={{
                  background: c.cardBg,
                  border: `1px solid ${c.border}`,
                  borderRadius: "var(--radius-md)",
                  padding: "24px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "18px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <h4 style={{ fontSize: "14px", fontWeight: 600, color: c.text }}>
                    Speaker Acoustic Output Test
                  </h4>
                  <span
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background: speakerActive ? "#22c55e" : c.textMuted,
                      display: "inline-block",
                      flexShrink: 0,
                    }}
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: "11px",
                      color: c.textMuted,
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    <span>TEST TONE GAIN AMPLITUDE</span>
                    <span>{speakerVolume}%</span>
                  </div>
                  <input
                    aria-label="Test tone gain amplitude"
                    type="range"
                    min="0"
                    max="100"
                    value={speakerVolume}
                    onChange={(e) => setSpeakerVolume(Number(e.target.value))}
                    style={{
                      width: "100%",
                      accentColor: "var(--color-accent-base)",
                      background: "var(--home-overlay-strong)",
                      height: "4px",
                      borderRadius: "var(--radius-sm)",
                      cursor: "pointer",
                      outline: "2px solid transparent",
                    }}
                  />
                </div>
                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                  <button
                    onClick={testSpeakers}
                    disabled={speakerActive}
                    style={{
                      flex: 1,
                      padding: "0 16px",
                      minHeight: 40,
                      background: speakerActive ? c.accentLight : "var(--home-overlay-faint)",
                      border: `1px solid ${c.border}`,
                      borderRadius: "var(--radius-sm)",
                      color: c.text,
                      fontSize: "13px",
                      cursor: speakerActive ? "not-allowed" : "pointer",
                      transition:
                        "background var(--transition-fast), border-color var(--transition-fast)",
                    }}
                  >
                    {speakerActive ? "Playing..." : "Play"}
                  </button>
                  <button
                    onClick={() => setSpeakerSuccess(true)}
                    style={{
                      flex: 1,
                      padding: "0 16px",
                      minHeight: 40,
                      background: speakerSuccess === true ? "rgba(34,197,94,0.08)" : "transparent",
                      border: `1px solid ${speakerSuccess === true ? "rgba(34,197,94,0.3)" : "var(--home-clear-border)"}`,
                      borderRadius: "var(--radius-sm)",
                      color: "var(--home-status-ok)",
                      fontSize: "13px",
                      cursor: "pointer",
                      transition:
                        "background var(--transition-fast), border-color var(--transition-fast)",
                    }}
                  >
                    Clear Signal
                  </button>
                </div>
              </div>
            </div>

            {/* Theme placeholder bar — future home-toggle site; wired when home tokenization completes (Phase 2a step 3+). Not wired to any setter. */}
            <div
              style={{
                background: c.cardBg,
                border: `1px solid ${c.border}`,
                borderRadius: "var(--radius-md)",
                padding: "14px 20px",
                display: "flex",
                alignItems: "center",
              }}
            >
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 600,
                  color: c.textMuted,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                }}
              >
                Theme Change Toggle or Something
              </span>
            </div>
          </div>
        )}

        {activeTab === "permissions" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <RestoreLockdownCard theme={theme} onSecurityEvent={onSecurityEvent} />
            <PermissionLine
              label="Webcam Hardware Access"
              enabled={readiness.camera === "ok"}
              description="Allows the proctoring engine to capture live video alignment checkpoints"
              theme={theme}
            />
            <PermissionLine
              label="Microphone Access"
              enabled={readiness.mic === "ok"}
              description="Enables environmental acoustic monitoring to detect unapproved conversations"
              theme={theme}
            />
            <PermissionLine
              label="Tauri System Overlay notifications"
              enabled={true}
              description="Allows desktop prompts regarding firewall constraints or lock failures"
              theme={theme}
            />
          </div>
        )}

        {activeTab === "security" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "32px",
              alignItems: "stretch",
            }}
          >
            <div
              style={{
                background: c.cardBg,
                border: `1px solid ${c.border}`,
                borderRadius: "var(--radius-md)",
                padding: "24px",
                display: "flex",
                flexDirection: "column",
                gap: "16px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "16px",
                }}
              >
                <div>
                  <h4 style={{ fontSize: "14px", fontWeight: 600, color: c.text }}>
                    Security Environment Checks
                  </h4>
                  <p style={{ fontSize: "11px", color: c.textMuted, marginTop: "4px" }}>
                    Last scanned: {lastScannedLabel}
                  </p>
                </div>
                <button
                  onClick={() => void runSecurityScan(true)}
                  disabled={securityBusy}
                  style={{
                    width: "auto",
                    padding: "0 16px",
                    minHeight: 40,
                    background: c.accentLight,
                    border: `1px solid ${c.accentBorder}`,
                    borderRadius: "var(--radius-sm)",
                    color: c.accentText,
                    fontSize: "12px",
                    cursor: securityBusy ? "not-allowed" : "pointer",
                    transition:
                      "background var(--transition-fast), border-color var(--transition-fast)",
                  }}
                >
                  {securityBusy ? "Scanning..." : "Run Native Scan"}
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <SecurityInfoRow
                  label="Operating system"
                  val={
                    platformInfo
                      ? `${platformInfo.os} / ${platformInfo.arch}`
                      : "Checking native platform"
                  }
                  secure={
                    platformInfo
                      ? platformInfo.os === "linux" ||
                        platformInfo.os.toLowerCase().startsWith("windows")
                      : false
                  }
                  theme={theme}
                />
                <SecurityInfoRow
                  label="Virtualization check"
                  val={
                    virtScan
                      ? virtScan.detected
                        ? `${virtScan.platform ?? "virtualized"} detected (${virtScan.confidence})`
                        : "Bare-metal signals clear"
                      : "Checking hypervisor signals"
                  }
                  secure={virtScan ? !virtScan.detected : false}
                  theme={theme}
                />
                <SecurityInfoRow
                  label="Display / webview session"
                  val={securityEnv?.display_server ?? "Native metadata pending"}
                  secure={!!securityEnv}
                  theme={theme}
                />
                <SecurityInfoRow
                  label={
                    platformInfo?.os?.toLowerCase().startsWith("windows")
                      ? "Debugger/injection profile"
                      : "Startup injection check"
                  }
                  val={
                    securityEnv
                      ? securityEnv.ld_preload_injection
                        ? "Needs attention"
                        : "Clean"
                      : "Checking"
                  }
                  secure={securityEnv ? !securityEnv.ld_preload_injection : false}
                  theme={theme}
                />
                <SecurityInfoRow
                  label={
                    platformInfo?.os?.toLowerCase().startsWith("windows")
                      ? "Native lockdown support"
                      : "Linux ptrace scope"
                  }
                  val={
                    platformInfo?.os?.toLowerCase().startsWith("windows")
                      ? "Keyboard hook and firewall commands available"
                      : securityEnv
                        ? `ptrace_scope ${securityEnv.ptrace_scope}`
                        : "Checking"
                  }
                  secure={
                    platformInfo?.os?.toLowerCase().startsWith("windows") ||
                    (securityEnv ? securityEnv.ptrace_scope > 0 : false)
                  }
                  theme={theme}
                />
                <SecurityInfoRow
                  label="Network reachability"
                  val={
                    networkCheck
                      ? networkCheck.reachable
                        ? `${networkCheck.quality} (${networkCheck.latency_ms ?? "?"}ms)`
                        : "Unreachable"
                      : "Checking host reachability"
                  }
                  secure={networkCheck ? networkCheck.reachable : false}
                  theme={theme}
                />
              </div>
            </div>

            <div
              style={{
                background: c.cardBg,
                border: `1px solid ${c.border}`,
                borderRadius: "var(--radius-md)",
                padding: "24px",
                display: "flex",
                flexDirection: "column",
                gap: "12px",
              }}
            >
              <h4 style={{ fontSize: "14px", fontWeight: 600, color: c.text }}>
                Restricted Background Processes
              </h4>
              <p style={{ fontSize: "13px", color: c.textMuted, lineHeight: 1.5 }}>
                Native process scanning is backed by /proc on Linux and tasklist on Windows.
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "12px",
                  marginTop: "8px",
                }}
              >
                {processScan?.found.length ? (
                  // The same executable can appear multiple times in a scan, so
                  // `name` is not a unique key — pair it with the index.
                  processScan.found.map((name, i) => (
                    <ProcessListItem
                      key={`${name}-${i}`}
                      name={name}
                      restricted={true}
                      theme={theme}
                    />
                  ))
                ) : (
                  <>
                    <ProcessListItem
                      name="OBS / screen recording tools"
                      restricted={false}
                      theme={theme}
                    />
                    <ProcessListItem
                      name="Discord / chat clients"
                      restricted={false}
                      theme={theme}
                    />
                    <ProcessListItem
                      name="TeamViewer / remote access"
                      restricted={false}
                      theme={theme}
                    />
                    <ProcessListItem
                      name="Debuggers / packet tools"
                      restricted={false}
                      theme={theme}
                    />
                  </>
                )}
              </div>
              <p
                style={{
                  fontSize: "12px",
                  color: processScan?.clean === false ? "#f87171" : c.textMuted,
                  lineHeight: 1.5,
                }}
              >
                {processScan
                  ? processScan.clean
                    ? "No restricted processes were found in the latest native scan."
                    : "Close the flagged apps and run the scan again before joining a session."
                  : "Run a native scan to populate the restricted process result."}
              </p>
            </div>
          </div>
        )}

        {activeTab === "about" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr",
              gap: "24px",
              maxWidth: "680px",
            }}
          >
            <div
              style={{
                background: c.cardBg,
                border: `1px solid ${c.border}`,
                borderRadius: "var(--radius-md)",
                padding: "28px",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  right: 0,
                  width: "36px",
                  height: "36px",
                  background: `linear-gradient(135deg, transparent 50%, ${c.accentText}20 50%)`,
                  borderLeft: `1px solid ${c.border}`,
                  borderBottom: `1px solid ${c.border}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "11px",
                  color: c.accentText,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontWeight: 600,
                }}
              >
                ℹ
              </div>

              <h4 style={{ fontSize: "19px", fontWeight: 700, color: c.text, marginBottom: "8px" }}>
                About AMS Access
              </h4>
              <p
                style={{
                  fontSize: "13px",
                  color: c.textMuted,
                  lineHeight: 1.5,
                  marginBottom: "24px",
                }}
              >
                AMS Access helps verify your identity, check your device, and keep the contest
                environment ready before and during quantitative rounds.
              </p>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                  borderTop: `1px solid ${c.border}`,
                  paddingTop: "20px",
                }}
              >
                {[
                  { label: "Privacy Policy", url: "/privacy" },
                  { label: "Terms of Service", url: "/terms" },
                  { label: "Open Source Licenses", url: "/licenses" },
                  { label: "System Version", value: "v0.1.0" },
                ].map((item) => (
                  <div
                    key={item.label}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 14px",
                      borderRadius: "var(--radius-sm)",
                      background: "var(--home-overlay-whisper)",
                      border: `1px solid ${c.border}`,
                    }}
                  >
                    <span style={{ fontSize: "13px", fontWeight: 500, color: c.textMuted }}>
                      {item.label}
                    </span>
                    {item.url ? (
                      <a
                        href={item.url}
                        target={item.url.startsWith("/") ? undefined : "_blank"}
                        rel={item.url.startsWith("/") ? undefined : "noopener noreferrer"}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "4px",
                          fontSize: "12px",
                          color: c.accentText,
                          textDecoration: "none",
                          fontWeight: 500,
                          cursor: "pointer",
                          transition: "opacity var(--transition-fast)",
                        }}
                      >
                        Launch Document
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 10 10"
                          fill="none"
                          style={{ marginLeft: "2px" }}
                        >
                          <path
                            d="M1 9l8-8M9 1h-6M9 1v6"
                            stroke="currentColor"
                            strokeWidth="1.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </a>
                    ) : (
                      <span
                        style={{
                          fontSize: "12px",
                          color: c.text,
                          fontFamily: "'JetBrains Mono', monospace",
                          fontWeight: 600,
                        }}
                      >
                        {item.value}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
