"use client";

import { Plus, Play, Trash2 } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Spinner } from "@astryxdesign/core/Spinner";

import { type CustomCase, MAX_CUSTOM_CASES, canRun, newCase } from "../custom-cases";

/**
 * The candidate's own test cases for the active problem.
 *
 * Expected output is a second, optional box rather than a required one. Most
 * of the time someone running their own input wants to see what it prints,
 * not to assert an answer they would have to work out by hand first; making
 * it mandatory would turn a debugging aid into homework. When it is filled
 * in, the case goes through the problem's own checker, so whitespace and
 * float tolerance match a real submission rather than a string compare.
 */
export function CustomCasesPanel({
  cases,
  onChange,
  onRun,
  isRunning,
  readOnly,
  runDisabledReason,
}: {
  cases: CustomCase[];
  onChange: (next: (previous: CustomCase[]) => CustomCase[]) => void;
  onRun: () => void;
  isRunning: boolean;
  readOnly: boolean;
  runDisabledReason: string | null;
}) {
  const full = cases.length >= MAX_CUSTOM_CASES;
  const runnable = canRun(cases) && !isRunning && !readOnly && !runDisabledReason;

  const update = (id: string, patch: Partial<CustomCase>) =>
    onChange((previous) => previous.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  return (
    <VStack
      gap={3}
      padding={4}
      style={{ borderBottom: "var(--border-width) solid var(--color-border)" }}
    >
      <HStack gap={3} align="center" justify="between" wrap="wrap">
        <VStack gap={0}>
          <Text type="supporting" weight="medium">
            Your own test cases
          </Text>
          <Text type="supporting" color="secondary">
            Not scored, and not an attempt. Expected output is optional: leave it blank to just see
            what your code prints.
          </Text>
        </VStack>
        <HStack gap={2} align="center" wrap="wrap">
          <Button
            label="Add case"
            variant="secondary"
            size="sm"
            icon={<Plus size={14} aria-hidden="true" />}
            isDisabled={readOnly || full}
            onClick={() => onChange((previous) => [...previous, newCase()])}
            {...{ title: full ? `At most ${MAX_CUSTOM_CASES} cases` : "Add a case" }}
          />
          <Button
            label="Run custom"
            variant="secondary"
            size="sm"
            icon={isRunning ? <Spinner size="sm" /> : <Play size={14} aria-hidden="true" />}
            isDisabled={!runnable}
            onClick={onRun}
            {...{
              title:
                runDisabledReason ??
                (canRun(cases)
                  ? "Run your code against these cases only"
                  : "Add a case with some input first"),
            }}
          />
        </HStack>
      </HStack>

      {cases.length === 0 ? (
        <Text type="supporting" color="secondary">
          No cases yet. Add one to try your code against input of your own.
        </Text>
      ) : (
        <VStack gap={3}>
          {cases.map((testCase, index) => (
            <VStack
              key={testCase.id}
              gap={2}
              padding={3}
              style={{
                border: "var(--border-width) solid var(--color-border)",
                borderRadius: "var(--radius-element)",
              }}
            >
              <HStack gap={2} align="center" justify="between">
                <Text type="supporting" weight="medium">
                  Case {index + 1}
                </Text>
                <IconButton
                  label={`Remove case ${index + 1}`}
                  variant="ghost"
                  size="sm"
                  isDisabled={readOnly}
                  icon={<Trash2 size={14} aria-hidden="true" />}
                  onClick={() =>
                    onChange((previous) => previous.filter((c) => c.id !== testCase.id))
                  }
                />
              </HStack>

              <label htmlFor={`${testCase.id}-input`}>
                <Text type="supporting" color="secondary">
                  Input
                </Text>
              </label>
              <textarea
                id={`${testCase.id}-input`}
                value={testCase.input}
                disabled={readOnly}
                rows={3}
                spellCheck={false}
                onChange={(event) => update(testCase.id, { input: event.target.value })}
                style={BOX}
              />

              <HStack gap={2} align="center">
                <input
                  id={`${testCase.id}-judge`}
                  type="checkbox"
                  disabled={readOnly}
                  checked={testCase.expected !== null}
                  onChange={(event) =>
                    update(testCase.id, { expected: event.target.checked ? "" : null })
                  }
                />
                <label htmlFor={`${testCase.id}-judge`}>
                  <Text type="supporting" color="secondary">
                    Check against expected output
                  </Text>
                </label>
              </HStack>

              {testCase.expected !== null && (
                <textarea
                  aria-label={`Expected output for case ${index + 1}`}
                  value={testCase.expected}
                  disabled={readOnly}
                  rows={3}
                  spellCheck={false}
                  onChange={(event) => update(testCase.id, { expected: event.target.value })}
                  style={BOX}
                />
              )}
            </VStack>
          ))}
        </VStack>
      )}
    </VStack>
  );
}

const BOX: React.CSSProperties = {
  width: "100%",
  minHeight: "calc(var(--spacing-10) * 1.5)",
  padding: "var(--spacing-2)",
  border: "var(--border-width) solid var(--color-border)",
  borderRadius: "var(--radius-element)",
  background: "var(--color-background-body)",
  color: "var(--color-text-primary)",
  fontFamily: "var(--font-family-mono, monospace)",
  fontSize: "var(--font-size-sm)",
  resize: "vertical",
};
