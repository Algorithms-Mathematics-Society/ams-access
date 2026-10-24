import { useEffect, useState } from "react";
import { Battery, BatteryCharging, BatteryLow, Plug } from "lucide-react";
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";

interface BatterySnapshot {
  percentage: number;
  charging: boolean;
  // Absent from installs older than the field; `charging` stands in then.
  plugged_in?: boolean | null;
}

const REFRESH_INTERVAL_MS = 30_000;
// At or below this on battery the reading turns to the warning colour: roughly
// the last half hour on most laptops, not enough for a two-hour paper.
const LOW_BATTERY_PERCENT = 20;

export function BatteryStatus() {
  const [battery, setBattery] = useState<BatterySnapshot | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        // Native only.
        //
        // `navigator.getBattery()` was tried as a fallback and had to come
        // back out: browsers coarsen it deliberately to resist
        // fingerprinting, and Brave farbles it outright -- it reported a
        // flat 100% on a laptop sitting at 60%. A battery indicator that
        // lies is worse than none, because a candidate reading 100% does not
        // go and find a cable.
        //
        // So it shows nothing until the app is one that can ask the OS. That
        // is a browser dev build, or an install older than the release that
        // added the command.
        const native = await window.__TAURI__?.core.invoke<BatterySnapshot | null>(
          "get_battery_status"
        );
        if (active) setBattery(native ?? null);
      } catch {
        if (active) setBattery(null);
      }
    };
    const refreshWhenVisible = () => {
      if (!document.hidden) void refresh();
    };

    void refresh();
    const interval = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
    };
  }, []);

  if (!battery) return null;

  // The state is spelled out, not left to the icon: a candidate glancing at
  // the bar should not have to tell a bolt from a plain battery at 16px.
  const pluggedIn = battery.plugged_in ?? battery.charging;
  const low = !pluggedIn && battery.percentage <= LOW_BATTERY_PERCENT;
  const state = battery.charging ? "Charging" : pluggedIn ? "Plugged in" : "On battery";
  const Icon = battery.charging ? BatteryCharging : pluggedIn ? Plug : low ? BatteryLow : Battery;
  const label = `Battery ${battery.percentage} percent, ${
    battery.charging ? "charging" : pluggedIn ? "plugged in, not charging" : "on battery"
  }${low ? ", low" : ""}`;
  return (
    <HStack
      gap={1}
      align="center"
      aria-label={label}
      style={{
        flexShrink: 0,
        color: low ? "var(--color-text-orange)" : "var(--color-text-secondary)",
      }}
    >
      <Icon size={16} aria-hidden="true" />
      <Text type="code" color="inherit" hasTabularNumbers>
        {battery.percentage}%
      </Text>
      <Text type="supporting" color="inherit" textWrap="nowrap">
        {state}
      </Text>
    </HStack>
  );
}
