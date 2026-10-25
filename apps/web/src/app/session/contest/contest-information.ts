/** UTC labels stay consistent across candidate machines and device timezones. */
export function contestTimestamp(value: string | null | undefined): string {
  const time = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(time)) return "Not provided";
  return new Date(time)
    .toISOString()
    .replace("T", " ")
    .replace(/:00\.000Z$/, " UTC")
    .replace(/\.\d{3}Z$/, " UTC");
}
export function clockDifferenceMessage(
  synchronised: boolean,
  serverTime: number,
  localTime: number
): string | null {
  if (!synchronised || !Number.isFinite(serverTime) || !Number.isFinite(localTime)) return null;
  if (Math.abs(serverTime - localTime) < 60_000) return null;
  return "Your device clock differs from the server by at least one minute. The countdown uses server time. Reconnect to refresh it; if the published schedule disagrees, ask an invigilator. Changing your device clock does not extend the contest.";
}
