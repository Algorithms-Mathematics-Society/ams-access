import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Mic, MicOff, AlertCircle, RefreshCw } from "lucide-react";
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
  notice,
  onToggleMute,
  onRequestJoin,
  onDismiss,
  canJoin,
  children,
}: {
  compact: boolean;
  toolbarTarget: HTMLElement | null;
  lobbyTarget?: HTMLElement | null;
  suspended: boolean;
  snapshot: TeamVoiceSnapshot | null;
  notice?: string | null;
  onToggleMute: () => void;
  onRequestJoin: () => void;
  onDismiss: () => void;
  canJoin: boolean;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;
  useEffect(() => {
    if (suspended || !compact) {
      setExpanded(false);
      onDismiss();
    }
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
        onDismiss();
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
  const busy = snapshot?.status === "connecting";
  const reconnecting = snapshot?.status === "reconnecting";
  const attention = Boolean(notice || snapshot?.error);
  const settingsLabel = reconnecting ? "Reconnecting…" : attention ? "Audio issue" : "Voice";
  return createPortal(
    <HStack
      gap={2}
      align="center"
      wrap="wrap"
      style={{ flexShrink: 0, minWidth: 0, maxWidth: "100%" }}
      inert={suspended || undefined}
      aria-label="Team voice"
    >
      {connected && (
        <Button
          size="sm"
          label={snapshot?.muted ? "Muted" : "Live"}
          aria-label={
            snapshot?.muted ? "Muted: unmute team microphone" : "Live: mute team microphone"
          }
          aria-pressed={!snapshot?.muted}
          aria-keyshortcuts="Control+Shift+M"
          tooltip={`${snapshot?.muted ? "Unmute" : "Mute"} team microphone (Ctrl+Shift+M)`}
          icon={snapshot?.muted ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}
          style={{
            background: snapshot?.muted ? undefined : "var(--color-success-muted)",
            borderColor: snapshot?.muted ? undefined : "var(--color-border-green)",
            color: snapshot?.muted ? "var(--color-text-secondary)" : "var(--color-text-green)",
          }}
          onClick={onToggleMute}
          isDisabled={suspended}
        />
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
          if (!open) onDismiss();
          setExpanded(open);
        }}
        isEnabled={!suspended}
        content={children}
      >
        <Button
          ref={triggerRef}
          size="sm"
          variant="secondary"
          label={
            !connected && canJoin && !busy ? "Join voice" : busy ? "Connecting…" : settingsLabel
          }
          icon={
            reconnecting ? (
              <RefreshCw aria-hidden="true" />
            ) : attention ? (
              <AlertCircle aria-hidden="true" />
            ) : undefined
          }
          tooltip={notice || snapshot?.error || "Open team voice settings"}
          onClick={() => {
            if (!suspended && !connected && canJoin && !busy) onRequestJoin();
          }}
          isDisabled={suspended}
        />
      </Popover>
    </HStack>,
    toolbarTarget
  );
}
