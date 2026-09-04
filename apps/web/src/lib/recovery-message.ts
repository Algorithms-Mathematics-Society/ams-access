/**
 * What to tell a candidate whose manual recovery did not fully succeed.
 *
 * The previous copy was one string for every platform:
 *
 *   "Some settings could not be restored automatically. Relaunch AMS Access,
 *    it re-runs recovery on startup, or restart your Mac."
 *
 * Both halves are wrong on Linux, and Linux is the platform where this card
 * matters most. Relaunching re-runs `recover_keyboard_if_crashed` and nothing
 * else: there is no Linux startup firewall reconciliation, so the egress rules
 * a crashed session left behind survive the relaunch untouched. And the
 * machine is not a Mac.
 *
 * macOS and Windows both DO flush the firewall on next launch, so "relaunch"
 * is honest advice there and is kept.
 *
 * Pure and dependency-free so the wording is testable, which is the point:
 * this is the last thing a stranded candidate reads.
 */

/** Prefix match, per the Windows-label invariant: `get_platform` reports
 * `windows_no_admin`, `windows_msix` and `windows_no_firewall` as well as the
 * bare `windows`, and a `===` check silently drops all three. */
function isPlatform(platform: string | null | undefined, prefix: string): boolean {
  return typeof platform === "string" && platform.toLowerCase().startsWith(prefix);
}

const RELAUNCH =
  "Some settings could not be restored automatically. Relaunch AMS Access, which re-runs recovery on startup.";

export function recoveryFailureMessage(platform: string | null | undefined): string {
  if (isPlatform(platform, "linux")) {
    // No "relaunch": on Linux that restores the desktop settings but not the
    // firewall, and promising otherwise sends the candidate round a loop that
    // cannot fix what they are actually stuck behind.
    return (
      "Your desktop settings were restored, but the exam network rules could not be removed: " +
      "the proctoring network component did not respond. Show an invigilator the command below, " +
      "or restart the computer, which clears the rules."
    );
  }
  if (isPlatform(platform, "macos") || isPlatform(platform, "windows")) {
    return RELAUNCH;
  }
  // Unknown platform: say only what is true everywhere.
  return "Some settings could not be restored automatically. Ask an invigilator for help.";
}

/**
 * A copyable command that clears the lockdown by hand, for the one platform
 * where relaunching cannot.
 *
 * Both families: the helper builds an ip6tables chain whenever an IPv6 stack
 * is present, so clearing only v4 leaves half the lockdown applied.
 */
export function manualRecoveryCommand(platform: string | null | undefined): string | null {
  if (!isPlatform(platform, "linux")) return null;
  return [
    "sudo iptables -D OUTPUT -j AMS_PROCTOR; sudo iptables -F AMS_PROCTOR; sudo iptables -X AMS_PROCTOR",
    "sudo ip6tables -D OUTPUT -j AMS_PROCTOR; sudo ip6tables -F AMS_PROCTOR; sudo ip6tables -X AMS_PROCTOR",
    "sudo rm -f /run/ams-proctor.lock",
  ].join("\n");
}
