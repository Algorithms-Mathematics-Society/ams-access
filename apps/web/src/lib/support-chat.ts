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
  email: string;
  phone: string;
  name: string;
  body: string;
  category: string;
  organization: string;
};
export type SupportReceipt = {
  access: SupportAccess;
  pendingStart?: SupportStart;
  pendingMessage?: { uid: string; body: string };
};
export const SUPPORT_STORAGE_KEY = "ams_support_conversation_v1";

export function newSupportAccess(): SupportAccess {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return {
    uid: crypto.randomUUID(),
    token: Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""),
  };
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const categories = new Set(["LOGIN", "READINESS", "POLICY_BLOCK", "DISCONNECT", "OTHER"]);
const bounded = (value: unknown, min: number, max: number): value is string =>
  typeof value === "string" && value.trim().length >= min && value.length <= max;

export function parseSupportReceipt(value: string | null): SupportReceipt | null {
  if (!value) return null;
  try {
    const data = JSON.parse(value) as SupportReceipt;
    if (!data || !UUID.test(data.access?.uid) || !/^[a-f0-9]{64}$/.test(data.access?.token))
      return null;
    const start = data.pendingStart;
    if (
      start &&
      (start.uid !== data.access.uid ||
        start.token !== data.access.token ||
        !bounded(start.email, 3, 320) ||
        !bounded(start.phone, 5, 40) ||
        !bounded(start.name, 1, 120) ||
        !bounded(start.body, 1, 4000) ||
        !bounded(start.organization, 0, 100) ||
        !categories.has(start.category))
    )
      return null;
    const message = data.pendingMessage;
    if (message && (!UUID.test(message.uid) || !bounded(message.body, 1, 4000))) return null;
    if (start && message) return null;
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
      saved.token === sent.token &&
      saved.email === sent.email &&
      saved.phone === sent.phone &&
      saved.name === sent.name &&
      saved.body === sent.body &&
      saved.category === sent.category &&
      saved.organization === sent.organization
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
  body?: unknown
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(access ? { Authorization: `Bearer ${access.token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) {
      const detail =
        typeof data.detail === "string" && data.detail.trim()
          ? data.detail
          : response.status === 429
            ? "Too many requests. Retry later."
            : "Check your contact details and retry.";
      throw new Error(detail);
    }
    return data as T;
  } catch (error) {
    if (error instanceof Error && error.name !== "AbortError" && !(error instanceof TypeError))
      throw error;
    throw new Error(
      "Connection interrupted. Delivery is not confirmed. Retry safely when connected."
    );
  } finally {
    clearTimeout(timer);
  }
}
