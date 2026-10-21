import { useEffect, useState } from "react";
import { Battery, BatteryCharging } from "lucide-react";
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";

interface BatterySnapshot {
  percentage: number;
  charging: boolean;
}

const REFRESH_INTERVAL_MS = 30_000;

export function BatteryStatus() {
  const [battery, setBattery] = useState<BatterySnapshot | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const snapshot = await window.__TAURI__?.core.invoke<BatterySnapshot | null>(
          "get_battery_status"
        );
        if (active) setBattery(snapshot ?? null);
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

  const label = battery.charging
    ? `Battery ${battery.percentage} percent, connected to power`
    : `Battery ${battery.percentage} percent, not charging`;
  const Icon = battery.charging ? BatteryCharging : Battery;
  return (
    <HStack
      gap={1}
      align="center"
      aria-label={label}
      style={{ flexShrink: 0, color: "var(--color-text-secondary)" }}
    >
      <Icon size={16} aria-hidden="true" />
      <Text type="code" color="inherit" hasTabularNumbers>
        {battery.percentage}%
      </Text>
    </HStack>
  );
}
