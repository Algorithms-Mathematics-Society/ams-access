"use client";
import { useEffect, useRef, useState } from "react";
import { VStack, HStack } from "@astryxdesign/core/Stack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { List, ListItem } from "@astryxdesign/core/List";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { authHeaders, participantToken } from "@/lib/candidate-auth";
import { authGeneration, subscribeAuthChanges } from "@/lib/proctor-api";
import { resolveApiBase } from "@/lib/api-base";
import {
  parseBenchmarks,
  benchmarkStatus,
  benchmarkTrend,
  readBoundedResponse,
  BENCHMARK_HISTORY_LIMIT,
  type BenchmarkRun,
} from "@/lib/team-benchmarks";
const ns = (n: number | null) => (n === null ? "unavailable" : `${n.toLocaleString()} ns`);
// WKWebView sends <a download href="blob:"> through the navigation guard,
// which refuses it, so on macOS the folded stacks are shown in the app instead.
const STACKS_PREVIEW_BYTES = 256 * 1024;
// navigator.platform, not the user agent: the desktop app sets its own user agent.
const inAppStacks = () => typeof navigator !== "undefined" && /^Mac/.test(navigator.platform);
/** Only own-team endpoints; history loads on open/manual refresh, artifacts on demand. */
export function TeamBenchmarks({
  contestUid,
  visible,
  apiBase = resolveApiBase(),
}: {
  contestUid: string;
  visible: boolean;
  apiBase?: string;
}) {
  const [runs, setRuns] = useState<BenchmarkRun[]>([]),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [profile, setProfile] = useState<{ url: string; revision: number } | null>(null),
    [stacks, setStacks] = useState<{ text: string; revision: number; truncated: boolean } | null>(
      null
    ),
    [truncated, setTruncated] = useState(false);
  const flight = useRef<AbortController | null>(null),
    objectUrl = useRef<string | null>(null),
    epoch = useRef(0),
    downloads = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const clearDownloads = () => {
    for (const [url, timer] of downloads.current) {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
    }
    downloads.current.clear();
  };
  const clearProfile = () => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
    setProfile(null);
  };
  async function request(run?: BenchmarkRun, artifact?: "flamegraph" | "stacks") {
    if (!visible || flight.current || !participantToken()) return;
    const generation = authGeneration(),
      token = participantToken(),
      currentEpoch = epoch.current;
    const controller = new AbortController();
    flight.current = controller;
    setBusy(true);
    setError(null);
    const timer = setTimeout(() => controller.abort(), 10000);
    const current = () =>
      !controller.signal.aborted &&
      epoch.current === currentEpoch &&
      generation === authGeneration() &&
      token === participantToken();
    try {
      const suffix = run && artifact ? `/${encodeURIComponent(run.uid)}/${artifact}` : "";
      const response = await fetch(
        `${apiBase.replace(/\/$/, "")}/participant/contests/${encodeURIComponent(contestUid)}/team/benchmarks${suffix}`,
        { headers: authHeaders(), signal: controller.signal, cache: "no-store" }
      );
      if (!response.ok)
        throw new Error(
          response.status === 401 || response.status === 403
            ? "Your sign-in cannot access these team measurements."
            : "Benchmark data is unavailable. Try again."
        );
      const bytes = await readBoundedResponse(
        response,
        artifact ? 32 * 1024 * 1024 : 8 * 1024 * 1024
      );
      if (!current()) return;
      if (!artifact) {
        const history: unknown = JSON.parse(new TextDecoder().decode(bytes));
        setRuns(parseBenchmarks(history));
        setTruncated(Array.isArray(history) && history.length > BENCHMARK_HISTORY_LIMIT);
        setLoaded(true);
      } else {
        const expected = artifact === "flamegraph" ? "image/svg+xml" : "text/plain";
        if (!response.headers.get("content-type")?.toLowerCase().startsWith(expected))
          throw new Error("The profile has an unexpected format.");
        if (artifact === "stacks" && inAppStacks()) {
          const truncated = bytes.length > STACKS_PREVIEW_BYTES;
          let text = new TextDecoder().decode(bytes.subarray(0, STACKS_PREVIEW_BYTES));
          if (truncated) text = text.slice(0, Math.max(0, text.lastIndexOf("\n")));
          setStacks({ text, revision: run!.revision, truncated });
          return;
        }
        const blob = new Blob([bytes.buffer as ArrayBuffer], { type: expected });
        const url = URL.createObjectURL(blob);
        if (artifact === "flamegraph") {
          clearProfile();
          objectUrl.current = url;
          setProfile({ url, revision: run!.revision });
        } else {
          const link = document.createElement("a");
          link.href = url;
          link.download = `team-revision-${run!.revision}.folded.txt`;
          document.body.appendChild(link);
          link.click();
          link.remove();
          downloads.current.set(
            url,
            setTimeout(() => {
              URL.revokeObjectURL(url);
              downloads.current.delete(url);
            }, 30000)
          );
        }
      }
    } catch (e) {
      if (
        epoch.current === currentEpoch &&
        generation === authGeneration() &&
        token === participantToken()
      )
        setError(
          controller.signal.aborted
            ? "The request timed out. Try again."
            : e instanceof Error && /sign-in|unavailable|format/.test(e.message)
              ? e.message
              : "Benchmark data could not be read. Try again."
        );
    } finally {
      clearTimeout(timer);
      controller.abort();
      if (flight.current === controller) {
        flight.current = null;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    epoch.current++;
    setRuns([]);
    setLoaded(false);
    setError(null);
    clearProfile();
    setStacks(null);
    setTruncated(false);
    if (visible) void request();
    const stop = () => {
      epoch.current++;
      flight.current?.abort();
      flight.current = null;
      setBusy(false);
      setRuns([]);
      setLoaded(false);
      setTruncated(false);
      clearProfile();
      setStacks(null);
      clearDownloads();
    };
    const unsubscribe = subscribeAuthChanges(() => {
      stop();
      // A new sign-in reloads once; request() does nothing when signed out.
      if (visible) void request();
    });
    return () => {
      unsubscribe();
      epoch.current++;
      flight.current?.abort();
      flight.current = null;
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
      clearDownloads();
    };
    // The effect owns the contest/visibility lifecycle; actions read the current identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contestUid, visible, apiBase]);
  if (!visible) return null;
  const trend = benchmarkTrend(runs).slice(-30),
    max = Math.max(1, ...trend.map((r) => r.median!));
  return (
    <VStack gap={3}>
      <HStack gap={2} align="center" wrap="wrap">
        <Heading level={3}>Benchmark history</Heading>
        <Button
          label={busy ? "Loading…" : "Refresh benchmarks"}
          isDisabled={busy}
          onClick={() => void request()}
        />
      </HStack>
      <Text>
        Measurements are for your team only. Lower median is faster; compare the IQR and repetition
        count before treating a difference as an improvement.
      </Text>
      {error && <Text role="alert">{error}</Text>}
      {truncated && (
        <Text>Showing the newest {BENCHMARK_HISTORY_LIMIT.toLocaleString()} measurements.</Text>
      )}
      {loaded && !runs.length && (
        <Text>
          No benchmark measurements yet. They appear when benchmarking is enabled and your team has
          an eligible integration result.
        </Text>
      )}
      {!!trend.length && (
        <svg
          viewBox="0 0 600 160"
          role="img"
          aria-label="Measured median runtime by revision; lower is faster. Exact values and IQR follow in the history."
          style={{ width: "100%", height: "auto", color: "var(--color-text-primary)" }}
        >
          <title>Median runtime by revision</title>
          <polyline
            fill="none"
            stroke="currentColor"
            points={trend
              .map(
                (r, i) =>
                  `${30 + (i * 540) / Math.max(1, trend.length - 1)},${125 - (r.median! / max) * 100}`
              )
              .join(" ")}
          />
          {trend.map((r, i) => (
            <g key={r.uid}>
              <circle
                cx={30 + (i * 540) / Math.max(1, trend.length - 1)}
                cy={125 - (r.median! / max) * 100}
                r="3"
                fill="currentColor"
              />
              <text
                x={30 + (i * 540) / Math.max(1, trend.length - 1)}
                y="150"
                fill="currentColor"
                textAnchor="middle"
              >
                {r.revision}
              </text>
            </g>
          ))}
        </svg>
      )}
      {!!trend.length && (
        <Text>
          Horizontal axis: revision. Vertical axis: median runtime (ns), from 0 to{" "}
          {max.toLocaleString()}. Pending and superseded measurements are excluded.
        </Text>
      )}
      <List>
        {runs.map((run) => (
          <ListItem
            key={run.uid}
            label={`Revision ${run.revision} · ${benchmarkStatus(run)}`}
            description={
              <VStack gap={2}>
                <Text>
                  {run.pending ? "Provisional median" : "Median"}: {ns(run.median)} · IQR:{" "}
                  {ns(run.iqr)} · Repetitions: {run.repetitions ?? "unavailable"} · Instructions:{" "}
                  {run.instructions?.toLocaleString() ?? "unavailable"}
                </Text>
                {!!run.parts.length && (
                  <>
                    <HStack
                      gap={0}
                      aria-label={`Runtime shares for revision ${run.revision}`}
                      style={{ width: "100%" }}
                    >
                      {run.parts.map((part, i) => (
                        <Text
                          key={`${part.owner}-${i}`}
                          aria-label={`${part.owner}: ${(part.share * 100).toFixed(1)}%`}
                          style={{
                            width: `${part.share * 100}%`,
                            minWidth: 0,
                            overflow: "hidden",
                            backgroundColor:
                              i % 2 ? "var(--color-bg-secondary)" : "var(--color-bg-tertiary)",
                            borderInlineEnd:
                              "var(--border-width-1) solid var(--color-border-primary)",
                          }}
                        >
                          ▰
                        </Text>
                      ))}
                    </HStack>
                    {run.parts.map((part, i) => (
                      <Text key={`${part.owner}-${i}`} style={{ overflowWrap: "anywhere" }}>
                        Part {part.owner}: {(part.share * 100).toFixed(1)}% · Hottest symbols:{" "}
                        {part.symbols.length
                          ? part.symbols
                              .map(([name, count]) => `${name} (${count} samples)`)
                              .join(", ")
                          : "unavailable"}
                      </Text>
                    ))}
                  </>
                )}
                {run.hasProfile && (
                  <HStack gap={2} wrap="wrap">
                    <Button
                      label={`View flamegraph for revision ${run.revision}`}
                      isDisabled={busy}
                      onClick={() => void request(run, "flamegraph")}
                    />
                    <Button
                      label={`${inAppStacks() ? "View" : "Download"} folded stacks for revision ${run.revision}`}
                      isDisabled={busy}
                      onClick={() => void request(run, "stacks")}
                    />
                  </HStack>
                )}
              </VStack>
            }
          />
        ))}
      </List>
      {profile && (
        <VStack gap={2}>
          <Heading level={4}>Flamegraph · revision {profile.revision}</Heading>
          <Button label="Close flamegraph" onClick={clearProfile} />
          <img
            src={profile.url}
            alt={`Runtime flamegraph for your team's revision ${profile.revision}`}
            style={{ maxWidth: "100%", height: "auto" }}
            onError={() => {
              clearProfile();
              setError("The flamegraph could not be displayed.");
            }}
          />
        </VStack>
      )}
      {stacks && (
        <VStack gap={2}>
          <Heading level={4}>Folded stacks · revision {stacks.revision}</Heading>
          <Button label="Close folded stacks" onClick={() => setStacks(null)} />
          {stacks.truncated && (
            <Text>Showing the first {STACKS_PREVIEW_BYTES / 1024} KB of the folded stacks.</Text>
          )}
          <CodeBlock
            code={stacks.text}
            title={`team-revision-${stacks.revision}.folded.txt`}
            hasCopyButton={false}
            maxHeight="60vh"
            width="100%"
            size="sm"
          />
        </VStack>
      )}
    </VStack>
  );
}
