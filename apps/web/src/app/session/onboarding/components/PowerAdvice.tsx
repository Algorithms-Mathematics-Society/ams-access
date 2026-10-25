import { useEffect, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/Stack";
import { invoke } from "../support";

type BatterySnapshot = { percentage: number; charging: boolean; plugged_in?: boolean | null };

// Below this on battery, a two-hour paper is unlikely to last.
const LOW_BATTERY_PERCENT = 40;

/**
 * Keeping awake stops idle sleep, not lid-close sleep, and a lid close is
 * recorded as a violation. Say so before the contest, and flag a battery
 * that will not last while there is still time to find a charger.
 */
export function PowerAdvice() {
  const [battery, setBattery] = useState<BatterySnapshot | null>(null);
  useEffect(() => {
    void invoke<BatterySnapshot>("get_battery_status").then(setBattery);
  }, []);
  // `plugged_in` is absent on older installs; `charging` stands in, as in BatteryStatus.
  const low =
    battery !== null &&
    !(battery.plugged_in ?? battery.charging) &&
    battery.percentage < LOW_BATTERY_PERCENT;

  return (
    <VStack gap={3}>
      <Text>Keep the lid open and the charger connected. Closing the lid is reported.</Text>
      {low && (
        <Banner
          status="warning"
          title={`Battery at ${battery.percentage}% and not charging`}
          description="Connect your charger before you continue. A Mac that sleeps or shuts down during the contest is reported."
        />
      )}
    </VStack>
  );
}
