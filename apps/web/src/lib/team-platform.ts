/** Team rooms are limited to the Windows, macOS and Linux installed desktop app. */
export function supportsNativeTeamPlatform(
  native: boolean,
  platform: string | null | undefined
): boolean {
  return native && (platform === "windows" || platform === "macos" || platform === "linux");
}

/** Browser platform values are only a desktop hint; the Tauri gate is mandatory.
 * Deliberately reject generic Linux/ARM and Android, which can share Linux hints.
 * WKWebView reports "MacIntel" on both Intel and Apple Silicon Macs.
 */
export function supportsTeamDesktopWebView(
  native: boolean,
  platform: string,
  userAgent = ""
): boolean {
  if (/Android/i.test(userAgent)) return false;
  return supportsNativeTeamPlatform(
    native,
    platform === "Win32" || platform === "Win64"
      ? "windows"
      : platform === "MacIntel"
        ? "macos"
        : platform === "Linux x86_64"
          ? "linux"
          : null
  );
}

export const TEAM_PLATFORM_MESSAGE =
  "Team rounds need the AMS Access app on Windows, macOS or Linux. Contact your organizer.";
