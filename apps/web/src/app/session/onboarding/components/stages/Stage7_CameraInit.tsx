import { VStack } from "@astryxdesign/core/VStack";
import { Text } from "@astryxdesign/core/Text";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/app/home/components/ui-primitives";
import { useTheme } from "@/lib/theme";
import { Spinner, StageHeader, StatusBadge } from "../ui";
import { SetupPermissionInfo } from "../SetupPermissionInfo";
import { cameraSession } from "@/lib/camera-session";
import { invoke, waitForVideoReady, withTimeout } from "../../support";

export function Stage7_CameraInit({
  onPass,
  onCameraReady,
}: {
  onPass(): void;
  onCameraReady(stream: MediaStream): void;
}) {
  const { theme } = useTheme();
  const [phase, setPhase] = useState<"checking" | "pass" | "fail">("checking");
  const [error, setError] = useState<string | null>(null);
  const [permissionIssue, setPermissionIssue] = useState(false);
  const [isWindows, setIsWindows] = useState(false);
  const [isMac, setIsMac] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    invoke<{ os: string }>("get_platform")
      .then((p) => {
        setIsWindows(p?.os?.toLowerCase().startsWith("windows") ?? false);
        setIsMac(p?.os?.toLowerCase().startsWith("mac") ?? false);
      })
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
    <VStack gap={5} width="100%">
      <VStack gap={2}>
        <StageHeader label="Set up your camera" />
        <Text color="secondary">
          Allow camera access when prompted. Use the preview to find a clear, well-lit position.
        </Text>
      </VStack>

      <SetupPermissionInfo kind="camera" />
      <VStack
        width="100%"
        maxWidth="calc(var(--spacing-10) * 12)"
        style={{
          position: "relative",
          aspectRatio: "3 / 2",
          overflow: "hidden",
          alignSelf: "center",
          borderRadius: "var(--radius-sm)",
          background: "var(--color-background-surface)",
          border: `var(--border-width) solid ${phase === "pass" ? "var(--color-border-green)" : phase === "fail" ? "var(--color-border-red)" : "var(--color-border)"}`,
          transition: "border-color var(--transition-slow)",
        }}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label="Live camera preview"
          style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }}
        />
        {phase === "checking" && (
          <VStack
            hAlign="center"
            vAlign="center"
            style={{
              position: "absolute",
              inset: 0,
              background: "var(--color-background-surface)",
            }}
          >
            <Spinner size={28} />
          </VStack>
        )}
        {phase === "fail" && (
          <VStack
            hAlign="center"
            vAlign="center"
            style={{
              position: "absolute",
              inset: 0,
              background: "var(--color-background-surface)",
              padding: "var(--spacing-4)",
            }}
          >
            <Text
              style={{
                fontSize: "var(--font-size-sm)",
                fontFamily: "var(--font-family-body)",
                color: "var(--color-error)",
                textAlign: "center",
                lineHeight: 1.6,
              }}
            >
              Camera needs attention
            </Text>
          </VStack>
        )}
      </VStack>

      {phase === "checking" && (
        <StatusBadge status="checking" label="Requesting camera access..." />
      )}
      {phase === "pass" && <StatusBadge status="pass" label="Camera ready" />}
      {phase === "fail" && (
        <VStack
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "var(--spacing-4)",
            maxWidth: "100%",
          }}
        >
          <Text
            style={{
              fontSize: "var(--font-size-base)",
              fontFamily: "var(--font-family-body)",
              color: "var(--color-error)",
              textAlign: "center",
              lineHeight: 1.65,
            }}
          >
            {error}
          </Text>
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
          {isMac && permissionIssue && (
            <>
              <Button
                theme={theme}
                variant="primary"
                size="small"
                onClick={() => {
                  void invoke("open_privacy_settings", { section: "camera" }).catch(() => {});
                }}
              >
                Open System Settings
              </Button>
              <Text
                style={{
                  fontSize: "var(--font-size-sm)",
                  fontFamily: "var(--font-family-body)",
                  color: "var(--color-text-secondary)",
                  textAlign: "center",
                  lineHeight: 1.6,
                }}
              >
                After allowing camera access, macOS requires AMS Access to be quit and reopened
                before the change takes effect. Relaunch the app, then continue setup.
              </Text>
            </>
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
          {!isMac && process.env.NODE_ENV === "development" && (
            <Button theme={theme} variant="secondary" size="small" onClick={onPass}>
              Skip (dev only)
            </Button>
          )}
        </VStack>
      )}
    </VStack>
  );
}
