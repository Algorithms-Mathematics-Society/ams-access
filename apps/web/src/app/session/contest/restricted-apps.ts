/**
 * What to call the apps a readiness scan flagged.
 *
 * Two problems, both from the same screenshot. Discord runs six processes —
 * a main process, a GPU process and four renderers — and the scan reports
 * each one, so the dialog read `discord, discord, discord, discord, discord,
 * discord`. Six identical words tell a candidate nothing except that
 * something is wrong, and imply six things to close.
 *
 * The second is that a chat app cannot actually be closed the way the
 * instructions assumed. Discord and WhatsApp keep running in the system tray
 * after their window is shut, so "I closed it" and "the scan still sees it"
 * are both true at once, and the candidate has nothing left to click.
 */

/** One entry per app, in the order first seen, without duplicates. */
export function uniqueApps(found: string[] | undefined | null): string[] {
  if (!found) return [];
  const seen: string[] = [];
  for (const raw of found) {
    const name = (raw ?? "").trim();
    if (!name) continue;
    if (!seen.some((s) => s.toLowerCase() === name.toLowerCase())) seen.push(name);
  }
  return seen;
}

/** Title case for display: `ms-teams` reads as `Ms-teams` otherwise. */
const DISPLAY: Record<string, string> = {
  discord: "Discord",
  slack: "Slack",
  whatsapp: "WhatsApp",
  "whatsapp-for-linux": "WhatsApp",
  telegram: "Telegram",
  "telegram-desktop": "Telegram",
  "signal-desktop": "Signal",
  "element-desktop": "Element",
  teams: "Microsoft Teams",
  "ms-teams": "Microsoft Teams",
  zoom: "Zoom",
  "zoom.us": "Zoom",
  skype: "Skype",
  webex: "Webex",
  teamviewer: "TeamViewer",
  anydesk: "AnyDesk",
  obs64: "OBS",
  obs32: "OBS",
  obs: "OBS",
};

export function appLabel(name: string): string {
  const key = name
    .trim()
    .toLowerCase()
    .replace(/\.exe$/, "");
  return DISPLAY[key] ?? name.trim();
}

/** The flagged apps as one readable line. */
export function appList(found: string[] | undefined | null): string {
  const names = uniqueApps(found).map(appLabel);
  const deduped = names.filter((n, i) => names.indexOf(n) === i);
  return deduped.join(", ");
}

/**
 * What to tell a candidate about a chat app that is still running.
 *
 * Named rather than generic, because "close the flagged apps" is the advice
 * that failed: the window was already closed.
 */
export function trayHint(advisory: string[] | undefined | null): string | null {
  const names = uniqueApps(advisory).map(appLabel);
  const deduped = names.filter((n, i) => names.indexOf(n) === i);
  if (deduped.length === 0) return null;
  const subject =
    deduped.length === 1
      ? deduped[0]
      : `${deduped.slice(0, -1).join(", ")} and ${deduped[deduped.length - 1]}`;
  return (
    `${subject} ${deduped.length === 1 ? "keeps" : "keep"} running in the system tray after ` +
    `the window is closed. This does not stop you entering — it is only recorded. ` +
    `To clear it, right-click the tray icon near the clock and choose Quit.`
  );
}
