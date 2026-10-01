import { type RefObject } from "react";
import { Video, VideoOff, Mic, MicOff } from "lucide-react";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Button } from "@astryxdesign/core/Button";
import { Text } from "@astryxdesign/core/Text";
import { StatusDot } from "@astryxdesign/core/StatusDot";

export interface CameraTileProps {
  cameraVideoRef: RefObject<HTMLVideoElement | null>;
  cameraStream: MediaStream | null;
  cameraError: string | null;
  sidebarCollapsed: boolean;
  cameraStatusLabel: string;
  cameraHealthy: boolean;
  cameraEnabled: boolean;
  micEnabled: boolean;
  handleToggleMedia: (type: "camera" | "mic", value: boolean) => void;
}

// ALWAYS MOUNTED — visibility is a display toggle (below), never a mount
// conditional. A webcam teardown mid-exam is a candidate-facing failure; the
// <video> element and its bound MediaStream must never unmount.
export function CameraTile({
  cameraVideoRef,
  cameraStream,
  cameraError,
  sidebarCollapsed,
  cameraStatusLabel,
  cameraHealthy,
  cameraEnabled,
  micEnabled,
  handleToggleMedia,
}: CameraTileProps) {
  return (
    <VStack className="contest-camera-tile" aria-label={cameraStatusLabel} gap={0} style={{ position: "absolute", left: 0, bottom: 0, width: "calc(var(--spacing-10) * 5.5)", height: "calc(var(--spacing-10) * 4)", zIndex: 50, display: (cameraStream ?? cameraError) && !sidebarCollapsed ? "flex" : "none", background: "var(--color-background-card)", border: "var(--border-width) solid var(--color-border)", overflow: "hidden" }}>
      <HStack gap={1} className="contest-camera-controls" style={{ position: "absolute", top: "var(--spacing-2)", right: "var(--spacing-2)", zIndex: 2, padding: "var(--spacing-1)", background: "var(--color-background-card)", borderRadius: "var(--radius-element)", border: "var(--border-width) solid var(--color-border)" }}>
        <Button type="button" label={cameraEnabled ? "Turn camera off" : "Turn camera on"} tooltip={cameraEnabled ? "Camera on — click to turn off" : "Camera off — click to turn on"} variant="ghost" size="sm" isIconOnly icon={cameraEnabled ? <Video size={16} /> : <VideoOff size={16} />} onClick={() => handleToggleMedia("camera", !cameraEnabled)} />
        <Button type="button" label={micEnabled ? "Turn microphone off" : "Turn microphone on"} tooltip={micEnabled ? "Microphone on — click to turn off" : "Microphone off — click to turn on"} variant="ghost" size="sm" isIconOnly icon={micEnabled ? <Mic size={16} /> : <MicOff size={16} />} onClick={() => handleToggleMedia("mic", !micEnabled)} />
      </HStack>
      <VStack style={{ width: "100%", height: "100%", position: "relative" }}>
        <video ref={cameraVideoRef} muted playsInline autoPlay style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)", display: "block", borderRadius: "0" }} />
      </VStack>
      <HStack role="status" aria-live="polite" gap={2} align="center" style={{ position: "absolute", bottom: "var(--spacing-2)", left: "var(--spacing-2)", zIndex: 2, pointerEvents: "none", padding: "var(--spacing-1) var(--spacing-2)", borderRadius: "var(--radius-element)", background: "var(--color-background-card)" }}>
        <StatusDot label={cameraStatusLabel} variant={!cameraEnabled ? "neutral" : cameraHealthy ? "success" : cameraError ? "warning" : "neutral"} />
        <Text type="supporting">{cameraStatusLabel}</Text>
      </HStack>
    </VStack>
  );
}
