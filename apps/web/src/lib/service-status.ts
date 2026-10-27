/** Public operator reports are advisory; they never establish local API health. */
export const COMPONENTS = [
  "sign_in",
  "contest_entry",
  "judging",
  "submissions",
  "support",
  "general",
] as const;
export type Component = (typeof COMPONENTS)[number];
export type Platform = "windows" | "macos" | "linux" | "unknown";
export type Incident = {
  id: string;
  state: "investigating" | "identified" | "monitoring" | "resolved";
  components: Component[];
  platforms: ("all" | Exclude<Platform, "unknown">)[];
  title: string;
  message: string;
  candidate_action: string;
  updated_at: string;
  next_update_at: string;
};
export type Report = {
  schema_version: 1;
  revision: number;
  issued_at: string;
  valid_until: string;
  incidents: Incident[];
};
const keys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number) =>
  typeof v === "string" &&
  v.trim().length > 0 &&
  Array.from(v).length <= max &&
  !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);
export function timestamp(v: unknown): number {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v)) return NaN;
  const ms = Date.parse(v);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 19) === v.slice(0, 19)
    ? ms
    : NaN;
}
function choices(v: unknown, allowed: readonly string[]) {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.length <= allowed.length &&
    new Set(v).size === v.length &&
    v.every((x) => typeof x === "string" && allowed.includes(x))
  );
}
export function parseReport(v: unknown): Report {
  if (
    !object(v) ||
    !keys(v, ["schema_version", "revision", "issued_at", "valid_until", "incidents"]) ||
    v.schema_version !== 1 ||
    !Number.isSafeInteger(v.revision) ||
    Number(v.revision) < 1 ||
    !Array.isArray(v.incidents) ||
    v.incidents.length > 5
  )
    throw Error("Invalid status document");
  const issued = timestamp(v.issued_at),
    expiry = timestamp(v.valid_until);
  if (
    !Number.isFinite(issued) ||
    !Number.isFinite(expiry) ||
    expiry <= issued ||
    expiry - issued > 900_000
  )
    throw Error("Invalid status validity");
  const ids = new Set();
  for (const i of v.incidents) {
    if (
      !object(i) ||
      !keys(i, [
        "id",
        "state",
        "components",
        "platforms",
        "title",
        "message",
        "candidate_action",
        "updated_at",
        "next_update_at",
      ]) ||
      !text(i.id, 64) ||
      ids.has(i.id) ||
      !choices([i.state], ["investigating", "identified", "monitoring", "resolved"]) ||
      !choices(i.components, COMPONENTS) ||
      !choices(i.platforms, ["all", "windows", "macos", "linux"]) ||
      (Array.isArray(i.platforms) && i.platforms.includes("all") && i.platforms.length !== 1) ||
      !text(i.title, 120) ||
      !text(i.message, 600) ||
      !text(i.candidate_action, 300)
    )
      throw Error("Invalid incident");
    ids.add(i.id);
    const updated = timestamp(i.updated_at),
      next = timestamp(i.next_update_at);
    if (
      !Number.isFinite(updated) ||
      updated > issued ||
      !Number.isFinite(next) ||
      next < issued ||
      next > expiry
    )
      throw Error("Invalid incident time");
  }
  return v as Report;
}
export function relevant(
  report: Report | null,
  components: readonly Component[],
  platform: Platform
): Incident[] {
  return (
    report?.incidents.filter(
      (i) =>
        (i.components.includes("general") || i.components.some((c) => components.includes(c))) &&
        (platform === "unknown" || i.platforms.includes("all") || i.platforms.includes(platform))
    ) ?? []
  );
}
/** Missing/invalid transport time cannot be replaced with the candidate's clock. */
export function responseTime(headers: Headers): number | null {
  const date = headers.get("x-ams-status-time") ?? headers.get("date"),
    age = headers.get("age");
  const base = date ? Date.parse(date) : NaN;
  if (!Number.isFinite(base) || (age !== null && !/^\d+$/.test(age))) return null;
  const seconds = age === null ? 0 : Number(age);
  return Number.isSafeInteger(seconds) && seconds <= 86400 * 365 ? base + seconds * 1000 : null;
}
export type Snapshot = {
  report: Report | null;
  serverTime: number | null;
  receivedAt: number;
  checked: boolean;
  failed: boolean;
  offline: boolean;
  checking: boolean;
  now: number;
};
export const EMPTY_STATUS: Snapshot = {
  report: null,
  serverTime: null,
  receivedAt: 0,
  checked: false,
  failed: false,
  offline: false,
  checking: false,
  now: 0,
};
export function reportTime(s: Snapshot): number | null {
  return s.serverTime === null ? null : s.serverTime + Math.max(0, s.now - s.receivedAt);
}
export function isCurrent(s: Snapshot): boolean {
  const time = reportTime(s);
  return (
    !!s.report &&
    !s.failed &&
    !s.offline &&
    time !== null &&
    time >= timestamp(s.report.issued_at) &&
    time < timestamp(s.report.valid_until)
  );
}
export async function boundedJson(response: Response): Promise<unknown> {
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json"))
    throw Error("Not JSON");
  if (Number(response.headers.get("content-length")) > 16384 || !response.body)
    throw Error("Invalid body");
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 16384) throw Error("Status too large");
      chunks.push(value);
    }
    const all = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      all.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(all));
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
