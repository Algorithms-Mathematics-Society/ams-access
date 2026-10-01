"use client";

/** Own submissions only, using the same endpoint/verdicts as the contest room.
 * This is not a leaderboard or an organizer's published final score. */
import { useCallback, useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@astryxdesign/core/AppShell";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Section } from "@astryxdesign/core/Section";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { STORAGE_KEYS } from "@/constants/storage-keys";
import { getContest, listMySubmissions, ProctorApiError } from "@/lib/proctor-api";
import { toAttemptRecords, type AttemptRecord } from "@/app/session/contest/attempt-adapter";
import { partialCreditZeroed } from "@/app/session/contest/family-summary";
import { verdictColor, verdictLabel, isTerminalVerdict } from "@/lib/verdict";
import { ResultsLoading } from "./components/ResultsLoading";

type ProblemRow = { label: string; title: string; attempts: AttemptRecord[] };

function resolveSessionId(contestId: string): string | null {
  for (const key of [STORAGE_KEYS.LAST_SESSION, STORAGE_KEYS.ACTIVE_SESSION]) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { id?: string; contest_id?: string };
      if (parsed?.id && parsed.contest_id === contestId) return parsed.id;
    } catch { /* Try the next entry if local storage is corrupt or unavailable. */ }
  }
  return null;
}

function attemptState(attempt: AttemptRecord): string {
  if (attempt.status === "FAILED" || attempt.final_verdict === "SE" || attempt.final_verdict === "IE") return "Judging failed";
  if (isTerminalVerdict(attempt.final_verdict)) return "Complete";
  if (attempt.status === "QUEUED" || attempt.status === "RUNNING") return "Judging";
  // Unknown or completed-without-verdict records must not imply a final result.
  return "Awaiting verdict";
}

function ResultsView({ contestId }: { contestId: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<ProblemRow[] | null>(null);
  const [contestTitle, setContestTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const requestVersion = useRef(0);
  const inFlight = useRef(false);

  const fetchResults = useCallback(async () => {
    if (inFlight.current) return;
    const version = ++requestVersion.current;
    setError(null);
    const sessionId = resolveSessionId(contestId);
    if (!contestId || !sessionId) {
      setError("This device has no saved session for this contest. Return home and open your most recent contest, or ask an invigilator for help with an older session.");
      return;
    }
    inFlight.current = true;
    setLoading(true);
    try {
      const [index, submissions] = await Promise.all([getContest(contestId), listMySubmissions(sessionId)]);
      if (version !== requestVersion.current) return;
      const attempts = toAttemptRecords(submissions);
      setContestTitle(index.title);
      setRows(index.problems.map(problem => ({
        label: problem.label, title: problem.title,
        attempts: attempts.filter(attempt => attempt.problem_id === problem.label),
      })));
      setUpdatedAt(new Date());
    } catch (caught) {
      if (version !== requestVersion.current) return;
      if (caught instanceof ProctorApiError && caught.status === 401) {
        router.push("/login");
        return;
      }
      setError("Could not update your submissions. Check your connection and try again. Any results below are from the last successful update.");
    } finally {
      if (version === requestVersion.current) {
        inFlight.current = false;
        setLoading(false);
      }
    }
  }, [contestId, router]);

  useEffect(() => {
    void fetchResults();
    return () => { requestVersion.current += 1; inFlight.current = false; };
  }, [fetchResults]);

  if (!rows && !error) return <ResultsLoading />;
  const latestAttempts = rows?.flatMap(row => row.attempts.slice(0, 1)) ?? [];
  const judging = latestAttempts.filter(attempt => ["Judging", "Awaiting verdict"].includes(attemptState(attempt))).length;
  const complete = latestAttempts.filter(attempt => attemptState(attempt) === "Complete").length;
  const failed = latestAttempts.filter(attempt => attemptState(attempt) === "Judging failed").length;

  return (
    <AppShell height="auto" variant="surface" contentPadding={0}>
      <VStack gap={6} padding={6} style={{ width: "100%", maxWidth: "calc(var(--spacing-10) * 24)", marginInline: "auto", minWidth: 0 }}>
        <HStack as="header" justify="between" align="start" gap={4} wrap="wrap">
          <VStack gap={2} style={{ minWidth: 0, flex: "1 1 calc(var(--spacing-10) * 8)" }}>
            <Text type="supporting">Your submissions</Text>
            <Heading level={1} wordBreak="break-word">{contestTitle || "Contest submissions"}</Heading>
            <Text color="secondary">Your recorded attempts and judging status. These are not published standings or a final contest score.</Text>
          </VStack>
          <Button label="Back to Home" variant="secondary" onClick={() => router.push("/home")} />
        </HStack>
        {error && <Banner status="error" title="Submissions could not be updated" description={error} />}
        <HStack justify="between" align="center" wrap="wrap" gap={3}>
          <Text type="supporting" role="status">{loading ? "Updating submissions…" : updatedAt ? `Last updated ${updatedAt.toLocaleTimeString()}` : "No submissions loaded yet"}</Text>
          <Button label={loading ? "Refreshing…" : "Refresh submissions"} variant="secondary" isLoading={loading} isDisabled={loading} onClick={() => void fetchResults()} />
        </HStack>
        {rows && <>
          <Section variant="muted" padding={4}>
            <VStack gap={3}>
              <Heading level={3} accessibilityLevel={2}>Latest attempt per problem</Heading>
              <HStack gap={3} wrap="wrap" aria-label="Submission summary">
                <Token label={`${complete} complete`} color="gray" />
                {judging > 0 && <Token label={`${judging} judging / awaiting verdict`} color="yellow" />}
                {failed > 0 && <Token label={`${failed} judging failed`} color="red" />}
                <Token label={`${rows.length - latestAttempts.length} not submitted`} color="gray" />
              </HStack>
              {judging > 0 && <Text type="supporting">Some verdicts are still pending. Refresh to check for an update.</Text>}
              {failed > 0 && <Text type="supporting">A judging attempt failed. Ask an invigilator if it remains unresolved.</Text>}
              {latestAttempts.length === 0 && <Text color="secondary">No submissions were recorded for this session.</Text>}
            </VStack>
          </Section>
          <VStack gap={0} aria-label="Results by problem">
            {rows.map(row => <ProblemResult key={row.label} row={row} />)}
          </VStack>
        </>}
      </VStack>
    </AppShell>
  );
}

function AttemptSummary({ attempt }: { attempt: AttemptRecord }) {
  const state = attemptState(attempt);
  const verdict = attempt.final_verdict;
  return <VStack gap={2}>
    <HStack gap={3} align="center" wrap="wrap">
      <Text weight="medium" style={{ color: verdict ? verdictColor(verdict) : undefined }}>{verdict ? verdictLabel(verdict) : state}</Text>
      {verdict && <Text type="supporting">{state}</Text>}
      <Text type="supporting">Attempt {attempt.attempt_no} · {new Date(attempt.created_at).toLocaleString()}</Text>
    </HStack>
    {attempt.testcases.length > 0 && <Text type="supporting">{attempt.testcases.filter(test => test.verdict === "AC").length}/{attempt.testcases.length} recorded test cases passed</Text>}
    {partialCreditZeroed(attempt.testcases) && <Text style={{ color: "var(--theme-error-text)" }}>A restriction was broken, so this attempt scored zero regardless of the tests.</Text>}
  </VStack>;
}

function ProblemResult({ row }: { row: ProblemRow }) {
  const [latest, ...earlier] = row.attempts;
  return <Section variant="transparent" padding={0} paddingBlock={5} dividers={["bottom"]}>
    <VStack gap={4}>
      <HStack gap={3} justify="between" align="start" wrap="wrap">
        <Heading level={3} accessibilityLevel={2} wordBreak="break-word">{row.label}. {row.title}</Heading>
        <Text type="supporting">{row.attempts.length} {row.attempts.length === 1 ? "attempt" : "attempts"}</Text>
      </HStack>
      {latest ? <AttemptSummary attempt={latest} /> : <Text color="secondary">Not submitted</Text>}
      {earlier.length > 0 && <Collapsible defaultIsOpen={false} trigger={`Earlier attempts (${earlier.length})`}>
        <VStack as="ol" gap={4} paddingBlock={3} style={{ listStyle: "none", margin: 0, paddingInline: 0 }}>
          {earlier.map(attempt => <VStack as="li" key={attempt.id}><AttemptSummary attempt={attempt} /></VStack>)}
        </VStack>
      </Collapsible>}
    </VStack>
  </Section>;
}

function ResultsRoute() {
  const searchParams = useSearchParams();
  const contestId = searchParams?.get("contestId") ?? "";
  // Switching contests must discard the previous contest's data and inflight UI.
  return <ResultsView key={contestId} contestId={contestId} />;
}
export default function ResultsPage() {
  return <Suspense fallback={<ResultsLoading />}><ResultsRoute /></Suspense>;
}
