export type BenchmarkPart = { owner: string; share: number; symbols: [string, number][] };
export type BenchmarkRun = {
  uid: string;
  revision: number;
  status: string;
  pending: boolean;
  superseded: boolean;
  median: number | null;
  iqr: number | null;
  repetitions: number | null;
  instructions: number | null;
  hasProfile: boolean;
  parts: BenchmarkPart[];
};
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const number = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
export function parseBenchmarks(value: unknown): BenchmarkRun[] {
  if (!Array.isArray(value) || value.length > 1000) throw new Error("Invalid benchmark history");
  const ids = new Set<string>();
  return value.map((v) => {
    if (
      !record(v) ||
      typeof v.uid !== "string" ||
      !/^[a-f\d-]{36}$/i.test(v.uid) ||
      ids.has(v.uid) ||
      !Number.isSafeInteger(v.revision) ||
      (v.revision as number) < 0
    )
      throw new Error("Invalid benchmark run");
    ids.add(v.uid);
    const parts: BenchmarkPart[] = [];
    for (const p of Array.isArray(v.parts_profile) ? v.parts_profile.slice(0, 32) : []) {
      if (
        !record(p) ||
        typeof p.owner !== "string" ||
        number(p.share) === null ||
        (p.share as number) > 1
      )
        continue;
      parts.push({
        owner: text(p.owner, 100),
        share: p.share as number,
        symbols: (Array.isArray(p.top_symbols) ? p.top_symbols : [])
          .slice(0, 10)
          .flatMap((s) =>
            Array.isArray(s) && typeof s[0] === "string" && number(s[1]) !== null
              ? [[text(s[0], 200), s[1]] as [string, number]]
              : []
          ),
      });
    }
    return {
      uid: v.uid,
      revision: v.revision as number,
      status: text(v.status, 40),
      pending: v.pending_remeasurement === true,
      superseded: v.superseded === true,
      median: number(v.median_ns),
      iqr: number(v.iqr_ns),
      repetitions: number(v.repetitions),
      instructions: number(v.instructions),
      hasProfile: v.has_profile === true,
      parts,
    };
  });
}
export function benchmarkStatus(run: BenchmarkRun): string {
  if (run.pending) return "Re-measuring — not a regression";
  if (run.superseded) return "Superseded measurement";
  return (
    (
      {
        ok: "Measured",
        waiting: "Waiting",
        queued: "Queued",
        running: "Measuring",
        noisy: "Noisy measurement",
        rejected_host: "Measurement host rejected",
        lost: "Measurement interrupted",
        failed_verify: "Incorrect result",
        cancelled: "Cancelled measurement",
      } as Record<string, string>
    )[run.status] ?? "Measurement unavailable"
  );
}
/** Pending/noisy points are deliberately excluded from the measured trend. */
export function benchmarkTrend(runs: BenchmarkRun[]) {
  return runs
    .filter((r) => r.status === "ok" && !r.pending && !r.superseded && r.median !== null)
    .slice()
    .sort((a, b) => a.revision - b.revision);
}
export async function readBoundedResponse(
  response: Response,
  maximum: number
): Promise<Uint8Array> {
  if (Number(response.headers.get("content-length")) > maximum) {
    await response.body?.cancel().catch(() => {});
    throw new Error("Response is too large");
  }
  if (!response.body) throw new Error("Empty response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) throw new Error("Response is too large");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
