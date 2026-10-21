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
 * Failure is silence. A candidate about to sit an exam must never be stopped
 * by a version check that could not reach the server -- the thing this
 * prevents is a worse contest morning, not a safety property.
 */

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
          : "https://amsaccess.com/download",
    };
  } catch {
    // Offline, blocked, slow, or a server that does not serve this yet.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
