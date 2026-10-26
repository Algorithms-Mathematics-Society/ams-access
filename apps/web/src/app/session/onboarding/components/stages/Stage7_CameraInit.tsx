import { VStack } from "@astryxdesign/core/VStack";
import { Text } from "@astryxdesign/core/Text";
import { Selector } from "@astryxdesign/core/Selector";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/app/home/components/ui-primitives";
import { useTheme } from "@/lib/theme";
import { Spinner, StageHeader, StatusBadge } from "../ui";
import { SetupPermissionInfo } from "../SetupPermissionInfo";
import { cameraSession } from "@/lib/camera-session";
import { invoke } from "../../support";
import { startCameraPreview } from "@/lib/camera-readiness";
import type { SessionPolicy } from "@ams/api-client";
import { classifyCameraFailure, type CameraFailure } from "../../camera-failure";
import { readinessAction } from "../../readiness-action";
import { useCameraDevices } from "@/lib/use-camera-devices";
import { isSavedCameraUnavailable, missingCameraGuidance } from "@/lib/camera-selection";

export function Stage7_CameraInit({
  onPass,
  onCameraReady,
  onWarn,
  policy,
  overrideActive,
}: {
  onPass(): void;
  onWarn(detail: string): void;
  onCameraReady(stream: MediaStream | null): void;
  policy: SessionPolicy | null;
  overrideActive: boolean;
}) {
  const { theme } = useTheme();
  const [phase, setPhase] = useState<"checking" | "pass" | "fail">("checking");
  const [error, setError] = useState<string | null>(null);
  const [permissionIssue, setPermissionIssue] = useState(false);
  const [isWindows, setIsWindows] = useState(false);
  const [isMac, setIsMac] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [errorCode, setErrorCode] = useState<CameraFailure>("not_ready");
  const [preferredCamera, setPreferredCamera] = useState(
    () => cameraSession.preferredVideoDevice() ?? ""
  );
  const [selectionPending, setSelectionPending] = useState(false);
  const { state: cameraDevices, refresh: refreshCameras } = useCameraDevices();
  const locationRequested = useRef(false);
  const generationRef = useRef(0);
  const completedRef = useRef(false);
  const passTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const policyRef = useRef(policy);
  policyRef.current = policy;
  const cancelPass = () => {
    if (passTimerRef.current !== null) clearTimeout(passTimerRef.current);
    passTimerRef.current = null;
  };
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
    const generation = ++generationRef.current;
    completedRef.current = false;
    const owns = () => !cancelled && generationRef.current === generation && !completedRef.current;

    // The camera is opened through the shared session, which keeps it open
    // across the navigation into the contest. Nothing here stops it — an
    // unmount is the route change, not the end of the exam.
    async function init() {
      try {
        const stream = await cameraSession.ensure();
        if (!owns()) return;
        if (!videoRef.current) throw new Error("Camera preview unavailable");
        await startCameraPreview(videoRef.current, stream);
        if (!stream.getVideoTracks().some((track) => track.readyState === "live" && !track.muted)) {
          throw new Error("Camera is not delivering frames");
        }
        if (!owns()) return;
        onCameraReady(stream);
        setPhase("pass");
        refreshCameras();
      } catch (err) {
        if (!owns()) return;
        const code = classifyCameraFailure(err);
        setErrorCode(code);
        setPermissionIssue(code === "denied");
        setError(
          code === "denied"
            ? "Camera access was denied. Allow camera access for AMS Access, then try again."
            : code === "missing"
              ? missingCameraGuidance(Boolean(cameraSession.preferredVideoDevice()))
              : code === "busy"
                ? "The camera could not be read. Close other camera apps and check the connection, then try again."
                : code === "timeout"
                  ? "The camera did not respond in time. Reconnect it or try again."
                  : "The camera preview could not start. Check the camera, then try again."
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
      if (!owns() || status !== "lost") return;
      generationRef.current += 1;
      cancelPass();
      setPermissionIssue(false);
      setErrorCode("missing");
      setError("The camera was disconnected. Reconnect it and try again.");
      setPhase("fail");
    });

    return () => {
      cancelled = true;
      unsubscribe();
      generationRef.current += 1;
      cancelPass();
    };
  }, [onCameraReady, refreshCameras, retryKey]);

  useEffect(() => {
    if (!isMac || phase !== "pass" || locationRequested.current) return;
    locationRequested.current = true;
    // Optional: permission results never affect camera readiness or contest entry.
    void invoke("request_wifi_location").catch(() => {});
  }, [isMac, phase]);

  useEffect(() => {
    cancelPass();
    if (phase !== "pass" || readinessAction(policy, "camera", "pass").decision !== "pass") return;
    const generation = generationRef.current;
    passTimerRef.current = setTimeout(() => {
      if (generationRef.current !== generation || completedRef.current) return;
      if (readinessAction(policyRef.current, "camera", "pass").decision !== "pass") return;
      completedRef.current = true;
      onPass();
    }, 1000);
    return cancelPass;
  }, [phase, policy, onPass]);

  const selectCamera = async (deviceId: string) => {
    const generation = ++generationRef.current;
    completedRef.current = true;
    cancelPass();
    setSelectionPending(true);
    setPhase("checking");
    setError(null);
    setPermissionIssue(false);
    try {
      await cameraSession.setPreferredVideoDevice(deviceId || null);
      if (generationRef.current !== generation) return;
      setPreferredCamera(deviceId);
      completedRef.current = false;
      setRetryKey((key) => key + 1);
    } catch (err) {
      if (generationRef.current !== generation) return;
      setPreferredCamera(cameraSession.preferredVideoDevice() ?? "");
      completedRef.current = false;
      const preferenceUnavailable =
        err instanceof Error && err.message.toLowerCase().includes("storage");
      const code = classifyCameraFailure(err);
      setErrorCode(code);
      setPermissionIssue(code === "denied");
      setError(
        preferenceUnavailable
          ? "Your camera choice could not be saved. Check app storage access, then choose it again."
          : code === "missing"
            ? "That camera is no longer available. Choose another camera or reconnect it."
            : code === "denied"
              ? "Camera access was denied. Allow camera access for AMS Access, then choose the camera again."
              : code === "busy"
                ? "That camera could not be read. Close other camera apps, then choose it again."
                : code === "timeout"
                  ? "That camera did not respond in time. Reconnect it or choose another camera."
                  : "That camera preview could not start. Choose another camera or try again."
      );
      setPhase("fail");
    } finally {
      if (generationRef.current === generation) setSelectionPending(false);
    }
  };

  const failureAction = readinessAction(policy, "camera", "failure");
  const selectableCameraDevices = cameraDevices.devices.filter((device) => device.deviceId);
  const cameraIdentitiesHidden =
    cameraDevices.status === "available" &&
    cameraDevices.devices.length > 0 &&
    selectableCameraDevices.length === 0;
  const savedCameraUnavailable = isSavedCameraUnavailable(
    preferredCamera || null,
    cameraDevices.status,
    selectableCameraDevices.map((device) => device.deviceId)
  );

  return (
    <VStack gap={5} width="100%">
      <VStack gap={2}>
        <StageHeader label="Set up your camera" />
        <Text color="secondary">
          Allow camera access when prompted. Use the preview to find a clear, well-lit position.
        </Text>
      </VStack>

      <SetupPermissionInfo kind="camera" />
      {isMac && (
        <Text color="secondary">
          macOS also asks for optional Location access to show Wi-Fi networks near you, including
          after a disconnection. Your location is never recorded or sent. Denying this does not
          block contest entry.
        </Text>
      )}
      <Selector
        label="Camera"
        description="Choose the camera to use for setup and during the contest."
        value={preferredCamera}
        onChange={(deviceId) => void selectCamera(deviceId)}
        isDisabled={selectionPending}
        disabledMessage={selectionPending ? "Switching cameras…" : undefined}
        isLoading={cameraDevices.status === "loading"}
        width="100%"
        status={
          savedCameraUnavailable
            ? { type: "warning", message: "Saved camera unavailable. Choose another camera." }
            : undefined
        }
        options={[
          { value: "", label: "System default" },
          ...(preferredCamera &&
          !selectableCameraDevices.some((device) => device.deviceId === preferredCamera)
            ? [
                {
                  value: preferredCamera,
                  label:
                    cameraDevices.status === "unavailable" || cameraDevices.status === "loading"
                      ? "Saved camera"
                      : "Saved camera unavailable",
                  disabled: savedCameraUnavailable,
                },
              ]
            : []),
          ...selectableCameraDevices.map((device, index) => ({
            value: device.deviceId,
            label: device.label || `Camera ${index + 1}`,
          })),
        ]}
      />
      {cameraDevices.status === "loading" && (
        <Text color="secondary">Loading available cameras…</Text>
      )}
      {cameraIdentitiesHidden && (
        <VStack gap={2} hAlign="start">
          <Text color="secondary">
            Camera identities are hidden. Start the camera to allow access, then refresh the list.
          </Text>
          <Button theme={theme} variant="secondary" size="small" onClick={refreshCameras}>
            Refresh cameras
          </Button>
        </VStack>
      )}
      {cameraDevices.status === "empty" && (
        <VStack gap={2} hAlign="start">
          <Text color="secondary">
            No cameras were found. Connect a camera, then refresh the list.
          </Text>
          <Button theme={theme} variant="secondary" size="small" onClick={refreshCameras}>
            Refresh cameras
          </Button>
        </VStack>
      )}
      {cameraDevices.status === "unavailable" && (
        <VStack gap={2} hAlign="start">
          <Text color="secondary">
            {cameraDevices.error ?? "The camera list is unavailable. Refresh to try again."}
          </Text>
          <Button theme={theme} variant="secondary" size="small" onClick={refreshCameras}>
            Refresh cameras
          </Button>
        </VStack>
      )}
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
          {failureAction.decision === "warn" && (
            <Button
              theme={theme}
              variant="secondary"
              size="small"
              onClick={() => {
                if (
                  completedRef.current ||
                  readinessAction(policyRef.current, "camera", "failure").decision !== "warn"
                )
                  return;
                completedRef.current = true;
                generationRef.current += 1;
                cancelPass();
                onCameraReady(null);
                onWarn("Camera unavailable (" + errorCode + "): " + error);
              }}
            >
              {overrideActive ? "Continue with organizer approval" : "Continue with warning"}
            </Button>
          )}
          <Button
            theme={theme}
            variant="secondary"
            size="small"
            onClick={() => {
              generationRef.current += 1;
              completedRef.current = true;
              cancelPass();
              // A live-but-muted handle is reusable to ensure(), yet cannot deliver frames.
              // An explicit retry releases it so the next attempt opens the repaired camera.
              cameraSession.releaseVideo();
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
