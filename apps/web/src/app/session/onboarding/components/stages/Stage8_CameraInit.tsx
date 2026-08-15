import { useEffect, useRef, useState } from "react";
import { Button } from "@/app/home/components/ui-primitives";
import { useTheme } from "../hooks";
import { Spinner, StageHeader, StatusBadge } from "../ui";
import { cameraSession } from "@/lib/camera-session";
import { invoke, waitForVideoReady, withTimeout } from "../../support";

export function Stage8_CameraInit({
  onPass,
  onCameraReady,
}: {
  onPass(): void;
  onCameraReady(stream: MediaStream): void;
}) {
  const theme = useTheme();
  const [phase, setPhase] = useState<"checking" | "pass" | "fail">("checking");
  const [error, setError] = useState<string | null>(null);
  const [permissionIssue, setPermissionIssue] = useState(false);
  const [isWindows, setIsWindows] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    invoke<{ os: string }>("get_platform")
      .then((p) => setIsWindows(p?.os?.toLowerCase().startsWith("windows") ?? false))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    let passTimer: ReturnType<typeof setTimeout> | null = null;

    // The camera is opened through the shared session, which keeps it open
    // across the navigation into the contest. Nothing here stops it — an
    // unmount is the route change, not the end of the exam.
    async function init() {
      try {
        const stream = await withTimeout(cameraSession.ensure(), 8000, "Camera request timed out");
        if (cancelled) return;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
          await waitForVideoReady(videoRef.current);
        }
        if (cancelled) return;
        onCameraReady(stream);
        setPhase("pass");
        passTimer = setTimeout(() => {
          if (!cancelled) onPass();
        }, 1000);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Camera access was denied";
        const denied =
          msg.includes("denied") ||
          msg.includes("Permission") ||
          msg.includes("NotAllowed") ||
          msg.includes("not allowed");
        const notFound = msg.includes("not available") || msg.includes("NotFound");
        setPermissionIssue(!notFound);
        setError(
          denied
            ? "Camera access was denied. Allow camera access for AMS Access, then try again."
            : notFound
              ? "No camera found. Please connect a camera and try again."
              : "Could not access your camera. Please check your settings."
        );
        setPhase("fail");
      }
    }
    void init();

    // A camera unplugged while this stage is on screen used to hang here
    // forever: the preview simply stopped updating, with no event, no error
    // and no way forward. Now it surfaces as a failure with the retry button
    // the error path already renders.
    const unsubscribe = cameraSession.subscribe((status) => {
      if (cancelled || status !== "lost") return;
      if (passTimer) clearTimeout(passTimer);
      setPermissionIssue(false);
      setError("The camera was disconnected. Reconnect it and try again.");
      setPhase("fail");
    });

    return () => {
      cancelled = true;
      unsubscribe();
      if (passTimer) clearTimeout(passTimer);
    };
  }, [onPass, onCameraReady, retryKey]);

  return (
    <div className="flex flex-col items-center w-full">
      <StageHeader label="Camera Setup" />

      <div
        className="relative mb-8 overflow-hidden"
        style={{
          width: 240,
          height: 160,
          borderRadius: "var(--radius-sm)",
          background: "#000",
          border: `1px solid ${phase === "pass" ? "rgba(34,197,94,0.45)" : phase === "fail" ? "rgba(239,68,68,0.35)" : "rgba(255,255,255,0.06)"}`,
          transition: "border-color var(--transition-slow)",
        }}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          className="h-full w-full object-cover"
          style={{ transform: "scaleX(-1)" }}
        />
        {phase === "checking" && (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.55)" }}
          >
            <Spinner size={28} />
          </div>
        )}
        {phase === "fail" && (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.8)", padding: "16px" }}
          >
            <p
              style={{
                fontSize: "11px",
                fontFamily: "'JetBrains Mono', monospace",
                color: "#fca5a5",
                textAlign: "center",
                lineHeight: 1.6,
              }}
            >
              Camera needs attention
            </p>
          </div>
        )}
      </div>

      {phase === "checking" && (
        <StatusBadge status="checking" label="Requesting camera access..." />
      )}
      {phase === "pass" && <StatusBadge status="pass" label="Camera ready" />}
      {phase === "fail" && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "16px",
            maxWidth: "320px",
          }}
        >
          <p
            style={{
              fontSize: "12px",
              fontFamily: "'JetBrains Mono', monospace",
              color: "#f87171",
              textAlign: "center",
              lineHeight: 1.65,
            }}
          >
            {error}
          </p>
          {isWindows && permissionIssue && (
            <Button
              theme={theme}
              variant="primary"
              size="small"
              onClick={() => {
                // One-click deep link into Windows Settings → Privacy → Camera —
                // the candidate never has to find the page themselves.
                void invoke("open_privacy_settings", { section: "camera" }).catch(() => {});
              }}
            >
              Open Windows camera settings
            </Button>
          )}
          <Button
            theme={theme}
            variant="secondary"
            size="small"
            onClick={() => {
              setPhase("checking");
              setError(null);
              setPermissionIssue(false);
              setRetryKey((k) => k + 1);
            }}
          >
            Try again
          </Button>
          {process.env.NODE_ENV === "development" && (
            <button className="onb-btn onb-btn--secondary" onClick={onPass}>
              Skip (dev only)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
