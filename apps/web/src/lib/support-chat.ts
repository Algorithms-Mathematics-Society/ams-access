import { SupportRequestError, supportRetryAfterMs } from "./support-poll.ts";
import { CLIENT_VERSION } from "./proctor-api.ts";
import { STORAGE_KEYS } from "../constants/storage-keys.ts";

/** Support capabilities are unrelated to participant/exam bearer tokens. */
export type SupportMessage = {
  uid: string;
  sender: "participant" | "staff";
  body: string;
  created_at: string;
};
export type SupportThread = {
  uid: string;
  name: string;
  email: string;
  phone: string;
  category: string;
  status: "open" | "resolved";
  messages: SupportMessage[];
  has_more: boolean;
};
export type SupportAccess = { uid: string; token: string };
export type SupportStart = SupportAccess & {
  contest_uid?: string;
  email: string;
  phone: string;
  name: string;
  body: string;
  category: string;
  organization: string;
};
export type SupportReceipt = {
  owner?: string;
  access: SupportAccess;
  pendingStart?: SupportStart;
  pendingParticipantStart?: {
    contest_uid?: string;
    uid: string;
    token: string;
    category: string;
    body: string;
  };
  pendingMessage?: { uid: string; body: string };
};
export type GuestIssueDraft = {
  contest_uid?: string;
  uid: string;
  email: string;
  phone: string;
  name: string;
  body: string;
  category: string;
};
export const SUPPORT_STORAGE_KEY = STORAGE_KEYS.SUPPORT_CONVERSATION;

export function newSupportAccess(): SupportAccess {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return {
    uid: crypto.randomUUID(),
    token: Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""),
  };
}

export function parseGuestIssueDraft(value: string | null): GuestIssueDraft | null {
  if (!value) return null;
  try {
    const data = JSON.parse(value) as GuestIssueDraft;
    if (
      !data ||
      !UUID.test(data.uid) ||
      (data.contest_uid !== undefined && !UUID.test(data.contest_uid)) ||
      !bounded(data.email, 3, 320) ||
      !bounded(data.phone, 5, 40) ||
      !bounded(data.name, 1, 120) ||
      !bounded(data.body, 1, 4000) ||
      !categories.has(data.category)
    )
      return null;
    return data;
  } catch {
    return null;
  }
}

export function matchesGuestIssueDraft(
  current: GuestIssueDraft | null,
  expected: GuestIssueDraft
): boolean {
  return Boolean(
    current &&
    current.uid === expected.uid &&
    current.contest_uid === expected.contest_uid &&
    current.email === expected.email &&
    current.phone === expected.phone &&
    current.name === expected.name &&
    current.body === expected.body &&
    current.category === expected.category
  );
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const categories = new Set(["LOGIN", "READINESS", "POLICY_BLOCK", "DISCONNECT", "OTHER"]);
const bounded = (value: unknown, min: number, max: number): value is string =>
  typeof value === "string" && value.trim().length >= min && value.length <= max;

export function parseSupportReceipt(value: string | null): SupportReceipt | null {
  if (!value) return null;
  try {
    const data = JSON.parse(value) as SupportReceipt;
    if (
      !data ||
      (data.owner !== undefined && !UUID.test(data.owner)) ||
      !UUID.test(data.access?.uid) ||
      !/^[a-f0-9]{64}$/.test(data.access?.token)
    )
      return null;
    const start = data.pendingStart;
    if (
      start &&
      ((start.contest_uid !== undefined && !UUID.test(start.contest_uid)) ||
        start.uid !== data.access.uid ||
        start.token !== data.access.token ||
        !bounded(start.email, 3, 320) ||
        !bounded(start.phone, 5, 40) ||
        !bounded(start.name, 1, 120) ||
        !bounded(start.body, 1, 4000) ||
        !bounded(start.organization, 0, 100) ||
        !categories.has(start.category))
    )
      return null;
    const participantStart = data.pendingParticipantStart;
    if (
      participantStart &&
      ((participantStart.contest_uid !== undefined && !UUID.test(participantStart.contest_uid)) ||
        participantStart.uid !== data.access.uid ||
        participantStart.token !== data.access.token ||
        !bounded(participantStart.body, 1, 4000) ||
        !categories.has(participantStart.category))
    )
      return null;
    const message = data.pendingMessage;
    if (message && (!UUID.test(message.uid) || !bounded(message.body, 1, 4000))) return null;
    if ((start || participantStart) && message) return null;
    return data;
  } catch {
    return null;
  }
}

/** An acknowledgement owns only the capability and exact saved operation it sent. */
export function matchesSupportOperation(
  current: SupportReceipt | null,
  expected: SupportReceipt
): boolean {
  if (
    current?.owner !== expected.owner ||
    current?.access.uid !== expected.access.uid ||
    current?.access.token !== expected.access.token
  )
    return false;
  if (expected.pendingStart) {
    const saved = current.pendingStart;
    const sent = expected.pendingStart;
    return Boolean(
      saved &&
      saved.uid === sent.uid &&
      saved.contest_uid === sent.contest_uid &&
      saved.token === sent.token &&
      saved.email === sent.email &&
      saved.phone === sent.phone &&
      saved.name === sent.name &&
      saved.body === sent.body &&
      saved.category === sent.category &&
      saved.organization === sent.organization
    );
  }
  if (expected.pendingParticipantStart) {
    const saved = current.pendingParticipantStart;
    const sent = expected.pendingParticipantStart;
    return Boolean(
      saved &&
      saved.uid === sent.uid &&
      saved.contest_uid === sent.contest_uid &&
      saved.token === sent.token &&
      saved.body === sent.body &&
      saved.category === sent.category
    );
  }
  return Boolean(
    expected.pendingMessage &&
    current.pendingMessage &&
    current.pendingMessage.uid === expected.pendingMessage.uid &&
    current.pendingMessage.body === expected.pendingMessage.body
  );
}

export function mergeSupportMessages(
  current: SupportMessage[],
  incoming: SupportMessage[]
): SupportMessage[] {
  const seen = new Set(current.map((m) => m.uid));
  return [...current, ...incoming.filter((m) => !seen.has(m.uid) && !!seen.add(m.uid))];
}

export async function supportRequest<T>(
  base: string,
  path: string,
  access?: SupportAccess,
  body?: unknown,
  participantToken?: string,
  options: { signal?: AbortSignal } = {}
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = setTimeout(abort, 10000);
  try {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "X-AMS-Client-Version": CLIENT_VERSION,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(access ? { Authorization: `Bearer ${access.token}` } : {}),
        ...(participantToken ? { Authorization: `Bearer ${participantToken}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const responseBody = await response.text();
    if (controller.signal.aborted) throw new DOMException("Request aborted", "AbortError");
    let data: { detail?: unknown };
    try {
      const parsed: unknown = responseBody ? JSON.parse(responseBody) : {};
      data = parsed && typeof parsed === "object" ? (parsed as { detail?: unknown }) : {};
    } catch {
      // A proxy or server can commit the request and then return an HTML/error
      // page. Keep the original idempotency identifier so retry is safe.
      throw new Error(
        "The server response could not be confirmed. Delivery is not confirmed. Retry with the same request."
      );
    }
    if (!response.ok) {
      const detail =
        typeof data.detail === "string" && data.detail.trim()
          ? data.detail
          : response.status === 429
            ? "Too many requests. Retry later."
            : "Check your contact details and retry.";
      throw new SupportRequestError(
        detail,
        response.status,
        supportRetryAfterMs(response.headers?.get("Retry-After") ?? null)
      );
    }
    return data as T;
  } catch (error) {
    if (error instanceof Error && error.name !== "AbortError" && !(error instanceof TypeError))
      throw error;
    throw new Error(
      "Connection interrupted. Delivery is not confirmed. Retry safely when connected."
    );
  } finally {
    options.signal?.removeEventListener("abort", abort);
    clearTimeout(timer);
  }
}
