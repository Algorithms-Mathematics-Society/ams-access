export function footerCameraStatus(
  enabled: boolean,
  healthy: boolean,
  error: string | null
): "on" | "off" | "starting" {
  // Disabling a track does not clear the preview's previously decoded frame.
  if (!enabled || error) return "off";
  return healthy ? "on" : "starting";
}
