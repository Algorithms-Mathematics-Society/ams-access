/**
 * Headers for authenticated participant requests.
 *
 * This module used to store the token itself, under `ams_candidate_token`.
 * Nothing had written that key since sign-in moved to printed slips — the
 * slip login writes `ams_participant_token` via `proctor-api.ts` — so
 * `authHeaders()` silently returned no `Authorization` and every
 * authenticated route answered 401: the contest room bounced to the login
 * screen, organizer overrides came back empty, and the native event uploader
 * spooled forever without delivering.
 *
 * The token now has exactly one owner (`proctor-api.ts`). What is left here
 * is the device id and the header map.
 *
 * Imports are relative, not `@/`-aliased: the Node test runner does not
 * resolve the alias, and this module has to stay testable.
 */

import { currentToken } from "./proctor-api.ts";

// Inline rather than imported from `constants/storage-keys` for the same
// alias reason. Must stay in sync with STORAGE_KEYS.DEVICE_ID.
const DEVICE_ID_KEY = "ams_device_id";

/**
 * The stored device id, generating and persisting one on first call.
 *
 * Not the participant's identity — the token is that. This says *which
 * machine*, which is what readiness waivers are scoped to and what makes a
 * session resumed from somewhere else visible as a finding.
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

/** The participant bearer token, or null. Delegates to its single owner. */
export function participantToken(): string | null {
  if (typeof window === "undefined") return null;
  return currentToken();
}

/**
 * Header map for authenticated fetch calls.
 *
 * - `X-Device-Id` always, so the backend can bind and validate the machine.
 * - `Authorization: Bearer <token>` when a participant is signed in.
 * - Neither on the server; the caller merges its own headers over the top.
 */
export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = participantToken();
  const deviceId = getDeviceId();
  const base: Record<string, string> = {};
  if (token) base["Authorization"] = `Bearer ${token}`;
  if (deviceId) base["X-Device-Id"] = deviceId;
  return { ...base, ...extra };
}
