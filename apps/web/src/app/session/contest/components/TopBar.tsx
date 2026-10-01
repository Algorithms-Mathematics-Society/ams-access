import { useEffect, useRef, type Dispatch, type SetStateAction, type ReactNode } from "react";
import { Bookmark, Headset } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { CountdownBadge } from "./CountdownBadge";
import { ContestOverlay } from "./ContestOverlay";
import type { ClockSnapshot } from "../session-clock";
import { type ContestMeta } from "./questions";

export interface FinishQuestionReview {
  id: string;
  title: string;
  submissionCount: number;
  pendingCount: number;
  hasAccepted: boolean;
}

export interface TopBarProps {
  contest: ContestMeta | null;
  clock: ClockSnapshot;
  handleContestExpiry: () => void | Promise<void>;
  setShowSupportModal: Dispatch<SetStateAction<boolean>>;
  submitConfirm: boolean;
  setSubmitConfirm: Dispatch<SetStateAction<boolean>>;
  submitError: string | null;
  setSubmitError: Dispatch<SetStateAction<string | null>>;
  handleSubmitConfirmed: () => void | Promise<void>;
  timeUpState: "idle" | "submitting" | "submitted" | "error";
  finishQuestions: FinishQuestionReview[];
  finishHistoryStatus?: "loading" | "available" | "unavailable" | "stale";
  finishDraftStatus: string;
  finishDraftNeedsAttention: boolean;
  finishReviewSuspended: boolean;
  onReviewQuestion: (index: number) => void;
  markedQuestionIds: string[];
  workspaceControls?: ReactNode;
}

export function TopBar({
  contest,
  clock,
  handleContestExpiry,
  setShowSupportModal,
  submitConfirm,
  setSubmitConfirm,
  submitError,
  setSubmitError,
  handleSubmitConfirmed,
  timeUpState,
  finishQuestions,
  finishHistoryStatus = "available",
  finishDraftStatus,
  finishDraftNeedsAttention,
  finishReviewSuspended,
  onReviewQuestion,
  markedQuestionIds,
  workspaceControls,
}: TopBarProps) {
  const reviewRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const active = submitConfirm && !finishReviewSuspended && timeUpState === "idle";
  const latest = useRef({ submitConfirm, finishReviewSuspended, timeUpState, setSubmitConfirm, setSubmitError });
  latest.current = { submitConfirm, finishReviewSuspended, timeUpState, setSubmitConfirm, setSubmitError };

  // This stays in the normal DOM so mandatory security overlays retain priority.
  // Do not restore focus when a higher-priority overlay takes over the screen.
  useEffect(() => {
    if (!active) return;
    const root = reviewRef.current;
    if (!root) return;
    (root.querySelector<HTMLElement>("[data-finish-cancel]") ?? root).focus({ preventScroll: true });
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        latest.current.setSubmitConfirm(false);
        latest.current.setSubmitError(null);
        return;
      }
      if (event.key !== "Tab") return;
      const items = Array.from(root.querySelectorAll<HTMLElement>('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'))
        .filter((item) => item.getClientRects().length > 0 && item.getAttribute("aria-disabled") !== "true");
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        event.preventDefault();
        root.focus({ preventScroll: true });
      } else if (!root.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    // The existing lockdown handler stops Escape propagation at window. Listen
    // on that same target: its preventDefault/security restrictions still run,
    // while Escape can dismiss only this ordinary review dialog.
    window.addEventListener("keydown", handleKey, true);
    return () => {
      window.removeEventListener("keydown", handleKey, true);
      if (!latest.current.submitConfirm && !latest.current.finishReviewSuspended && latest.current.timeUpState === "idle") {
        triggerRef.current?.focus({ preventScroll: true });
      }
    };
  }, [active]);

  const cancelReview = () => { setSubmitConfirm(false); setSubmitError(null); };
  const submittedQuestions = finishQuestions.filter((question) => question.submissionCount > 0).length;
  const pendingCount = finishQuestions.reduce((count, question) => count + question.pendingCount, 0);
  const historyKnown = finishHistoryStatus === "available" || finishHistoryStatus === "stale";
  return <HStack as="header" className="contest-topbar" gap={5} align="center" paddingInline={5} minHeight="calc(var(--spacing-8) * 2)"
    style={{ flexShrink: 0, borderBottom: "var(--border-width) solid var(--color-border)", background: "var(--color-background-body)" }}>
    <HStack gap={3} align="center" style={{ flex: 1, minWidth: 0 }}>
      <svg width="28" height="24" viewBox="0 0 172 164" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
        <path d="M2 162L87 2L172 162" stroke="var(--color-text-purple)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <Text type="label" maxLines={1}>{contest?.title ?? "Contest"}</Text>
    </HStack>
    <CountdownBadge clock={clock} onExpiry={handleContestExpiry} />
    <HStack gap={2} align="center" justify="end" className="contest-topbar-actions" style={{ flex: 1, minWidth: 0 }}>
      {workspaceControls}
      <Button label="Help" aria-label="Request support" variant="ghost" icon={<Headset size={16} />} onClick={() => setShowSupportModal(true)} />
      <Button ref={triggerRef} label="Finish contest" aria-label="Review and finish contest" variant="secondary"
        onClick={() => setSubmitConfirm(true)} isDisabled={timeUpState !== "idle"} />
      {active && <ContestOverlay labelId="finish-review-title" dialogRef={reviewRef} wide>
        <VStack gap={2}>
          <Heading id="finish-review-title" level={3} accessibilityLevel={2}>Review before finishing</Heading>
          <Text color="secondary">Use Submit in the editor for each solution you want judged. Finishing closes this workspace.</Text>
        </VStack>
        <VStack gap={2}>
          <Text type="label">{historyKnown
            ? `${submittedQuestions} of ${finishQuestions.length} questions have a submission`
            : finishHistoryStatus === "loading" ? "Checking submission history…" : "Submission history unavailable"}</Text>
          {finishHistoryStatus === "stale" && <Text type="supporting" color="secondary">Showing the last loaded history. Recent submissions or results may not appear yet.</Text>}
          {finishHistoryStatus === "unavailable" && <Text type="supporting" color="secondary">We could not load your submissions. A missing history does not mean nothing was submitted.</Text>}
          {historyKnown && pendingCount > 0 && <Text type="supporting" color="secondary">{pendingCount} {pendingCount === 1 ? "submission is" : "submissions are"} still awaiting a result.</Text>}
          <VStack as="ul" gap={0} aria-label="Question submission review"
            style={{ listStyle: "none", margin: 0, padding: 0, borderTop: "var(--border-width) solid var(--color-border)" }}>
            {finishQuestions.map((question, index) => <HStack as="li" key={question.id} gap={3} align="center" paddingBlock={3}
              style={{ borderBottom: "var(--border-width) solid var(--color-border)", minWidth: 0 }}>
              <VStack gap={1} style={{ flex: 1, minWidth: 0 }}>
                <Text type="label" style={{ overflowWrap: "anywhere" }}>{index + 1}. {question.title}</Text>
                {markedQuestionIds.includes(question.id) && <HStack gap={1.5} align="center">
                  <Bookmark size={12} fill="currentColor" aria-hidden="true" />
                  <Text type="supporting">Marked for later · Your reminder</Text>
                </HStack>}
                <Text type="supporting" color="secondary">
                  {!historyKnown ? "Submission status not confirmed" : question.submissionCount === 0 ? "No submitted attempt" : `${question.submissionCount} submitted ${question.submissionCount === 1 ? "attempt" : "attempts"}`}
                  {historyKnown && question.hasAccepted ? " · Accepted attempt recorded" : ""}
                  {historyKnown && question.pendingCount > 0 ? ` · ${question.pendingCount} awaiting result` : ""}
                </Text>
              </VStack>
              <Button label="Review" aria-label={`Review question ${index + 1}: ${question.title}`} variant="ghost" size="sm"
                onClick={() => { cancelReview(); onReviewQuestion(index); }} />
            </HStack>)}
          </VStack>
        </VStack>
        <VStack gap={2}>
          <Text type="label">Current draft</Text>
          <Text style={{ color: finishDraftNeedsAttention ? "var(--color-text-red)" : "var(--color-text-secondary)" }}>{finishDraftStatus}</Text>
          <Text type="supporting" color="secondary">Saving a draft does not submit it for judging. Submission history refers to earlier attempts, not necessarily your current code.</Text>
        </VStack>
        {submitError && <Text role="alert" style={{ color: "var(--color-text-red)" }}>{submitError}</Text>}
        <HStack gap={2} justify="end" wrap="wrap">
          <Button data-finish-cancel label="Back to contest" variant="secondary" onClick={cancelReview} />
          <Button label="Finish and exit" variant="destructive" onClick={handleSubmitConfirmed} />
        </HStack>
      </ContestOverlay>}
    </HStack>
  </HStack>;
}
