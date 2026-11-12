import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Mic, MicOff } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { Popover } from "@astryxdesign/core/Popover";
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import type { TeamVoiceSnapshot } from "@/lib/team-voice-engine";

/** Presentation moves; the owning voice session stays mounted across lobby entry. */
export function TeamVoicePresentation({
  compact,
  toolbarTarget,
  lobbyTarget,
  suspended,
  snapshot,
  onToggleMute,
  children,
}: {
  compact: boolean;
  toolbarTarget: HTMLElement | null;
  lobbyTarget?: HTMLElement | null;
  suspended: boolean;
  snapshot: TeamVoiceSnapshot | null;
  onToggleMute: () => void;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (suspended || !compact) setExpanded(false);
  }, [suspended, compact]);
  useEffect(() => {
    if (!expanded) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setExpanded(false);
      }
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [expanded]);
  if (!compact) return lobbyTarget ? createPortal(children, lobbyTarget) : null;
  if (!toolbarTarget) return null;
  const connected = snapshot?.status === "connected" || snapshot?.status === "reconnecting";
  return createPortal(
    <HStack
      gap={1}
      align="center"
      inert={suspended || undefined}
      role="group"
      aria-label="Team voice"
    >
      {connected && (
        <Button
          size="sm"
          label={snapshot.muted ? "Muted" : "Live"}
          aria-label={snapshot.muted ? "Unmute team microphone" : "Mute team microphone"}
          aria-pressed={!snapshot.muted}
          aria-keyshortcuts="Control+Shift+M"
          icon={snapshot.muted ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}
          onClick={onToggleMute}
          isDisabled={suspended}
        />
      )}
      {snapshot?.muted && (snapshot.inputLevel ?? 0) > 0.02 && (
        <Text role="status">You are muted</Text>
      )}
      {snapshot?.peers.map((peer) => (
        <Text
          key={peer.memberUid}
          role="img"
          aria-label={`${peer.displayName}: ${peer.speaking && !peer.muted ? "speaking" : peer.muted ? "muted" : "in voice"}`}
          style={{
            color:
              peer.speaking && !peer.muted
                ? "var(--color-text-green)"
                : "var(--color-text-secondary)",
          }}
        >
          {peer.speaking && !peer.muted ? "●" : "○"}
        </Text>
      ))}
      <Popover
        label="Team voice settings"
        alignment="end"
        width="min(calc(100vw - var(--spacing-8)), calc(var(--spacing-10) * 10))"
        isOpen={expanded && !suspended}
        onOpenChange={setExpanded}
        isEnabled={!suspended}
        content={children}
      >
        <Button
          size="sm"
          variant="ghost"
          label="Voice"
          aria-label="Open team voice settings"
          isDisabled={suspended}
        />
      </Popover>
    </HStack>,
    toolbarTarget
  );
}
