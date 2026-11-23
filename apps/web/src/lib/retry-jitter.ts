/**
 * Retry timing shared by every client that can fail at the same moment as the
 * rest of the room: a server restart or overload closes 136 sockets and fails
 * 136 polls together, and a fixed or barely-jittered delay brings them all back
 * together too (ams-api #144). Full jitter spreads them over the whole window.
 */

/** `floorMs` plus a uniform draw from [0, min(capMs, baseMs * 2^attempt)). */
export function jitteredDelayMs(
  attempt: number,
  options: { baseMs: number; capMs: number; floorMs?: number; random: () => number }
): number {
  const window = Math.min(options.capMs, options.baseMs * 2 ** Math.max(0, attempt));
  const draw = Math.max(0, Math.min(1, options.random()));
  return Math.max(0, options.floorMs ?? 0) + Math.floor(draw * window);
}

/** Seconds from a Retry-After header (delta-seconds or HTTP-date), else 0. */
export function retryAfterSeconds(headers: Pick<Headers, "get">): number {
  const value = headers.get("Retry-After")?.trim();
  if (!value) return 0;
  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    return Number.isSafeInteger(seconds) ? seconds : 0;
  }
  if (/^[+-]?\d+(?:\.\d+)?$/.test(value)) return 0;
  const deadline = Date.parse(value);
  const serverDate = Date.parse(headers.get("Date") ?? "");
  if (!Number.isFinite(deadline) || !Number.isFinite(serverDate)) return 0;
  return Math.max(0, Math.ceil((deadline - serverDate) / 1000));
}
