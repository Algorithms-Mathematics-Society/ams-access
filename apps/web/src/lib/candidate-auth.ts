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
// Inline device-id key to avoid a cross-module import that breaks the Node
// test runner (which strips @/ aliases).  Must stay in sync with
// STORAGE_KEYS.DEVICE_ID ("ams_device_id").
const DEVICE_ID_KEY = "ams_device_id";

/**
 * Returns the stored device ID, or generates and persists a new one.
 * Inline copy of getOrCreateDeviceId() from utils.ts — kept here so
 * authHeaders() has no cross-module import dependency.
 */
function getDeviceId(): string {
  if (typeof window === "undefined") return "";
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const generated =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? (crypto as { randomUUID(): string }).randomUUID()
      : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(DEVICE_ID_KEY, generated);
  return generated;
}

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
 * - Always includes `X-Device-Id: <deviceId>` (generated/retrieved from
 *   localStorage) so the backend can bind and validate the device.
 * - When a token is stored: also includes `Authorization: Bearer <token>`.
 * - On the server (SSR) both values are omitted (empty string / no key).
 *
 * The caller merges this into their own `headers` object.
 */
export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getCandidateToken();
  const deviceId = getDeviceId();
  const base: Record<string, string> = {};
  if (token) base["Authorization"] = `Bearer ${token}`;
  if (deviceId) base["X-Device-Id"] = deviceId;
  return { ...base, ...extra };
}
