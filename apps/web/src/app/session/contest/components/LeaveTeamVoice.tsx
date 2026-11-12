import { useEffect, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";

/** A stray click beside Mute must never disconnect the call. */
export function LeaveTeamVoice({
  onLeave,
  isDisabled = false,
}: {
  onLeave: () => void;
  isDisabled?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const leave = useRef<HTMLButtonElement>(null);
  const stay = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  // The pressed button unmounts; keep keyboard focus on the safe choice.
  useEffect(() => {
    if (confirming) stay.current?.focus();
    else if (returnFocus.current) leave.current?.focus();
    returnFocus.current = false;
  }, [confirming]);
  if (!confirming)
    return (
      <Button
        ref={leave}
        label="Leave voice"
        variant="ghost"
        isDisabled={isDisabled}
        onClick={() => setConfirming(true)}
      />
    );
  return (
    <HStack gap={2} align="center" wrap="wrap">
      <Text role="status">Leave team voice?</Text>
      <Button
        ref={stay}
        label="Stay in voice"
        variant="secondary"
        isDisabled={isDisabled}
        onClick={() => {
          returnFocus.current = true;
          setConfirming(false);
        }}
      />
      <Button
        label="Confirm leave voice"
        variant="ghost"
        isDisabled={isDisabled}
        onClick={() => {
          setConfirming(false);
          onLeave();
        }}
      />
    </HStack>
  );
}
