import { useEffect, useState, type RefObject } from "react";
import { Video, VideoOff, Mic, MicOff, SwitchCamera } from "lucide-react";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Button } from "@astryxdesign/core/Button";
import { Text } from "@astryxdesign/core/Text";
import { StatusDot } from "@astryxdesign/core/StatusDot";

export interface CameraTileProps {
  cameraVideoRef: RefObject<HTMLVideoElement | null>;
  cameraStream: MediaStream | null;
  cameraError: string | null;
  sidebarCollapsed: boolean;
  cameraCollapsed: boolean;
  cameraStatusLabel: string;
  cameraHealthy: boolean;
  cameraEnabled: boolean;
  micEnabled: boolean;
  handleToggleMedia: (type: "camera" | "mic", value: boolean) => void;
  /** Switch to another camera, mid-exam. See the picker below. */
  onPickCamera?: (deviceId: string) => void;
  /** How the candidate is sitting in frame. Advice to them, nothing more. */
  framingHint?: "ok" | "off_centre" | "too_close" | "too_far";
}

// ALWAYS MOUNTED — visibility is a display toggle (below), never a mount
// conditional. A webcam teardown mid-exam is a candidate-facing failure; the
// <video> element and its bound MediaStream must never unmount.
const FRAMING_COPY: Record<string, string> = {
  off_centre: "Move back into the centre of the frame",
  too_close: "Move back a little",
  too_far: "Move a bit closer",
};

export function CameraTile({
  onPickCamera,
  framingHint = "ok",
  cameraVideoRef,
  cameraStream,
  cameraError,
  sidebarCollapsed,
  cameraCollapsed,
  cameraStatusLabel,
  cameraHealthy,
  cameraEnabled,
  micEnabled,
  handleToggleMedia,
}: CameraTileProps) {
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Re-read when the menu is opened or the camera is toggled, not once on
  // mount: labels stay empty until permission is granted, and a webcam
  // plugged in mid-exam should appear without a reload.
  useEffect(() => {
    let cancelled = false;
    void navigator.mediaDevices
      ?.enumerateDevices?.()
      .then((devices) => {
        if (!cancelled) setCameras(devices.filter((d) => d.kind === "videoinput" && d.deviceId));
      })
      .catch(() => {
        // No enumerate, no picker. Nothing else changes.
      });
    return () => {
      cancelled = true;
    };
  }, [pickerOpen, cameraEnabled]);

  return (
    <VStack
      id="contest-camera-preview"
      className="contest-camera-tile"
      aria-label={cameraStatusLabel}
      gap={0}
      style={{
        position: "absolute",
        left: sidebarCollapsed ? "calc(var(--spacing-10) + var(--spacing-4))" : 0,
        bottom: 0,
        width: "calc(var(--spacing-10) * 5.5)",
        height: "calc(var(--spacing-10) * 4)",
        zIndex: 50,
        display:
          (cameraStream ?? cameraError) && (!sidebarCollapsed || !cameraCollapsed)
            ? "flex"
            : "none",
        background: "var(--color-background-card)",
        border: "var(--border-width) solid var(--color-border)",
        overflow: "hidden",
      }}
    >
      <HStack
        gap={1}
        className="contest-camera-controls"
        style={{
          position: "absolute",
          top: "var(--spacing-2)",
          right: "var(--spacing-2)",
          zIndex: 2,
          padding: "var(--spacing-1)",
          background: "var(--color-background-card)",
          borderRadius: "var(--radius-element)",
          border: "var(--border-width) solid var(--color-border)",
        }}
      >
        <Button
          type="button"
          label={cameraEnabled ? "Turn camera off" : "Turn camera on"}
          tooltip={
            cameraEnabled ? "Camera on — click to turn off" : "Camera off — click to turn on"
          }
          variant="ghost"
          size="sm"
          isIconOnly
          icon={cameraEnabled ? <Video size={16} /> : <VideoOff size={16} />}
          onClick={() => handleToggleMedia("camera", !cameraEnabled)}
        />
        {/* Changing camera without leaving the exam.
         *
         * Onboarding has a picker now, but the wrong camera is not always
         * obvious until the contest is running -- a laptop that opened its
         * infrared sensor shows a black tile, and the candidate's only
         * options were to sit with it or abandon the sitting. Lots of people
         * hit this. The list is read when it is opened, so a webcam plugged
         * in mid-exam appears without a reload. */}
        {onPickCamera && cameras.length > 1 && (
          <Button
            type="button"
            label="Change camera"
            tooltip="Change camera"
            variant="ghost"
            size="sm"
            isIconOnly
            icon={<SwitchCamera size={16} />}
            onClick={() => setPickerOpen((open) => !open)}
          />
        )}
      </HStack>
      {onPickCamera && pickerOpen && cameras.length > 0 && (
        <VStack
          role="group"
          aria-label="Choose a camera"
          gap={0}
          style={{
            position: "absolute",
            top: "calc(var(--spacing-10) + var(--spacing-2))",
            right: "var(--spacing-2)",
            zIndex: 3,
            maxWidth: "min(18rem, calc(100% - var(--spacing-4)))",
            padding: "var(--spacing-1)",
            background: "var(--color-background-card)",
            border: "var(--border-width) solid var(--color-border)",
            borderRadius: "var(--radius-element)",
            boxShadow: "var(--shadow-high)",
          }}
        >
          {cameras.map((camera, index) => (
            <Button
              key={camera.deviceId}
              type="button"
              label={camera.label || `Camera ${index + 1}`}
              variant="ghost"
              size="sm"
              onClick={() => {
                onPickCamera(camera.deviceId);
                setPickerOpen(false);
              }}
              style={{ justifyContent: "flex-start", width: "100%" }}
            />
          ))}
        </VStack>
      )}
        <Button
          type="button"
          label={micEnabled ? "Turn microphone off" : "Turn microphone on"}
          tooltip={
            micEnabled ? "Microphone on — click to turn off" : "Microphone off — click to turn on"
          }
          variant="ghost"
          size="sm"
          isIconOnly
          icon={micEnabled ? <Mic size={16} /> : <MicOff size={16} />}
          onClick={() => handleToggleMedia("mic", !micEnabled)}
        />
      
      <VStack style={{ width: "100%", height: "100%", position: "relative" }}>
        <video
          ref={cameraVideoRef}
          muted
          playsInline
          autoPlay
          controls={false}
          disablePictureInPicture
          disableRemotePlayback
          style={{
            pointerEvents: "none",
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: "scaleX(-1)",
            display: "block",
            borderRadius: "0",
          }}
        />
        {/* Shown over the candidate's own picture, where they are already
            looking, and only while they are out of shot. It clears itself:
            there is nothing to dismiss and nothing to get wrong. */}
        {cameraEnabled && framingHint !== "ok" && FRAMING_COPY[framingHint] && (
          <Text
            role="status"
            aria-live="polite"
            type="supporting"
            style={{
              position: "absolute",
              left: "var(--spacing-2)",
              right: "var(--spacing-2)",
              top: "var(--spacing-2)",
              padding: "var(--spacing-1) var(--spacing-2)",
              borderRadius: "var(--radius-element)",
              background: "color-mix(in srgb, var(--color-background-body) 82%, transparent)",
              color: "var(--color-text-primary)",
              textAlign: "center",
            }}
          >
            {FRAMING_COPY[framingHint]}
          </Text>
        )}
      </VStack>
      <HStack
        role="status"
        aria-live="polite"
        gap={2}
        align="center"
        style={{
          position: "absolute",
          bottom: "var(--spacing-2)",
          left: "var(--spacing-2)",
          zIndex: 2,
          pointerEvents: "none",
          padding: "var(--spacing-1) var(--spacing-2)",
          borderRadius: "var(--radius-element)",
          background: "var(--color-background-card)",
        }}
      >
        <StatusDot
          label={cameraStatusLabel}
          variant={
            !cameraEnabled
              ? "neutral"
              : cameraHealthy
                ? "success"
                : cameraError
                  ? "warning"
                  : "neutral"
          }
        />
        <Text type="supporting">{cameraStatusLabel}</Text>
      </HStack>
    </VStack>
  );
}
