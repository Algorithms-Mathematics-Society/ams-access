import { memo, type Dispatch, type SetStateAction } from "react";
import { Bookmark, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { type Question } from "./questions";

const QUESTION_PREFIX = /^[A-Z][.):]\s*/;

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

export const QuestionRail = memo(function QuestionRail({
  questions,
  activeQ,
  switchQuestion,
  sidebarCollapsed,
  setSidebarCollapsed,
  questionStatusMap,
  acceptedQuestionCount,
  markedQuestionIds,
}: QuestionRailProps) {
  const markedCount = questions.filter((question) =>
    markedQuestionIds.includes(question.id)
  ).length;
  return (
    <VStack
      as="aside"
      className="contest-question-rail"
      aria-label="Contest questions"
      width={sidebarCollapsed ? "calc(var(--spacing-10) + var(--spacing-4))" : 220}
      style={{
        flexShrink: 0,
        minHeight: 0,
        minWidth: 0,
        overflow: "hidden",
        borderRight: "var(--border-width) solid var(--color-border)",
        background: "var(--color-background-body)",
      }}
    >
      <HStack
        padding={sidebarCollapsed ? 2 : 4}
        gap={2}
        align="center"
        justify={sidebarCollapsed ? "center" : "between"}
        style={{ flexShrink: 0, borderBottom: "var(--border-width) solid var(--color-border)" }}
      >
        {!sidebarCollapsed && (
          <VStack gap={2} style={{ flex: 1, minWidth: 0 }}>
            <Text type="label">Questions</Text>
            <Text type="supporting" hasTabularNumbers>
              {acceptedQuestionCount} of {questions.length} accepted
            </Text>
            {markedCount > 0 && (
              <Text type="supporting" color="secondary" hasTabularNumbers aria-live="polite">
                {markedCount} for later
              </Text>
            )}
          </VStack>
        )}
        <IconButton
          label={sidebarCollapsed ? "Expand questions list" : "Collapse questions list"}
          tooltip={sidebarCollapsed ? "Expand questions list" : "Collapse questions list"}
          variant="ghost"
          size="sm"
          icon={sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
      </HStack>
      <VStack
        as="nav"
        aria-label="Choose a question"
        gap={1}
        padding={2}
        isScrollable
        style={{
          flex: 1,
          minHeight: 0,
          paddingBottom: sidebarCollapsed
            ? "var(--spacing-2)"
            : "calc(var(--spacing-10) * 4 + var(--spacing-2) + var(--spacing-0-5))",
        }}
      >
        {questions.length === 0 && !sidebarCollapsed && <Text type="supporting">No questions</Text>}
        {questions.map((q, i) => {
          const qStatus = questionStatusMap[q.id];
          const letter = String.fromCharCode(65 + i);
          const displayTitle = q.title.startsWith(letter)
            ? q.title.replace(QUESTION_PREFIX, "")
            : q.title;
          const accepted = qStatus.shortLabel === "AC";
          const rejected = qStatus.shortLabel === "Review";
          const statusColor = accepted
            ? "var(--verdict-ac)"
            : rejected
              ? "var(--verdict-wa)"
              : "var(--color-text-secondary)";
          const marked = markedQuestionIds.includes(q.id);
          const accessibleLabel = `${q.title} · ${qStatus.label}${marked ? " · Marked for later" : ""}`;
          return (
            <Button
              key={q.id}
              className="contest-question-button"
              label={accessibleLabel}
              tooltip={accessibleLabel}
              aria-current={activeQ === i ? "page" : undefined}
              variant={activeQ === i ? "secondary" : "ghost"}
              onClick={() => switchQuestion(i)}
              width={sidebarCollapsed ? "var(--spacing-10)" : "100%"}
              style={{
                position: "relative",
                background:
                  activeQ === i
                    ? "var(--color-background-question-active)"
                    : accepted
                      ? "var(--color-background-question-accepted)"
                      : rejected
                        ? "var(--color-background-question-review)"
                        : undefined,
                height: sidebarCollapsed ? "var(--spacing-10)" : "auto",
                minHeight: "var(--spacing-10)",
                textAlign: sidebarCollapsed ? "center" : "left",
                alignItems: "center",
                flexShrink: 0,
                padding: sidebarCollapsed ? 0 : "var(--spacing-2)",
                justifyContent: sidebarCollapsed ? "center" : "start",
              }}
            >
              {marked && (
                <Bookmark
                  size={10}
                  fill="currentColor"
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    top: "var(--spacing-1)",
                    right: "var(--spacing-1)",
                    color: "var(--color-text-primary)",
                  }}
                />
              )}
              {sidebarCollapsed ? (
                <HStack
                  gap={0}
                  align="center"
                  justify="center"
                  style={{
                    position: "relative",
                    width: "var(--spacing-10)",
                    height: "var(--spacing-10)",
                    flexShrink: 0,
                  }}
                >
                  <Text
                    type="label"
                    style={{ color: accepted || rejected ? statusColor : undefined, lineHeight: 1 }}
                  >
                    {letter}
                  </Text>
                </HStack>
              ) : (
                <HStack
                  gap={3}
                  align="center"
                  width="100%"
                  style={{ paddingRight: marked ? "var(--spacing-2)" : undefined }}
                >
                  <HStack
                    align="center"
                    justify="center"
                    style={{
                      flexShrink: 0,
                      width: "var(--spacing-8)",
                      height: "var(--spacing-8)",
                      borderRadius: "var(--radius-element)",
                      color: statusColor,
                      background: "var(--color-background-body)",
                    }}
                  >
                    <Text type="label" style={{ color: "inherit" }}>
                      {letter}
                    </Text>
                  </HStack>
                  <VStack gap={0.5} style={{ flex: 1, minWidth: 0 }}>
                    <Text type="label" maxLines={1} hasTruncateTooltip={false}>
                      {displayTitle}
                    </Text>
                  </VStack>
                </HStack>
              )}
            </Button>
          );
        })}
      </VStack>
    </VStack>
  );
});
