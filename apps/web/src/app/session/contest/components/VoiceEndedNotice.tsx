import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Text } from "@astryxdesign/core/Text";

/** Announce a real open-to-closed transition, never a stale poll or initial wait. */
export function useVoiceEndedNotice({
  contestUid,
  enabled,
  status,
  voiceOpen,
  compact,
  toolbarTarget,
}: {
  contestUid: string;
  enabled: boolean;
  status: string;
  voiceOpen: boolean;
  compact: boolean;
  toolbarTarget: HTMLElement | null;
}) {
  const wasOpen = useRef(false);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    wasOpen.current = false;
    setVisible(false);
  }, [contestUid]);
  useEffect(() => {
    if (enabled && status === "team" && voiceOpen) {
      wasOpen.current = true;
      setVisible(false);
    } else if (wasOpen.current && (!enabled || (status === "team" && !voiceOpen))) {
      wasOpen.current = false;
      setVisible(true);
    }
  }, [enabled, status, voiceOpen]);
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setVisible(false), 5000);
    return () => clearTimeout(timer);
  }, [visible]);
  if (!visible || (!compact && enabled)) return null;
  const notice = (
    <Text role="status" aria-live="polite">
      Voice has ended for this round
    </Text>
  );
  return compact && toolbarTarget ? createPortal(notice, toolbarTarget) : notice;
}
