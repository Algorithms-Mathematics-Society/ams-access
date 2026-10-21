import { useEffect, useState } from "react";
import { Battery, BatteryCharging } from "lucide-react";
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";

interface BatterySnapshot {
  percentage: number;
  charging: boolean;
}

const REFRESH_INTERVAL_MS = 30_000;

type WebBatteryManager = {
  level: number;
  charging: boolean;
};

/** `navigator.getBattery()`, where it exists. Null everywhere else --
 *  WebKitGTK does not implement it, and a missing battery is not an error. */
async function readWebBattery(): Promise<BatterySnapshot | null> {
  const getBattery = (
    navigator as Navigator & { getBattery?: () => Promise<WebBatteryManager> }
  ).getBattery;
  if (typeof getBattery !== "function") return null;
  try {
    const manager = await getBattery.call(navigator);
    const level = Math.round((manager.level ?? 0) * 100);
    if (!Number.isFinite(level) || level < 0 || level > 100) return null;
    return { percentage: level, charging: Boolean(manager.charging) };
  } catch {
    return null;
  }
}

export function BatteryStatus() {
  const [battery, setBattery] = useState<BatterySnapshot | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const native = await window.__TAURI__?.core.invoke<BatterySnapshot | null>(
          "get_battery_status"
        );
        if (!active) return;
        if (native) {
          setBattery(native);
          return;
        }
        // Fall back to the web API.
        //
        // The native command is absent in two real cases: a browser dev
        // build, which has no Tauri at all, and an installed app older than
        // the release that added the command. Chromium-based webviews
        // (Windows WebView2) implement getBattery, so the indicator still
        // appears there rather than silently rendering nothing -- which is
        // what it did.
        const web = await readWebBattery();
        if (active) setBattery(web);
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
