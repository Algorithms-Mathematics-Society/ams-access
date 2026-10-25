/**
 * Noticing that a newer proctor has been published.
 *
 * The app has no auto-updater and the exam machine's network lockdown
 * permits exactly one host, so the only way a candidate learns they are
 * behind is if the exam server tells them. `GET /client/version` is
 * unauthenticated for that reason: the question is asked on the login
 * screen, before anyone has signed in.
 *
 * **Minor releases only.** A patch goes out to fix something for the people
 * it affects; interrupting a thousand candidates to reinstall over one is
 * noise, and noise is how a prompt that matters gets dismissed without being
 * read. 3.1.2 to 3.1.9 says nothing. 3.1.2 to 3.2.0 is worth a sentence.
 *
 * **Only `minimum` blocks.** `latest` is advisory -- the server says so -- and
 * an organizer publishing a release the night before must not lock every
 * candidate still on the old build out of the exam. A newer `latest` is a
 * notice to install after the exam; only a build the server would refuse
 * with 426 anyway is stopped here.
 *
 * Failure is silence. A candidate about to sit an exam must never be stopped
 * by a version check that could not reach the server -- the thing this
 * prevents is a worse contest morning, not a safety property.
 */

export const DEFAULT_DOWNLOAD_URL = "https://amsaccess.com/download";

export type ClientVersionInfo = {
  minimum: string;
  latest: string;
  download_url: string;
};

type Parsed = { major: number; minor: number };

/** `3.2.0` or `3.2.0-rc.1` to its major and minor. Null if unparseable. */
export function parseMajorMinor(raw: string): Parsed | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/.exec((raw ?? "").trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

/**
 * Whether `latest` is a newer minor release than `current`.
 *
 * Mirrors `minor_upgrade_available` in ams-api's api/client_version.py. Both
 * exist because the server decides what is published and the client decides
 * whether to interrupt; neither can be the only one that knows the rule.
 */
export function minorUpgradeAvailable(current: string, latest: string): boolean {
  const here = parseMajorMinor(current);
  const there = parseMajorMinor(latest);
  if (!here || !there) return false;
  if (there.major !== here.major) return there.major > here.major;
  return there.minor > here.minor;
}

/**
 * Whether `current` is older than `minimum`, the build the server refuses.
 *
 * Mirrors `is_supported` in ams-api's api/client_version.py, including that a
 * pre-release of the minimum is below it. Unlike the server, an unparseable
 * version on either side is *not* below: silence, as above.
 */
export function belowMinimum(current: string, minimum: string): boolean {
  const parse = (raw: string) => /^(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec((raw ?? "").trim());
  const here = parse(current);
  const floor = parse(minimum);
  if (!here || !floor) return false;
  for (let i = 1; i <= 3; i++) {
    if (Number(here[i]) !== Number(floor[i])) return Number(here[i]) < Number(floor[i]);
  }
  return Boolean(here[4]) && !floor[4];
}

/**
 * Ask the server what it publishes.
 *
 * Its own fetch rather than the shared `request()` helper: that one attaches
 * a bearer token and is wrapped in participant error handling, and this runs
 * before login with nothing to attach.
 */
export async function fetchClientVersion(
  apiBase: string,
  timeoutMs = 6_000
): Promise<ClientVersionInfo | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${apiBase.replace(/\/$/, "")}/client/version`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<ClientVersionInfo>;
    if (typeof body?.latest !== "string") return null;
    return {
      minimum: typeof body.minimum === "string" ? body.minimum : "",
      latest: body.latest,
      download_url:
        typeof body.download_url === "string" && body.download_url
          ? body.download_url
          : DEFAULT_DOWNLOAD_URL,
    };
  } catch {
    // Offline, blocked, slow, or a server that does not serve this yet.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
