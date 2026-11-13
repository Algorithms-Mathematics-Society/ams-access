import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Mic, MicOff } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { Popover } from "@astryxdesign/core/Popover";
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import type { TeamVoiceSnapshot } from "@/lib/team-voice-engine";
import { acquireOrdinaryEscape } from "../escape-ownership";

function hasVisiblePriorityDialog() {
  // The voice Popover itself is a dialog; only another visible dialog outranks it.
  return Array.from(
    document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')
  ).some(
    (dialog) =>
      dialog.getAttribute("aria-label") !== "Team voice settings" &&
      !dialog.closest("[hidden], [inert]") &&
      dialog.getClientRects().length > 0 &&
      getComputedStyle(dialog).visibility !== "hidden"
  );
}

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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;
  useEffect(() => {
    if (suspended || !compact) setExpanded(false);
  }, [suspended, compact]);
  useEffect(() => {
    if (!expanded || suspended || !compact || !toolbarTarget) return;
    const releaseEscape = acquireOrdinaryEscape();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (suspendedRef.current) return;
        if (hasVisiblePriorityDialog()) return;
        event.preventDefault();
        setExpanded(false);
        triggerRef.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("keydown", escape, true);
      releaseEscape();
    };
  }, [expanded, suspended, compact, toolbarTarget]);
  if (!compact) return lobbyTarget ? createPortal(children, lobbyTarget) : null;
  if (!toolbarTarget) return null;
  const connected = snapshot?.status === "connected" || snapshot?.status === "reconnecting";
  return createPortal(
    <HStack gap={1} align="center" inert={suspended || undefined} aria-label="Team voice">
      {connected && (
        <Button
          size="sm"
          label={snapshot.muted ? "Muted" : "Live"}
          aria-label={snapshot.muted ? "Unmute team microphone" : "Mute team microphone"}
          aria-pressed={!snapshot.muted}
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
        hasEscapeDismiss={false}
        onOpenChange={(open) => {
          if (
            !open &&
            !suspendedRef.current &&
            !hasVisiblePriorityDialog() &&
            document.activeElement?.closest('[role="dialog"][aria-label="Team voice settings"]')
          )
            triggerRef.current?.focus({ preventScroll: true });
          setExpanded(open);
        }}
        isEnabled={!suspended}
        content={children}
      >
        <Button
          ref={triggerRef}
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
