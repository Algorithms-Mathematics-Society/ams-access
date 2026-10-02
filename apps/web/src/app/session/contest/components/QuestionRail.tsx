import { memo, type Dispatch, type SetStateAction } from "react";
import { Bookmark, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { type Question } from "./questions";

const QUESTION_PREFIX = /^[A-Z][.)]\s+/;

export interface QuestionStatus {
  label: string;
  shortLabel: string;
  color: string;
  bg: string;
  border: string;
}

export interface QuestionRailProps {
  questions: Question[];
  activeQ: number;
  switchQuestion: (idx: number) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
  questionStatusMap: Record<string, QuestionStatus>;
  acceptedQuestionCount: number;
  markedQuestionIds: string[];
}

export const QuestionRail = memo(function QuestionRail({ questions, activeQ, switchQuestion, sidebarCollapsed,
  setSidebarCollapsed, questionStatusMap, acceptedQuestionCount, markedQuestionIds }: QuestionRailProps) {
  const markedCount = questions.filter((question) => markedQuestionIds.includes(question.id)).length;
  return (
    <VStack as="aside" className="contest-question-rail" aria-label="Contest questions"
      width={sidebarCollapsed ? 52 : 220}
      style={{ flexShrink: 0, minHeight: 0, minWidth: 0, overflow: "hidden",
        borderRight: "var(--border-width) solid var(--color-border)", background: "var(--color-background-body)" }}>
      <HStack padding={sidebarCollapsed ? 2 : 4} gap={2} align="center" justify={sidebarCollapsed ? "center" : "between"}
        style={{ flexShrink: 0, borderBottom: "var(--border-width) solid var(--color-border)" }}>
        {!sidebarCollapsed && <VStack gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Text type="label">Questions</Text>
          <Text type="supporting" hasTabularNumbers>{acceptedQuestionCount} of {questions.length} accepted</Text>
          <ProgressBar label="Accepted questions" isLabelHidden value={acceptedQuestionCount}
            max={Math.max(1, questions.length)} variant="accent"
            formatValueLabel={() => `${acceptedQuestionCount} of ${questions.length} accepted`} />
          <Text type="supporting" hasTabularNumbers aria-live="polite">{markedCount} marked for later</Text>
        </VStack>}
        <IconButton label={sidebarCollapsed ? "Expand questions list" : "Collapse questions list"}
          tooltip={sidebarCollapsed ? "Expand questions list" : "Collapse questions list"} variant="ghost" size="sm"
          icon={sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)} />
      </HStack>
      <VStack as="nav" aria-label="Choose a question" gap={1} padding={2} isScrollable
        style={{ flex: 1, minHeight: 0, paddingBottom: sidebarCollapsed ? "var(--spacing-2)" : "calc(var(--spacing-10) * 4 + var(--spacing-2) + var(--spacing-0-5))" }}>
        {questions.length === 0 && !sidebarCollapsed && <Text type="supporting">No questions</Text>}
        {questions.map((q, i) => {
          const qStatus = questionStatusMap[q.id];
          const letter = String.fromCharCode(65 + i);
          const displayTitle = q.title.startsWith(letter) ? q.title.replace(QUESTION_PREFIX, "") : q.title;
          const marked = markedQuestionIds.includes(q.id);
          const accessibleLabel = `${q.title} · ${qStatus.label}${marked ? " · Marked for later" : ""}`;
          return <Button key={q.id} label={accessibleLabel} tooltip={accessibleLabel}
            aria-current={activeQ === i ? "page" : undefined} variant={activeQ === i ? "secondary" : "ghost"}
            onClick={() => switchQuestion(i)} width="100%"
            style={{ height: "auto", minHeight: "var(--spacing-10)", textAlign: "left", padding: "var(--spacing-2)", justifyContent: sidebarCollapsed ? "center" : "start" }}>
            {sidebarCollapsed ? <VStack gap={0.5} align="center">
              <Text type="label">{letter}</Text>
              {marked && <Bookmark size={12} fill="currentColor" aria-hidden="true" />}
            </VStack> : <HStack gap={3} align="center" width="100%">
              <Text type="code" color="secondary">{letter}</Text>
              <VStack gap={0.5} style={{ flex: 1, minWidth: 0 }}>
                <Text type="label" maxLines={1} hasTruncateTooltip={false}>{displayTitle}</Text>
                <Text type="supporting">{qStatus.label}</Text>
              </VStack>
              <VStack gap={2} align="center" style={{ flexShrink: 0 }}>
                {marked && <Bookmark size={12} fill="currentColor" aria-hidden="true" />}
                <StatusDot label={qStatus.label} variant={qStatus.shortLabel === "AC" ? "success" : qStatus.label === "Needs review" || qStatus.label === "Unsaved" ? "warning" : "neutral"} />
              </VStack>
            </HStack>}
          </Button>;
        })}
      </VStack>
    </VStack>
  );
});
