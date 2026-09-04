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
 *
 * `devApiUrl` retargets a DEV BUILD only, and cannot reach a release one.
 * See `resolveApiBase` for why that distinction is the whole design.
 */
export function apiBaseForLocation(location: LocationLike | null, devApiUrl?: string): string {
  const isDevServer =
    location !== null &&
    (location.protocol === "http:" || location.protocol === "https:") &&
    (location.hostname.toLowerCase() === "localhost" || location.hostname === "127.0.0.1") &&
    location.port === DEV_SERVER_PORT;

  // Every shipped origin returns here, before `devApiUrl` is so much as read.
  if (!isDevServer) return PROD_API_URL;

  const override = devApiUrl?.trim();
  return override ? override : DEV_API_URL;
}

/**
 * The host the egress firewall must keep reachable: the API's, and only it.
 *
 * Throws on a base it cannot parse. The previous version of this lived in two
 * copies (onboarding `support.ts` and `home/components/utils.ts`), and both
 * returned the literal `"localhost"` on a parse failure. That resolves to
 * `127.0.0.1`, which is a perfectly valid IP, so the helper's
 * empty-allowlist guard never fires and it builds a loopback-only chain: a
 * total egress blackout, applied successfully, reported to the candidate as
 * "engaged" and to the organizer as a pass.
 *
 * It was unreachable while the base was a compile-time constant. The dev
 * override above makes it reachable, so it is fixed in the same change.
 * Every caller invokes this inside a try/catch that fails closed, which is
 * the correct answer to "we cannot tell which host to allow".
 */
export function allowlistHostFor(apiBase: string): string {
  const { hostname } = new URL(apiBase);
  if (!hostname) throw new Error(`API base has no hostname: ${apiBase}`);
  return hostname;
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
  //
  // `NEXT_PUBLIC_DEV_API_URL` is a different animal and is safe for a reason
  // that is structural rather than a promise: `apiBaseForLocation` returns the
  // production constant for every non-dev-server origin BEFORE it reads the
  // override. A release bundle is served from `tauri://localhost` or
  // `http://tauri.localhost`, neither of which can carry port 3000, so baking
  // this variable into a shipped installer is inert. That is the property
  // `NEXT_PUBLIC_API_URL` never had, and `api-base.test.mjs` pins it.
  //
  // It exists because `tauri dev` otherwise has exactly one possible target,
  // `http://localhost:8080`, and a candidate-facing "Cannot reach the exam
  // server" is what you get when nothing is serving it. Point it at the real
  // API to rehearse against production:
  //
  //   NEXT_PUBLIC_DEV_API_URL=https://api.amsaccess.com pnpm --filter @ams/desktop dev
  //
  // `devCsp` already allows that origin, so no CSP change is needed; an
  // override aimed anywhere else is blocked by the dev CSP, which is a useful
  // accident rather than a designed one.
  return normalize(
    apiBaseForLocation(
      typeof window === "undefined" ? null : window.location,
      process.env.NEXT_PUBLIC_DEV_API_URL
    )
  );
}
