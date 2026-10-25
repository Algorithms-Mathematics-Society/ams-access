import { useEffect, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { invoke } from "../support";

type BatterySnapshot = { percentage: number; charging: boolean; plugged_in?: boolean | null };

// Below this on battery, a two-hour paper is unlikely to last.
const LOW_BATTERY_PERCENT = 40;

/**
 * Flags a battery that will not last while there is still time to find a
 * charger. Sleep, a closed lid included, is already reported as `system_sleep`.
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

  if (!low) return null;
  return (
    <Banner
      status="warning"
      title={`Battery at ${battery.percentage}% and not charging`}
      description="Connect your charger before you continue. A Mac that sleeps or shuts down during the contest is reported."
    />
  );
}
