import { memo, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import {
  askDocsAssistant,
  listDocsMessages,
  ProctorApiError,
  type DocsMessage,
} from "../../../../lib/proctor-api";
import { MAX_QUESTION_WORDS, askErrorMessage, countWords } from "../docs-assistant";

// Nothing moves between the chat and the rest of the machine: no copy, cut or
// paste, no drag and drop, no context menu, in either direction.
const block = (event: { preventDefault: () => void }) => event.preventDefault();
const NO_CLIPBOARD = {
  onCopy: block,
  onCut: block,
  onPaste: block,
  onDrop: block,
  onDragOver: block,
  onDragStart: block,
  onContextMenu: block,
};

export interface AssistantPanelProps {
  contestUid: string;
  onClose: () => void;
}

/** The documentation assistant: one chat per contest on the left of the
 * workspace; scroll up for earlier questions. Answers come from ams-api,
 * which only points at documentation and never writes code. */
export const AssistantPanel = memo(function AssistantPanel({
  contestUid,
  onClose,
}: AssistantPanelProps) {
  const [messages, setMessages] = useState<DocsMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    listDocsMessages(contestUid)
      .then((loaded) => {
        if (!cancelled && Array.isArray(loaded)) setMessages(loaded);
      })
      .catch(() => {
        if (!cancelled)
          setLoadError("Earlier questions could not be loaded. New questions still work.");
      });
    return () => {
      cancelled = true;
    };
  }, [contestUid]);

  const words = countWords(question);
  const tooLong = words > MAX_QUESTION_WORDS;

  // Keep the newest exchange in view; earlier ones are a scroll up.
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [messages.length, sending]);

  async function send() {
    const text = question.trim();
    if (!text || tooLong || sending) return;
    setSending(true);
    setError("");
    try {
      const answer = await askDocsAssistant(contestUid, text);
      setMessages((previous) => [
        ...previous,
        { ...answer, question: text, asked_at: new Date().toISOString() },
      ]);
      setQuestion("");
    } catch (caught) {
      setError(
        askErrorMessage(
          caught instanceof ProctorApiError
            ? { status: caught.status, message: caught.message, detail: caught.detail }
            : {}
        )
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <VStack
      as="aside"
      gap={0}
      className="contest-assistant-panel"
      aria-label="Documentation assistant"
      width={360}
      {...NO_CLIPBOARD}
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
        padding={4}
        gap={2}
        align="start"
        justify="between"
        style={{ flexShrink: 0, borderBottom: "var(--border-width) solid var(--color-border)" }}
      >
        <VStack gap={1} style={{ minWidth: 0 }}>
          <Text type="label">Docs assistant</Text>
          <Text type="supporting" color="secondary">
            Points you to C++, nlohmann/json and Boost documentation. It does not write code, and
            copy and paste are off here.
          </Text>
        </VStack>
        <IconButton
          label="Close docs assistant"
          tooltip="Close"
          variant="secondary"
          size="sm"
          icon={<X size={16} />}
          onClick={onClose}
        />
      </HStack>

      <div
        ref={log}
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "var(--spacing-3)",
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
      >
        <VStack gap={4}>
          {loadError && <Banner status="warning" title={loadError} />}
          {messages.length === 0 && !sending && (
            <Text type="supporting" color="secondary">
              Ask about a function, class or header, for example “What does std::lower_bound
              return?”. You can ask follow-up questions; scroll up to see earlier ones.
            </Text>
          )}
          {messages.map((message) => (
            <Exchange key={message.exchange_uid} message={message} />
          ))}
          {sending && (
            <Text type="supporting" color="secondary">
              Looking it up…
            </Text>
          )}
        </VStack>
      </div>

      <VStack
        gap={2}
        padding={3}
        style={{ flexShrink: 0, borderTop: "var(--border-width) solid var(--color-border)" }}
      >
        {error && <Banner status="error" title={error} />}
        <TextArea
          label="Question"
          placeholder="Ask about the documentation…"
          value={question}
          onChange={setQuestion}
          isDisabled={sending}
          hasSpellCheck={false}
          rows={3}
          onKeyDown={(event: React.KeyboardEvent) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <HStack gap={2} align="center" justify="between">
          <Text
            type="supporting"
            color={tooLong ? "inherit" : "secondary"}
            style={tooLong ? { color: "var(--color-text-error)" } : undefined}
            hasTabularNumbers
            aria-live="polite"
          >
            {words} / {MAX_QUESTION_WORDS} words{tooLong ? " — shorten your question" : ""}
          </Text>
          <Button
            label={sending ? "Sending…" : "Send"}
            variant="primary"
            size="sm"
            isDisabled={!question.trim() || tooLong || sending}
            onClick={() => void send()}
          />
        </HStack>
      </VStack>
    </VStack>
  );
});

function Exchange({ message }: { message: DocsMessage }) {
  return (
    <VStack gap={2}>
      <div
        style={{
          alignSelf: "flex-end",
          maxWidth: "90%",
          padding: "var(--spacing-2) var(--spacing-3)",
          borderRadius: "var(--radius-element)",
          background: "var(--color-background-secondary, var(--color-background-muted))",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        <Text>{message.question}</Text>
      </div>
      <VStack gap={2} style={{ minWidth: 0 }}>
        <Text style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {message.text ??
            (message.outcome === "error"
              ? "The assistant could not answer this question."
              : "No answer.")}
        </Text>
        {message.reference && (
          <VStack gap={0} style={{ minWidth: 0 }}>
            <Text type="label">
              {message.reference.title} · {message.reference.source}
            </Text>
            {/* Text, not a link: the lockdown blocks external browsing. */}
            <Text type="supporting" color="secondary" style={{ overflowWrap: "anywhere" }}>
              {message.reference.url}
            </Text>
          </VStack>
        )}
        {message.example && (
          <CodeBlock
            code={message.example}
            language="cpp"
            hasCopyButton={false}
            isWrapped
            width="100%"
            size="sm"
            container="section"
          />
        )}
      </VStack>
    </VStack>
  );
}
