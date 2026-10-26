/**
 * What the organizers need this candidate to read, right now.
 *
 * On 24 October the round was postponed and candidates kept competing for
 * hours, some to the end, because the only channels were WhatsApp and email
 * and a locked-down proctor shows neither. This is the in-app channel.
 *
 * The server does not push. Every heartbeat already carries an
 * `announcement_revision`, so the client spends a request on the text only
 * when that integer moves -- the same contract the reference sheet uses.
 *
 * Acknowledgement is the point, not a nicety. "Sent" is not "seen", and the
 * server records who pressed the button. This module keeps a local copy of
 * that fact as well, so a candidate who acknowledged and then reloaded is not
 * shown the same postponement again while their ack is still in flight. The
 * server stays the source of truth; this is only here to stop a duplicate.
 *
 * The store is injected rather than reaching for `localStorage` so the
 * decision logic is testable, following `answer-buffer.ts`.
 */

export type KeyValueStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** One announcement, as the server sends it. */
export type Announcement = {
  uid: string;
  title: string;
  body: string;
  created_at: string;
  acknowledged: boolean;
};

const PREFIX = "ams_contest_ack";

/** Where one candidate's acknowledgement of one announcement is remembered. */
export function ackKey(sessionId: string, announcementUid: string): string {
  return `${PREFIX}:${sessionId}:${announcementUid}`;
}

/**
 * Whether the text is worth fetching.
 *
 * Strictly greater, never merely different: a server that somehow reports a
 * lower number must not make the client re-fetch in a loop. Zero is the
 * resting state, so the first real announcement always qualifies.
 */
export function shouldFetch(lastSeenRevision: number, liveRevision: unknown): boolean {
  if (!Number.isSafeInteger(liveRevision)) return false;
  const live = liveRevision as number;
  if (live <= 0) return false;
  return live > lastSeenRevision;
}

/**
 * Fail closed on anything malformed or oversized.
 *
 * An announcement interrupts a thousand people mid-exam. A truncated or
 * half-parsed one is worse than none, because the candidate acts on it. The
 * UTF-16 length is checked before `Array.from` so an oversized body bounds
 * the work rather than allocating a code-point array first -- the same guard
 * `reference-sheet.ts` documents.
 */
export function readAnnouncement(value: unknown): Announcement | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<Announcement>;
  // Every cheap check first, for both fields, before either code-point
  // count. Interleaving them meant an oversized body still paid for an
  // `Array.from` over the title, which defeats the point of bounding work
  // on a response a thousand clients fetch at once.
  if (
    typeof row.uid !== "string" ||
    !row.uid.trim() ||
    row.uid.length > 64 ||
    typeof row.title !== "string" ||
    typeof row.body !== "string" ||
    typeof row.created_at !== "string" ||
    row.title.length > 240 ||
    row.body.length > 8_000 ||
    !row.title.trim() ||
    !row.body.trim() ||
    !Number.isFinite(Date.parse(row.created_at))
  )
    return null;
  if (Array.from(row.title).length > 120 || Array.from(row.body).length > 4_000) return null;
  return {
    uid: row.uid,
    title: row.title,
    body: row.body,
    created_at: row.created_at,
    acknowledged: row.acknowledged === true,
  };
}

/** Every announcement in a response that survives validation. */
export function readAnnouncements(value: unknown): Announcement[] {
  if (!Array.isArray(value)) return [];
  const out: Announcement[] = [];
  // Bounded independently of the server's own limit: a client that would
  // render an unbounded list is a client that can be made to hang.
  for (const row of value.slice(0, 50)) {
    const parsed = readAnnouncement(row);
    if (parsed) out.push(parsed);
  }
  return out;
}

/** Remember that this candidate acknowledged this announcement. */
export function rememberAck(
  store: KeyValueStore,
  sessionId: string,
  announcementUid: string,
): void {
  try {
    store.setItem(ackKey(sessionId, announcementUid), String(Date.now()));
  } catch {
    // A full or blocked store must never stop an exam. The server has the
    // authoritative record; losing the local copy costs at worst one
    // re-display after a reload.
  }
}

/** Whether this device remembers acknowledging it. */
export function wasAcked(
  store: KeyValueStore,
  sessionId: string,
  announcementUid: string,
): boolean {
  try {
    return store.getItem(ackKey(sessionId, announcementUid)) !== null;
  } catch {
    // Unreadable storage means "not acknowledged", which shows the
    // announcement again. Showing a postponement twice is a small annoyance;
    // hiding one is the failure this whole feature exists to prevent.
    return false;
  }
}

/**
 * The one to put on screen, or nothing.
 *
 * Oldest first, deliberately. If three announcements arrive while a candidate
 * was offline, they are read in the order they were issued -- "the round is
 * delayed", then "the round is postponed" -- which is the order that makes
 * sense. Showing the newest first would tell the story backwards.
 */
export function nextToShow(
  announcements: Announcement[],
  store: KeyValueStore,
  sessionId: string,
): Announcement | null {
  const pending = announcements
    .filter((row) => !row.acknowledged && !wasAcked(store, sessionId, row.uid))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  return pending[0] ?? null;
}
