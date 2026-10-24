"use client";

import { useEffect, useRef, useState, type ReactNode, type FormEvent } from "react";
import { AccessDialog } from "./AccessDialog";
import { VStack, HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TextArea } from "@astryxdesign/core/TextArea";
import { Button } from "@astryxdesign/core/Button";
import { Banner } from "@astryxdesign/core/Banner";
import { resolveApiBase } from "@/lib/api-base";
import {
  SUPPORT_STORAGE_KEY,
  mergeSupportMessages,
  matchesSupportOperation,
  newSupportAccess,
  parseSupportReceipt,
  supportRequest,
  type SupportReceipt,
  type SupportThread,
} from "@/lib/support-chat";

const API_URL = resolveApiBase();
export type HelpIncidentKind = "LOGIN" | "READINESS" | "POLICY_BLOCK" | "DISCONNECT" | "OTHER";
type HelpRequestModalProps = {
  renderDialog?: (content: ReactNode) => ReactNode;
  open: boolean;
  onClose: () => void;
  kind: HelpIncidentKind;
  summary: string;
  details?: Record<string, unknown>;
  sessionId?: string | null;
  contestId?: string | null;
  defaultEmail?: string;
};

/** One support conversation survives closing, navigation and reloading this window. */
export function HelpRequestModal({
  open,
  onClose,
  kind,
  summary,
  defaultEmail,
  renderDialog,
}: HelpRequestModalProps) {
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [organization, setOrganization] = useState("");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [receipt, setReceipt] = useState<SupportReceipt | null>(null);
  const receiptRef = useRef<SupportReceipt | null>(null);
  const [thread, setThread] = useState<SupportThread | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [storageWarning, setStorageWarning] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const inFlight = useRef(false);
  const storageFailed = useRef(false);
  const messagesRef = useRef<SupportThread["messages"]>([]);
  const streamRef = useRef<HTMLElement | null>(null);

  function save(next: SupportReceipt | null) {
    receiptRef.current = next;
    setReceipt(next);
    try {
      if (next) sessionStorage.setItem(SUPPORT_STORAGE_KEY, JSON.stringify(next));
      else sessionStorage.removeItem(SUPPORT_STORAGE_KEY);
    } catch {
      storageFailed.current = true;
      setStorageWarning(true);
    }
  }

  function acknowledge(expected: SupportReceipt): boolean {
    const next = { access: expected.access };
    // Another mounted help surface may have started a new chat or queued a
    // later message while this request was awaiting its response. Neither
    // that recovery record nor an adopted local conversation belongs to it.
    const ownsLocalOperation = matchesSupportOperation(receiptRef.current, expected);
    if (ownsLocalOperation) {
      receiptRef.current = next;
      setReceipt(next);
    }
    if (!storageFailed.current) {
      try {
        const latest = parseSupportReceipt(sessionStorage.getItem(SUPPORT_STORAGE_KEY));
        if (matchesSupportOperation(latest, expected)) {
          sessionStorage.setItem(SUPPORT_STORAGE_KEY, JSON.stringify(next));
        }
      } catch {
        storageFailed.current = true;
        setStorageWarning(true);
      }
    }
    return ownsLocalOperation;
  }

  useEffect(() => {
    if (!open) return;
    if (storageFailed.current) {
      setReady(true);
      return;
    }
    try {
      const saved = parseSupportReceipt(sessionStorage.getItem(SUPPORT_STORAGE_KEY));
      if (receiptRef.current?.access.uid !== saved?.access.uid) {
        messagesRef.current = [];
        setThread(null);
        setDraft("");
        setError("");
        setSyncError("");
      }
      receiptRef.current = saved;
      setReceipt(saved);
      if (saved?.pendingMessage) setDraft(saved.pendingMessage.body);
      if (saved?.pendingStart) {
        const s = saved.pendingStart;
        setEmail(s.email);
        setPhone(s.phone);
        setName(s.name);
        setQuery(s.body);
        setOrganization(s.organization);
      }
    } catch {
      setStorageWarning(true);
    }
    setReady(true);
  }, [open]);

  const uid = receipt?.access.uid;
  const pendingStart = Boolean(receipt?.pendingStart);
  useEffect(() => {
    if (!open || !uid || pendingStart) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let polling = false;
    const poll = async () => {
      if (stopped || polling || document.hidden) return;
      polling = true;
      try {
        let more = true;
        while (more && !stopped) {
          const access = receiptRef.current?.access;
          if (!access || access.uid !== uid) return;
          const last = messagesRef.current.at(-1)?.uid;
          const data: SupportThread = await supportRequest<SupportThread>(
            API_URL,
            `/support/conversations/${uid}${last ? `?after=${last}` : ""}`,
            access
          );
          if (stopped) return;
          if (
            data.uid !== uid ||
            !Array.isArray(data.messages) ||
            typeof data.has_more !== "boolean" ||
            !["open", "resolved"].includes(data.status) ||
            !data.messages.every(
              (message) =>
                typeof message.uid === "string" &&
                typeof message.body === "string" &&
                ["staff", "participant"].includes(message.sender) &&
                typeof message.created_at === "string" &&
                Number.isFinite(Date.parse(message.created_at))
            )
          ) {
            throw new Error("The conversation response was incomplete. Reopen chat to retry.");
          }
          const nextMessages = mergeSupportMessages(messagesRef.current, data.messages);
          if (data.has_more && nextMessages.at(-1)?.uid === last) {
            throw new Error("Chat history did not advance. Reopen chat to retry.");
          }
          messagesRef.current = nextMessages;
          setThread({ ...data, messages: messagesRef.current });
          setSyncError("");
          more = data.has_more;
        }
      } catch (e) {
        if (!stopped)
          setSyncError(e instanceof Error ? e.message : "Unable to refresh conversation.");
      } finally {
        polling = false;
        if (!stopped) {
          clearTimeout(timer);
          timer = setTimeout(() => void poll(), 4000);
        }
      }
    };
    const visible = () => {
      if (!document.hidden) void poll();
    };
    void poll();
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [open, uid, pendingStart, refresh]);

  useEffect(() => {
    const stream = streamRef.current;
    if (stream) stream.scrollTop = stream.scrollHeight;
  }, [thread?.messages.length, open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || inFlight.current || !event.currentTarget.reportValidity()) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    let operation: SupportReceipt | null = null;
    try {
      let current = receiptRef.current;
      if (!current || current.pendingStart) {
        if (!current) {
          const access = newSupportAccess();
          current = {
            access,
            pendingStart: {
              ...access,
              email: email.trim(),
              phone: phone.trim(),
              name: name.trim(),
              organization: organization.trim(),
              category: kind,
              body: [summary, query.trim()].filter(Boolean).join("\n\n").slice(0, 4000),
            },
          };
          save(current);
        }
        operation = current;
        const ack = await supportRequest<{ uid: string }>(
          API_URL,
          "/support/conversations",
          undefined,
          current.pendingStart
        );
        if (ack.uid !== current.access.uid)
          throw new Error("The server did not confirm this request. Retry safely.");
        acknowledge(operation);
      } else {
        const message = current.pendingMessage ?? { uid: crypto.randomUUID(), body: draft.trim() };
        if (!message.body) return;
        operation = { ...current, pendingMessage: message };
        save(operation);
        const ack = await supportRequest<{ uid: string }>(
          API_URL,
          `/support/conversations/${current.access.uid}/messages`,
          current.access,
          message
        );
        if (ack.uid !== message.uid)
          throw new Error("The server did not confirm this message. Retry safely.");
        if (acknowledge(operation)) setDraft("");
      }
      setRefresh((n) => n + 1);
    } catch (e) {
      if (!operation || matchesSupportOperation(receiptRef.current, operation)) {
        setError(e instanceof Error ? e.message : "Unable to send. Retry safely.");
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function forget() {
    if (inFlight.current) return;
    save(null);
    setThread(null);
    messagesRef.current = [];
    setDraft("");
    setQuery("");
    setError("");
    setSyncError("");
  }

  if (!open) return null;
  const composing = !receipt || Boolean(receipt.pendingStart);
  const locked = busy || Boolean(receipt?.pendingStart);
  const content = (
    <VStack gap={5} style={{ minWidth: 0, overflowWrap: "anywhere" }}>
      {storageWarning && (
        <Banner
          status="warning"
          title="Keep this chat open"
          description="Conversation recovery is unavailable on this device. Navigating away, reloading or closing this chat may lose access."
        />
      )}
      {!ready ? (
        <Text role="status">Loading support…</Text>
      ) : composing ? (
        <form onSubmit={(e) => void submit(e)}>
          <VStack gap={4}>
            <Text color="secondary">
              Tell us how to reach you and what went wrong. You can chat here after sending, even if
              you cannot sign in.
            </Text>
            <TextInput
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              isRequired
              isDisabled={locked}
              ref={(el) => {
                if (el) {
                  el.required = true;
                  el.maxLength = 320;
                }
              }}
            />
            <TextInput
              label="Phone number"
              value={phone}
              onChange={setPhone}
              isRequired
              isDisabled={locked}
              ref={(el) => {
                if (el) {
                  el.required = true;
                  el.maxLength = 40;
                  el.inputMode = "tel";
                }
              }}
            />
            <TextInput
              label="Name"
              value={name}
              onChange={setName}
              isRequired
              isDisabled={locked}
              ref={(el) => {
                if (el) {
                  el.required = true;
                  el.maxLength = 120;
                }
              }}
            />
            <TextArea
              label="Your issue"
              value={query}
              onChange={setQuery}
              rows={3}
              maxLength={3000}
              isRequired
              isDisabled={locked}
              ref={(el) => {
                if (el) el.required = true;
              }}
              description={summary}
            />
            <TextInput
              label="Organization code"
              value={organization}
              onChange={setOrganization}
              isOptional
              isDisabled={locked}
              description="Only needed if your organizer provided one."
            />
            {receipt?.pendingStart && (
              <Text type="supporting">
                This request is awaiting confirmation. Retry sends the same request safely. To
                correct details, start a new request.
              </Text>
            )}
            {error && (
              <Banner
                status="error"
                role="alert"
                title="Request not confirmed"
                description={error}
              />
            )}
            <HStack gap={3} justify="end" wrap="wrap">
              {receipt?.pendingStart && (
                <Button
                  type="button"
                  variant="ghost"
                  label="Start a new request"
                  isDisabled={busy}
                  onClick={forget}
                />
              )}
              <Button type="button" variant="secondary" label="Close" onClick={onClose} />
              <Button
                type="submit"
                variant="primary"
                label={
                  busy ? "Sending…" : receipt?.pendingStart ? "Retry request" : "Start conversation"
                }
                isDisabled={busy}
                isLoading={busy}
              />
            </HStack>
          </VStack>
        </form>
      ) : (
        <VStack gap={4}>
          <Text type="supporting">Reference: {receipt.access.uid}</Text>
          {thread && (
            <Text>
              {thread.name} · {thread.email} · {thread.phone}
            </Text>
          )}
          {syncError && (
            <Banner
              status="warning"
              role="status"
              title="Chat refresh interrupted"
              description={syncError}
            />
          )}
          {!thread && (
            <Text role="status">
              {syncError
                ? "Your conversation is saved. Reconnect to load replies."
                : "Loading conversation…"}
            </Text>
          )}
          <VStack
            ref={streamRef}
            role="log"
            aria-label="Support conversation"
            aria-live="polite"
            aria-relevant="additions"
            gap={4}
            style={{
              maxHeight: "calc(var(--spacing-10) * 7)",
              overflowY: "auto",
              overflowWrap: "anywhere",
            }}
          >
            {thread?.messages.map((message) => (
              <VStack
                key={message.uid}
                gap={1}
                style={{
                  padding: "var(--spacing-3)",
                  borderRadius: "var(--radius-element)",
                  background:
                    message.sender === "staff" ? "var(--color-surface)" : "var(--color-body)",
                }}
              >
                <Text type="supporting">
                  {message.sender === "staff" ? "Organizer" : "You"} ·{" "}
                  {new Date(message.created_at).toLocaleString()}
                </Text>
                <Text style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                  {message.body}
                </Text>
              </VStack>
            ))}
          </VStack>
          {thread?.status === "resolved" && (
            <Banner
              status="success"
              title="Issue resolved"
              description="You can still read this conversation. Start a new request if you need more help."
            />
          )}
          {(thread?.status !== "resolved" || receipt.pendingMessage) && (
            <form onSubmit={(e) => void submit(e)}>
              <VStack gap={3}>
                <TextArea
                  label="Message"
                  rows={3}
                  value={draft}
                  onChange={setDraft}
                  maxLength={4000}
                  isDisabled={busy || Boolean(receipt.pendingMessage)}
                  isRequired
                  ref={(el) => {
                    if (el) el.required = true;
                  }}
                />
                {receipt.pendingMessage && (
                  <Text type="supporting">
                    Awaiting confirmation. Retry sends this same message safely.
                  </Text>
                )}
                {error && (
                  <Banner
                    status="error"
                    role="alert"
                    title="Message not confirmed"
                    description={error}
                  />
                )}
                <HStack justify="end">
                  <Button
                    type="submit"
                    label={
                      busy ? "Sending…" : receipt.pendingMessage ? "Retry message" : "Send message"
                    }
                    variant="primary"
                    isLoading={busy}
                    isDisabled={busy || (!draft.trim() && !receipt.pendingMessage) || !thread}
                  />
                </HStack>
              </VStack>
            </form>
          )}
          <Text type="supporting">
            Access to this conversation is saved in this app window. Keep it open for replies.
            Support does not pause your assessment timer. Never send your password.
          </Text>
          <HStack gap={3} justify="end" wrap="wrap">
            <Button
              label="Forget chat / new request"
              variant="ghost"
              onClick={forget}
              isDisabled={busy}
            />
            <Button label="Close" variant="secondary" onClick={onClose} />
          </HStack>
        </VStack>
      )}
    </VStack>
  );
  return renderDialog ? (
    renderDialog(content)
  ) : (
    <AccessDialog
      open={open}
      onClose={onClose}
      labelId="help-request-title"
      title="Talk to your organizer"
      width="calc(var(--spacing-10) * 15)"
    >
      {content}
    </AccessDialog>
  );
}
