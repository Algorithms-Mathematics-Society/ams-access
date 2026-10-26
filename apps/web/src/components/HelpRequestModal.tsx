"use client";

import { useEffect, useRef, useState, type ReactNode, type FormEvent } from "react";
import { AccessDialog } from "./AccessDialog";
import { VStack, HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TextArea } from "@astryxdesign/core/TextArea";
import { Button } from "@astryxdesign/core/Button";
import { Banner } from "@astryxdesign/core/Banner";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { startSupportPolling } from "@/lib/support-poll";
import { resolveApiBase } from "@/lib/api-base";
import {
  currentToken,
  authGeneration,
  subscribeAuthChanges,
  currentParticipantUid,
} from "@/lib/proctor-api";
import {
  SUPPORT_STORAGE_KEY,
  matchesGuestIssueDraft,
  mergeSupportMessages,
  matchesSupportOperation,
  newSupportAccess,
  parseGuestIssueDraft,
  parseSupportReceipt,
  supportRequest,
  type GuestIssueDraft,
  type SupportReceipt,
  type SupportThread,
} from "@/lib/support-chat";

const API_URL = resolveApiBase();
export type HelpIncidentKind = "LOGIN" | "READINESS" | "POLICY_BLOCK" | "DISCONNECT" | "OTHER";
type HelpRequestModalProps = {
  renderDialog?: (content: ReactNode) => ReactNode;
  secondaryAction?: ReactNode;
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
  defaultEmail,
  contestId,
  renderDialog,
  secondaryAction,
}: HelpRequestModalProps) {
  const guestRequest = kind === "LOGIN";
  const storageKey = guestRequest ? `${SUPPORT_STORAGE_KEY}_guest_request` : SUPPORT_STORAGE_KEY;
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [organization, setOrganization] = useState("");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [receipt, setReceipt] = useState<SupportReceipt | null>(null);
  const receiptRef = useRef<SupportReceipt | null>(null);
  const [guestIssue, setGuestIssue] = useState<GuestIssueDraft | null>(null);
  const guestIssueRef = useRef<GuestIssueDraft | null>(null);
  const [thread, setThread] = useState<SupportThread | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [storageWarning, setStorageWarning] = useState(false);
  const [recoveryNotice, setRecoveryNotice] = useState("");
  const [guestSent, setGuestSent] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const inFlight = useRef(false);
  const storageFailed = useRef(false);
  const messagesRef = useRef<SupportThread["messages"]>([]);
  const streamRef = useRef<HTMLElement | null>(null);
  const [identityVersion, setIdentityVersion] = useState(0);
  const writeController = useRef<AbortController | null>(null);
  useEffect(
    () =>
      subscribeAuthChanges(() => {
        if (guestRequest) return;
        writeController.current?.abort();
        receiptRef.current = null;
        messagesRef.current = [];
        setReceipt(null);
        setThread(null);
        setDraft("");
        setQuery("");
        setError("");
        setSyncError("");
        setRecoveryNotice("");
        setIdentityVersion((version) => version + 1);
      }),
    [guestRequest]
  );

  function save(next: SupportReceipt | null) {
    receiptRef.current = next;
    setReceipt(next);
    try {
      if (next) sessionStorage.setItem(storageKey, JSON.stringify(next));
      else sessionStorage.removeItem(storageKey);
    } catch {
      storageFailed.current = true;
      setStorageWarning(true);
    }
  }

  function saveGuestIssue(next: GuestIssueDraft | null) {
    guestIssueRef.current = next;
    setGuestIssue(next);
    try {
      if (next) sessionStorage.setItem(storageKey, JSON.stringify(next));
      else sessionStorage.removeItem(storageKey);
    } catch {
      storageFailed.current = true;
      setStorageWarning(true);
    }
  }

  function acknowledge(expected: SupportReceipt): boolean {
    const next = { access: expected.access, owner: expected.owner };
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
        const latest = parseSupportReceipt(sessionStorage.getItem(storageKey));
        if (matchesSupportOperation(latest, expected)) {
          sessionStorage.setItem(storageKey, JSON.stringify(next));
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
      if (guestRequest) {
        const savedValue = sessionStorage.getItem(storageKey);
        const savedGuestIssue = parseGuestIssueDraft(savedValue);
        const previousGuestStart = savedGuestIssue
          ? null
          : parseSupportReceipt(savedValue)?.pendingStart;
        const guestDraft =
          savedGuestIssue ??
          (previousGuestStart
            ? {
                uid: previousGuestStart.uid,
                email: previousGuestStart.email,
                phone: previousGuestStart.phone,
                name: previousGuestStart.name,
                body: previousGuestStart.body,
                category: previousGuestStart.category,
              }
            : null);
        guestIssueRef.current = guestDraft;
        setGuestIssue(guestDraft);
        receiptRef.current = null;
        setReceipt(null);
        if (guestDraft) {
          setEmail(guestDraft.email);
          setPhone(guestDraft.phone);
          setName(guestDraft.name);
          setQuery(guestDraft.body);
          if (!savedGuestIssue) {
            sessionStorage.removeItem(storageKey);
            sessionStorage.setItem(storageKey, JSON.stringify(guestDraft));
          }
        }
        setGuestSent(false);
        setReady(true);
        return;
      }
      const saved = parseSupportReceipt(sessionStorage.getItem(storageKey));
      const owner = currentParticipantUid();
      const usable = owner && saved?.owner === owner ? saved : null;
      if (saved && !usable) {
        setRecoveryNotice(
          "That saved chat could not be matched to this sign-in. Start a new request for this account."
        );
        sessionStorage.removeItem(storageKey);
      }
      if (receiptRef.current?.access.uid !== usable?.access.uid) {
        messagesRef.current = [];
        setThread(null);
        setDraft("");
        setError("");
        setSyncError("");
      }
      receiptRef.current = usable;
      setReceipt(usable);
      if (usable?.pendingMessage) setDraft(usable.pendingMessage.body);
      if (usable?.pendingParticipantStart) setQuery(usable.pendingParticipantStart.body);
      if (usable?.pendingStart) {
        const s = usable.pendingStart;
        setEmail(s.email);
        setPhone(s.phone);
        setName(s.name);
        setQuery(s.body);
        setOrganization(s.organization);
      }
      setGuestSent(false);
    } catch {
      setStorageWarning(true);
    }
    setReady(true);
  }, [open]);

  const uid = receipt?.access.uid;
  const pendingStart = Boolean(
    guestIssue || receipt?.pendingStart || receipt?.pendingParticipantStart
  );
  useEffect(() => {
    if (!open || !uid || pendingStart) return;
    let stopped = false;
    const generation = authGeneration();
    const stop = startSupportPolling(async (signal) => {
      try {
        let more = true;
        for (let page = 0; more && page < 3 && !stopped; page += 1) {
          const access = receiptRef.current?.access;
          if (!access || access.uid !== uid) return;
          const last = messagesRef.current.at(-1)?.uid;
          const data: SupportThread = await supportRequest<SupportThread>(
            API_URL,
            `/support/conversations/${uid}${last ? `?after=${last}` : ""}`,
            access,
            undefined,
            undefined,
            { signal }
          );
          if (
            stopped ||
            signal.aborted ||
            generation !== authGeneration() ||
            receiptRef.current?.access.uid !== uid
          )
            return;
          if (
            data.uid !== uid ||
            !Array.isArray(data.messages) ||
            typeof data.has_more !== "boolean" ||
            !["open", "resolved"].includes(data.status) ||
            !data.messages.every(
              (message) =>
                typeof message.uid === "string" &&
                typeof message.body === "string" &&
                message.body.length <= 4000 &&
                ["staff", "participant"].includes(message.sender) &&
                Number.isFinite(Date.parse(message.created_at))
            )
          ) {
            throw new Error("The conversation response was incomplete. Reopen chat to retry.");
          }
          const nextMessages = mergeSupportMessages(messagesRef.current, data.messages);
          if (data.has_more && nextMessages.at(-1)?.uid === last)
            throw new Error("Chat history did not advance. Reopen chat to retry.");
          messagesRef.current = nextMessages;
          setThread({ ...data, messages: nextMessages });
          setSyncError("");
          more = data.has_more;
        }
      } catch (error) {
        if (!stopped && generation === authGeneration())
          setSyncError(error instanceof Error ? error.message : "Unable to refresh conversation.");
        throw error;
      }
    });
    return () => {
      stopped = true;
      stop();
    };
  }, [open, uid, pendingStart, refresh, identityVersion]);

  useEffect(() => {
    const stream = streamRef.current;
    if (stream) stream.scrollTop = stream.scrollHeight;
  }, [thread?.messages.length, open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || inFlight.current || !event.currentTarget.reportValidity()) return;
    inFlight.current = true;
    const generation = authGeneration();
    const validIdentity = () => guestRequest || generation === authGeneration();
    const controller = new AbortController();
    writeController.current = controller;
    setBusy(true);
    setError("");
    if (guestRequest) {
      let guestOperation = guestIssueRef.current;
      try {
        if (!guestOperation) {
          guestOperation = {
            uid: crypto.randomUUID(),
            email: email.trim(),
            phone: phone.trim(),
            name: name.trim(),
            category: kind,
            ...(contestId ? { contest_uid: contestId } : {}),
            body: query.trim().slice(0, 4000),
          };
          saveGuestIssue(guestOperation);
        }
        const ack = await supportRequest<{ received?: boolean }>(
          API_URL,
          "/support/issues",
          undefined,
          guestOperation
        );
        if (!validIdentity()) return;
        if (ack.received !== true)
          throw new Error("The server did not confirm this request. Retry safely.");
        if (matchesGuestIssueDraft(guestIssueRef.current, guestOperation)) {
          saveGuestIssue(null);
          setGuestSent(true);
          setQuery("");
        }
      } catch (e) {
        if (!guestOperation || matchesGuestIssueDraft(guestIssueRef.current, guestOperation)) {
          setError(e instanceof Error ? e.message : "Unable to send. Retry safely.");
        }
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
      return;
    }
    let operation: SupportReceipt | null = null;
    try {
      let current = receiptRef.current;
      if (!current || current.pendingStart || current.pendingParticipantStart) {
        if (!current) {
          const access = newSupportAccess();
          setRecoveryNotice("");
          const participantToken = currentToken();
          if (!participantToken)
            throw new Error("Your sign-in has expired. Sign in again to contact support.");
          current = {
            access,
            owner: currentParticipantUid() ?? undefined,
            pendingParticipantStart: {
              ...access,
              category: kind,
              ...(contestId ? { contest_uid: contestId } : {}),
              body: query.trim().slice(0, 4000),
            },
          };
          save(current);
        }
        operation = current;
        const participantToken = current.pendingParticipantStart
          ? (currentToken() ?? undefined)
          : undefined;
        if (current.pendingParticipantStart && !participantToken) {
          throw new Error("Your sign-in has expired. Sign in again to contact support.");
        }
        const legacyStart = Boolean(current.pendingStart && !guestRequest);
        const pendingStartBody = current.pendingStart
          ? legacyStart
            ? current.pendingStart
            : {
                uid: current.pendingStart.uid,
                email: current.pendingStart.email,
                phone: current.pendingStart.phone,
                name: current.pendingStart.name,
                category: current.pendingStart.category,
                body: current.pendingStart.body,
              }
          : current.pendingParticipantStart;
        const ack = await supportRequest<{ received?: boolean; uid?: string }>(
          API_URL,
          current.pendingParticipantStart
            ? "/participant/support/conversations"
            : "/support/conversations",
          undefined,
          pendingStartBody,
          participantToken,
          { signal: controller.signal }
        );
        if (!validIdentity()) return;
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
          message,
          undefined,
          { signal: controller.signal }
        );
        if (!validIdentity()) return;
        if (ack.uid !== message.uid)
          throw new Error("The server did not confirm this message. Retry safely.");
        if (acknowledge(operation)) setDraft("");
      }
      setRefresh((n) => n + 1);
    } catch (e) {
      if (
        validIdentity() &&
        (!operation || matchesSupportOperation(receiptRef.current, operation))
      ) {
        setError(e instanceof Error ? e.message : "Unable to send. Retry safely.");
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function forget() {
    if (inFlight.current) return;
    if (guestRequest) saveGuestIssue(null);
    else save(null);
    setThread(null);
    messagesRef.current = [];
    setDraft("");
    setQuery("");
    setError("");
    setSyncError("");
  }

  function editPendingRequest() {
    if (inFlight.current) return;
    // Keep the unsent text available while discarding the old idempotency key;
    // an edited payload must be retried under a new request id.
    if (guestRequest) saveGuestIssue(null);
    else save(null);
    setThread(null);
    messagesRef.current = [];
    setError("");
    setSyncError("");
  }

  if (!open) return null;
  const composing = !receipt || Boolean(receipt.pendingStart || receipt.pendingParticipantStart);
  const locked =
    busy || Boolean(guestIssue || receipt?.pendingStart || receipt?.pendingParticipantStart);
  const content = (
    <VStack gap={5} style={{ minWidth: 0, overflowWrap: "anywhere" }}>
      {recoveryNotice && (
        <Banner
          status="warning"
          title="Saved conversation unavailable"
          description={recoveryNotice}
        />
      )}
      {storageWarning && (
        <Banner
          status="warning"
          title={guestRequest ? "Keep this form open" : "Keep this chat open"}
          description={
            guestRequest
              ? "Draft recovery is unavailable on this device. Closing or reloading before sending may lose your message."
              : "Conversation recovery is unavailable on this device. Navigating away, reloading or closing this chat may lose access."
          }
        />
      )}
      {!ready ? (
        <Text role="status">Loading support…</Text>
      ) : guestSent ? (
        <VStack gap={4}>
          <Banner
            status="success"
            title="Request sent"
            description="The support team received your issue. Staff can follow up by email or phone; this form does not open a chat."
          />
          <HStack justify="end">
            <Button type="button" variant="primary" label="Done" onClick={onClose} />
          </HStack>
        </VStack>
      ) : composing ? (
        <form onSubmit={(e) => void submit(e)}>
          <VStack gap={4}>
            <Text color="secondary">
              {guestRequest
                ? "Tell us how to reach you and what went wrong. Your message will go to the support team."
                : "Describe what you need help with. Your participant details are attached automatically."}
            </Text>
            {guestRequest && (
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
            )}
            {guestRequest && (
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
            )}
            {guestRequest && (
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
            )}
            <TextArea
              label={guestRequest ? "Your issue" : "Message"}
              value={query}
              onChange={setQuery}
              rows={3}
              maxLength={4000}
              isRequired
              isDisabled={locked}
              ref={(el) => {
                if (el) el.required = true;
              }}
            />
            {pendingStart && (
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
            <HStack gap={3} align="center" justify="end" wrap="wrap">
              {secondaryAction}
              {pendingStart && (
                <Button
                  type="button"
                  variant="ghost"
                  label="Edit message"
                  isDisabled={busy}
                  onClick={editPendingRequest}
                />
              )}
              <Button
                type="button"
                variant="secondary"
                label="Close"
                onClick={onClose}
                isDisabled={guestRequest && busy}
              />
              <Button
                type="submit"
                variant="primary"
                label={
                  busy
                    ? "Sending…"
                    : pendingStart
                      ? "Retry request"
                      : guestRequest
                        ? "Send request"
                        : "Send message"
                }
                isDisabled={busy}
                isLoading={busy}
              />
            </HStack>
          </VStack>
        </form>
      ) : (
        <VStack gap={4}>
          <HStack gap={3} align="center" wrap="wrap" justify="between">
            <Text type="supporting">Conversation {receipt.access.uid}</Text>
            {thread && (
              <HStack gap={2} align="center">
                <StatusDot
                  variant={thread.status === "resolved" ? "success" : "accent"}
                  label={thread.status === "resolved" ? "Resolved" : "Open"}
                />
                <Text type="supporting">{thread.status === "resolved" ? "Resolved" : "Open"}</Text>
              </HStack>
            )}
          </HStack>
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
          <HStack gap={3} align="center" justify="end" wrap="wrap">
            {secondaryAction}
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
      title={guestRequest ? "Get help signing in" : "Support conversation"}
      width={guestRequest ? "calc(var(--spacing-10) * 15)" : "calc(var(--spacing-10) * 22)"}
    >
      {content}
    </AccessDialog>
  );
}
