"use client";

import { useRef, useState, type FormEvent } from "react";
import { supportDiagnostics } from "@/lib/support-diagnostics";
import { AccessDialog } from "./AccessDialog";
import { VStack, HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TextArea } from "@astryxdesign/core/TextArea";
import { Button } from "@astryxdesign/core/Button";
import { Banner } from "@astryxdesign/core/Banner";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { resolveApiBase } from "@/lib/api-base";
import { createAbortTimeout } from "@/lib/abort-timeout";
import { authHeaders, participantToken } from "@/lib/candidate-auth";

const API_URL = resolveApiBase();

export type HelpIncidentKind = "LOGIN" | "READINESS" | "POLICY_BLOCK" | "DISCONNECT" | "OTHER";

type HelpRequestModalProps = {
  open: boolean;
  onClose: () => void;
  kind: HelpIncidentKind;
  /** One-line description of what the candidate was blocked by. */
  summary: string;
  /** Diagnostic context (device state, error codes, etc.) sent to the organizer. */
  details?: Record<string, unknown>;
  /** Optional: when raised from inside an active session. */
  sessionId?: string | null;
  /** Optional: the contest the candidate is trying to enter. */
  contestId?: string | null;
  /** Optional: pre-fill the email field (e.g. what the candidate typed on login). */
  defaultEmail?: string;
};

/**
 * Reusable "Get help / Contact proctor" escape hatch. Submits a support incident
 * the organizer sees in the contest Incidents tab. Used on the login screen, the
 * readiness/policy blocks, and the disconnection/resume flow.
 */
export function HelpRequestModal({
  open,
  onClose,
  kind,
  summary,
  details,
  sessionId,
  contestId,
  defaultEmail,
}: HelpRequestModalProps) {
  // Blank unless the caller supplies one. Candidates sign in with a printed
  // slip and the platform has no address for them — pre-filling a guess would
  // send the reply nowhere.
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [reference, setReference] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [deliveryError, setDeliveryError] = useState<"rejected" | "unconfirmed" | null>(null);
  const [request, setRequest] = useState<{ summary: string; email: string; note: string } | null>(
    null
  );
  // Closing hides the dialog; it does not cancel a POST or its acknowledgement.
  // Only one request owns this receipt until the candidate explicitly starts another.
  const inFlight = useRef(false);
  const authenticated = Boolean(participantToken());

  if (!open) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authenticated || inFlight.current || state === "sent") return;
    if (!event.currentTarget.reportValidity()) return;
    inFlight.current = true;
    setEmailError(null);
    setDeliveryError(null);
    setRequest({ summary, email: email.trim(), note: note.trim() });
    setState("sending");
    const payload = {
      category: kind,
      message: [summary, note.trim()].filter(Boolean).join("\n\n"),
      diagnostics: supportDiagnostics(details),
      contact: email.trim(),
      contest_uid: contestId ?? undefined,
    };
    const timeout = createAbortTimeout(10_000);
    try {
      const url = sessionId
        ? `${API_URL}/participant/sessions/${encodeURIComponent(sessionId)}/incidents`
        : `${API_URL}/participant/support-incidents`;
      const res = await fetch(url, {
        method: "POST",
        signal: timeout.signal,
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setDeliveryError(res.status >= 400 && res.status < 500 ? "rejected" : "unconfirmed");
        setState("error");
        return;
      }
      const data = (await res.json()) as { id?: string };
      if (typeof data.id !== "string" || !data.id.trim()) {
        throw new Error("Help request was not acknowledged");
      }
      setReference(data.id);
      setState("sent");
    } catch {
      setDeliveryError("unconfirmed");
      setState("error");
    } finally {
      inFlight.current = false;
      timeout.clear();
    }
  }

  function composeAnother() {
    if (inFlight.current) return;
    setState("idle");
    setReference(null);
    setRequest(null);
    setNote("");
    setEmailError(null);
    setDeliveryError(null);
  }

  return (
    <AccessDialog
      open={open}
      onClose={onClose}
      labelId="help-request-title"
      title={state === "sent" ? "Help request received" : "Get help from your organizer"}
      width="calc(var(--spacing-10) * 13)"
    >
      {state === "sent" ? (
        <VStack gap={5}>
          <Text color="secondary">
            Your organizer&apos;s support system received the request below. Keep its reference if
            you need to follow up.
          </Text>
          <Text>{request?.summary}</Text>
          {request?.note && <Text color="secondary">{request.note}</Text>}
          <Text type="supporting">Contact: {request?.email}</Text>
          {reference && (
            <MetadataList>
              <MetadataListItem label="Support reference">
                <Text type="code" style={{ overflowWrap: "anywhere", userSelect: "all" }}>
                  {reference}
                </Text>
              </MetadataListItem>
            </MetadataList>
          )}
          <HStack gap={3} justify="end" wrap="wrap">
            <Button label="Send another request" variant="secondary" onClick={composeAnother} />
            <Button label="Done" variant="primary" onClick={onClose} />
          </HStack>
        </VStack>
      ) : (
        <VStack gap={5}>
          <Text color="secondary">{state === "sending" ? request?.summary : summary}</Text>
          {!authenticated ? (
            <>
              <Banner
                status="info"
                title="Sign in to send a help request"
                description="After signing in, use Get help to send your organizer the details. If you cannot sign in, contact your contest organizer or an invigilator directly."
              />
              <HStack justify="end">
                <Button label="Done" variant="primary" onClick={onClose} />
              </HStack>
            </>
          ) : (
            <form
              onSubmit={(event) => void submit(event)}
              onInvalidCapture={(event) => {
                const input = event.target as HTMLInputElement;
                setEmailError(
                  input.validity.valueMissing
                    ? "Enter an email address so your organizer can reply."
                    : "Enter a valid email address, such as you@institution.edu."
                );
              }}
            >
              <VStack gap={5}>
                <TextInput
                  label="Your email"
                  type="email"
                  value={email}
                  onChange={(value) => {
                    setEmail(value);
                    setEmailError(null);
                  }}
                  // Astryx isRequired supplies aria-required, but not native required.
                  ref={(input) => {
                    if (input) input.required = true;
                  }}
                  status={emailError ? { type: "error", message: emailError } : undefined}
                  isDisabled={state === "sending"}
                  placeholder="you@institution.edu"
                  isRequired
                />
                <TextArea
                  label="What happened?"
                  isOptional
                  value={note}
                  onChange={setNote}
                  isDisabled={state === "sending"}
                  rows={3}
                  placeholder="Describe the problem so your proctor can help faster."
                />
                <Text type="supporting">
                  Only the automatic context shown below is included. Your message and reply email
                  are sent to your organizer. Do not include passwords, access tokens or screenshots
                  containing credentials. Describe what you have already tried.
                </Text>
                <Text
                  type="code"
                  style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", userSelect: "text" }}
                >
                  {JSON.stringify(supportDiagnostics(details), null, 2)}
                </Text>
                {state === "sending" && (
                  <Text role="status" type="supporting">
                    Sending this request. You can close this dialog and reopen it to check the
                    result.
                  </Text>
                )}
                {state === "error" && (
                  <VStack gap={2}>
                    <Banner
                      status="error"
                      role="alert"
                      title={
                        deliveryError === "rejected" ? "Request rejected" : "Delivery not confirmed"
                      }
                      description={
                        deliveryError === "rejected"
                          ? "The server rejected this request. Your draft is still in this dialog. Check your sign-in or ask an invigilator before trying again."
                          : "The request may have reached your organizer, but no reference was received. Your draft is still in this dialog. Check with an invigilator before sending again to avoid a duplicate."
                      }
                    />
                    <Text type="supporting">
                      Last attempt: {request?.summary} · {request?.email}
                    </Text>
                  </VStack>
                )}
                <HStack gap={3} justify="end" wrap="wrap">
                  <Button type="button" label="Close" variant="ghost" onClick={onClose} />
                  <Button
                    label={state === "sending" ? "Sending…" : "Send to organizer"}
                    type="submit"
                    isDisabled={state === "sending"}
                    isLoading={state === "sending"}
                    variant="primary"
                  />
                </HStack>
              </VStack>
            </form>
          )}
        </VStack>
      )}
    </AccessDialog>
  );
}
