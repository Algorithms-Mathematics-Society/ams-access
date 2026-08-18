// Where the proctor talks to the platform.
//
// The Cloud Run backend this used to point at no longer exists. Everything
// now goes to api.amsaccess.com, which the desktop app reaches with TLS
// pinned to the Let's Encrypt roots — so this host must resolve straight to
// the origin (Cloudflare DNS-only), not through the orange cloud.
const PROD_API_URL = "https://api.amsaccess.com";

/** The Next dev server. Anything else on localhost is not it. */
const DEV_SERVER_PORT = "3000";
const DEV_API_URL = "http://localhost:8080";

function normalize(url: string): string {
  return url.replace(/\/+$/, "");
}

/** The parts of `window.location` this decision reads. */
export type LocationLike = {
  protocol: string;
  hostname: string;
  port: string;
};

/**
 * Which API host a page served from `location` should call.
 *
 * The subtlety, and it shipped broken twice: **Tauri serves the production
 * bundle from an origin whose hostname is `localhost`.** On Linux and macOS
 * that is `tauri://localhost`; on Windows it is `http://tauri.localhost`. A
 * bare `hostname === "localhost"` test therefore matches the real installed
 * app, which then calls a dev API on port 8080 that is not running — and the
 * release CSP blocks it too, so it surfaces as "Cannot reach the exam server"
 * with a perfectly healthy backend.
 *
 * The dev server is identified by its *port*, not its hostname. That is the
 * one thing `tauri://localhost` and `http://tauri.localhost` cannot have.
 */
export function apiBaseForLocation(location: LocationLike | null): string {
  const isDevServer =
    location !== null &&
    (location.protocol === "http:" || location.protocol === "https:") &&
    (location.hostname.toLowerCase() === "localhost" ||
      location.hostname === "127.0.0.1") &&
    location.port === DEV_SERVER_PORT;

  return isDevServer ? DEV_API_URL : PROD_API_URL;
}

export function resolveApiBase(): string {
  // NEXT_PUBLIC_API_URL is deliberately NOT read here.
  //
  // Next bakes NEXT_PUBLIC_* at build time, so a repository secret set in the
  // release workflow silently overrode this function entirely — and did, with
  // an address left over from a backend migration. It also hid the localhost
  // bug above by short-circuiting before it. The host is a constant, the CSP
  // allows exactly that constant, and `csp-allows-api-base.test.mjs` checks
  // the two agree. There is nothing left for an environment variable to do
  // except disagree with all three.
  return normalize(
    apiBaseForLocation(typeof window === "undefined" ? null : window.location)
  );
}
