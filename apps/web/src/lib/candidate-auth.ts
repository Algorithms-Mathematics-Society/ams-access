/**
 * Candidate JWT helpers — token storage + Authorization header factory.
 *
 * The backend returns a `token` field on successful /students/verify-otp and
 * /students/login responses.  These helpers store/retrieve that JWT in
 * localStorage and build the Authorization header for authenticated requests.
 *
 * All localStorage access is SSR-guarded (`typeof window !== "undefined"`) so
 * the module is safe to import in Server Components and during Next.js SSG.
 *
 * Key string kept in sync with STORAGE_KEYS.CANDIDATE_TOKEN in
 * src/constants/storage-keys.ts ("ams_candidate_token").
 */

const KEY = "ams_candidate_token";

/** Returns the stored candidate JWT, or null if absent or running on the server. */
export function getCandidateToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(KEY);
}

/** Persists the candidate JWT to localStorage. No-ops on the server. */
export function setCandidateToken(t: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, t);
}

/** Removes the candidate JWT from localStorage. No-ops on the server. */
export function clearCandidateToken(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
}

/**
 * Builds a plain-object header map for authenticated fetch calls.
 *
 * - When a token is stored: `{ Authorization: "Bearer <token>", ...extra }`
 * - When no token is stored: `{ ...extra }` (no Authorization key)
 *
 * The caller merges this into their own `headers` object; T11 will wire it up
 * at each call site.
 */
export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getCandidateToken();
  if (token) {
    return { Authorization: `Bearer ${token}`, ...extra };
  }
  return { ...extra };
}
