/**
 * What to say when there was no HTTP response at all.
 *
 * `ProctorApiError` reports these as status 0, and the login screen collapsed
 * both of them into one sentence: "Cannot reach the exam server. Check the
 * network, or ask an invigilator."
 *
 * Two things were wrong with that. It names a remedy that was incorrect in the
 * incident that produced this module (the network was healthy; the app was
 * calling `http://localhost:8080`, which nothing was serving), and it never
 * says which host was called, which is the single fact that ends the
 * diagnosis. An invigilator holding that message has no way to tell a wrong
 * host from a dead DNS from a stale firewall allowlist from a real outage.
 *
 * Pure and dependency-free so it can be unit tested, following the precedent
 * in `violation-queue-core.ts` and `session-clock.ts`.
 */

export type UnreachableInput = {
  /** `ProctorApiError.code`: "TIMEOUT" or "UNREACHABLE". */
  code: string;
  /** `ProctorApiError.detail.api_base`. Typed loose because it crosses an
   * `unknown` boundary and this runs inside a catch block. */
  apiBase?: unknown;
};

export type UnreachableDescription = {
  /** The sentence the candidate reads. Calm, and never wrong. */
  message: string;
  /**
   * The line beneath it, for whoever is helping. `host · CODE`.
   *
   * The host is not a secret: it is in the binary, in the CSP and in DNS.
   * What it buys is that `localhost:8080 · UNREACHABLE` and
   * `api.amsaccess.com · TIMEOUT` are visibly different problems, and only
   * the second is one where checking the network is sound advice.
   */
  diagnostic: string;
};

const TIMEOUT_MESSAGE =
  "The exam server did not respond in time. Wait a moment and try again, or ask an invigilator.";

// Deliberately without "Check the network". A connection refused by a host
// that resolved is not a network fault, and that instruction is what sent an
// invigilator to the router while the real cause sat in the app's own config.
const UNREACHABLE_MESSAGE = "Cannot reach the exam server. Ask an invigilator.";

/** `host:port` for the base we tried, or null if it is not usable. */
function hostOf(apiBase: unknown): string | null {
  if (typeof apiBase !== "string" || apiBase.trim() === "") return null;
  try {
    return new URL(apiBase).host || null;
  } catch {
    return null;
  }
}

export function describeUnreachable(input: UnreachableInput): UnreachableDescription {
  const message = input.code === "TIMEOUT" ? TIMEOUT_MESSAGE : UNREACHABLE_MESSAGE;
  const host = hostOf(input.apiBase);
  const code = input.code.trim();

  // Never throws and never returns an empty string: this runs on the error
  // path, so it must not become the error.
  const diagnostic = host && code ? `${host} · ${code}` : (host ?? code);

  return { message, diagnostic };
}
