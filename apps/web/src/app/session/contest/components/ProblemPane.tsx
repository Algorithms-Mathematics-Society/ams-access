import { type Dispatch, type SetStateAction, type MouseEvent as ReactMouseEvent } from "react";
import { HStack, VStack, StackItem } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TabList, Tab } from "@astryxdesign/core/TabList";
import { IconButton } from "@astryxdesign/core/IconButton";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { Bookmark } from "lucide-react";
import { type ProblemSectionKey } from "./markdown";
import { type Question } from "./questions";
import { MarkingScheme } from "./MarkingScheme";

export interface ProblemPaneProps {
  problemPaneWidth: number;
  availableProblemTabs: ProblemSectionKey[];
  activeProblemTab: ProblemSectionKey;
  setProblemTab: Dispatch<SetStateAction<ProblemSectionKey>>;
  questions: Question[];
  activeQ: number;
  problemBodyHtml: string;
  handleProblemBodyClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
  markedQuestionIds: string[];
  toggleQuestionMark: (id: string) => void;
}

export function ProblemPane({ problemPaneWidth, availableProblemTabs, activeProblemTab, setProblemTab,
  questions, activeQ, problemBodyHtml, handleProblemBodyClick, markedQuestionIds, toggleQuestionMark }: ProblemPaneProps) {
  const question = questions[activeQ];
  const marked = question ? markedQuestionIds.includes(question.id) : false;
  const hasPoints = typeof question?.points === "number" && Number.isFinite(question.points) && question.points >= 0;
  const hasTimeLimit = typeof question?.time_limit_ms === "number" && Number.isFinite(question.time_limit_ms) && question.time_limit_ms > 0;
  const hasMemoryLimit = typeof question?.memory_limit_mb === "number" && Number.isFinite(question.memory_limit_mb) && question.memory_limit_mb > 0;
  return <VStack className="contest-problem-pane" width={`${problemPaneWidth}%`}
    style={{ minWidth: "calc(var(--spacing-10) * 6 + var(--spacing-5))", flexShrink: 0, minHeight: 0,
      borderRight: "var(--border-width) solid var(--color-border)", background: "var(--color-background-body)" }}>
    <HStack paddingInline={5} gap={3} align="center" justify="between" minHeight="var(--spacing-12)"
      style={{ flexShrink: 0, borderBottom: "var(--border-width) solid var(--color-border)" }}>
      <Text type="label">Problem {String.fromCharCode(65 + (question?.order_index ?? activeQ))}</Text>
      <Text type="supporting" color="secondary" hasTabularNumbers>{activeQ + 1} of {questions.length}</Text>
    </HStack>
    <StackItem size="fill" isScrollable>
      <VStack as="article" gap={6} padding={5} className="contest-problem-article"
        style={{ overflowWrap: "anywhere", paddingBottom: "var(--spacing-8)" }}>
        <VStack gap={4}>
          <HStack gap={3} justify="between" align="start">
            <Heading level={2} accessibilityLevel={1} style={{ flex: 1, minWidth: 0 }}>{question?.title}</Heading>
            {question && <IconButton label={marked ? "Marked for later" : "Mark for later"} aria-pressed={marked}
              tooltip={marked ? "Marked for later — remove reminder" : "Mark for later"}
              variant={marked ? "secondary" : "ghost"} size="sm"
              icon={<Bookmark size={16} fill={marked ? "currentColor" : "none"} aria-hidden="true" />}
              onClick={() => toggleQuestionMark(question.id)} style={{ flexShrink: 0 }} />}
          </HStack>
          {(hasPoints || hasTimeLimit || hasMemoryLimit) && <MetadataList columns={3} label={{ position: "top" }} className="contest-problem-limits"
            style={{ padding: "var(--spacing-4)", background: "var(--color-background-surface)", borderRadius: "var(--radius-element)" }}>
            {hasPoints && <MetadataListItem label="Points"><Text weight="medium" hasTabularNumbers>{question.points}</Text></MetadataListItem>}
            {hasTimeLimit && <MetadataListItem label="Time limit"><Text weight="medium" hasTabularNumbers>{question.time_limit_ms! / 1000} s</Text></MetadataListItem>}
            {hasMemoryLimit && <MetadataListItem label="Memory limit"><Text weight="medium" hasTabularNumbers>{question.memory_limit_mb} MB</Text></MetadataListItem>}
          </MetadataList>}
        </VStack>
        {availableProblemTabs.length > 1 && <TabList value={activeProblemTab} onChange={(tab) => setProblemTab(tab as ProblemSectionKey)} size="sm" layout="fill" hasDivider aria-label="Problem sections">
          {availableProblemTabs.map((tab) => <Tab key={tab} value={tab}
            label={tab === "statement" ? "Statement" : tab === "examples" ? "Examples" : "Constraints"} />)}
        </TabList>}
        {/* Sanitized HTML is a content sink, not a layout wrapper. Keep its native event target. */}
        <div className="pb-body pb-body-editorial" onClick={handleProblemBodyClick}
          dangerouslySetInnerHTML={{ __html: problemBodyHtml }} />
        {activeProblemTab === "statement" && questions[activeQ] && <MarkingScheme question={questions[activeQ]} />}
      </VStack>
    </StackItem>
  </VStack>;
}
