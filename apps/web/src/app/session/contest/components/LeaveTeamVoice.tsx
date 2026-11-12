import { useState } from "react";
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
  if (!confirming)
    return (
      <Button
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
        label="Stay in voice"
        variant="secondary"
        isDisabled={isDisabled}
        onClick={() => setConfirming(false)}
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
