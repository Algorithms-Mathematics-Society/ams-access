"use client";

import { useRef, useState, type FormEvent } from "react";
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
  /** Optional: pre-fill the contact field. */
  defaultEmail?: string;
  /** Optional: what the candidate typed as their login ID, sent when signed out. */
  loginId?: string;
};

type Failure = { status: "error" | "info"; title: string; description: string };

const REJECTED: Failure = {
  status: "error",
  title: "Request rejected",
  description:
    "The server rejected this request. Your draft is still in this dialog. Check your sign-in or ask an invigilator before trying again.",
};
const UNCONFIRMED: Failure = {
  status: "error",
  title: "Delivery not confirmed",
  description:
    "The request may have reached your organizer, but no reference was received. Your draft is still in this dialog. Check with an invigilator before sending again to avoid a duplicate.",
};
// A server without `/client/support` answers 404 or 405, or fails CORS, which
// looks like no network at all. Either way the candidate's next step is the
// same as it was before that endpoint existed.
const ASK_INVIGILATOR: Failure = {
  status: "info",
  title: "Ask an invigilator",
  description:
    "This request could not be sent from the sign-in screen. An invigilator can reset your sign-in or reissue your details.",
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
  loginId,
}: HelpRequestModalProps) {
  // Optional and blank unless the caller supplies one. Candidates sign in with
  // a printed slip and may have no address to give; the invigilator already
  // knows their seat and session, so a reply route is a bonus, not a gate.
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [reference, setReference] = useState<string | null>(null);
  const [deliveryError, setDeliveryError] = useState<Failure | null>(null);
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
    if (inFlight.current || state === "sent") return;
    if (!event.currentTarget.reportValidity()) return;
    inFlight.current = true;
    setDeliveryError(null);
    setRequest({ summary, email: email.trim(), note: note.trim() });
    setState("sending");
    const message = [summary, note.trim()].filter(Boolean).join("\n\n");
    // Signed out (the login screen's "Can't sign in?"), the participant
    // endpoints would answer 401. `/client/support` takes no token, so it
    // carries only what the candidate typed, within the server's limits.
    const payload = authenticated
      ? {
          category: kind,
          message,
          diagnostics: details ?? {},
          contact: email.trim(),
          contest_uid: contestId ?? undefined,
        }
      : {
          login_id: loginId?.trim().slice(0, 64) || null,
          message: message.slice(0, 2000),
          contact: email.trim().slice(0, 200) || null,
        };
    const timeout = createAbortTimeout(10_000);
    try {
      const url = !authenticated
        ? `${API_URL}/client/support`
        : sessionId
          ? `${API_URL}/participant/sessions/${encodeURIComponent(sessionId)}/incidents`
          : `${API_URL}/participant/support-incidents`;
      const res = await fetch(url, {
        method: "POST",
        signal: timeout.signal,
        headers: { "Content-Type": "application/json", ...(authenticated ? authHeaders() : {}) },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setDeliveryError(await describeFailure(res, authenticated));
        setState("error");
        return;
      }
      const data = (await res.json()) as { id?: string; uid?: string };
      const id = authenticated ? data.id : data.uid;
      if (typeof id !== "string" || !id.trim()) {
        throw new Error("Help request was not acknowledged");
      }
      setReference(id);
      setState("sent");
    } catch {
      setDeliveryError(authenticated ? UNCONFIRMED : ASK_INVIGILATOR);
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
          {request?.email && <Text type="supporting">Contact: {request.email}</Text>}
          {reference && (
            <MetadataList>
              <MetadataListItem label="Reference">
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
          <form onSubmit={(event) => void submit(event)}>
            <VStack gap={5}>
              <TextInput
                label="Email or phone"
                isOptional
                value={email}
                onChange={setEmail}
                isDisabled={state === "sending"}
                placeholder="So your organizer can reply"
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
              {authenticated && (
                <Text type="supporting">
                  Diagnostic details about your device and the error are included automatically.
                </Text>
              )}
              {state === "sending" && (
                <Text role="status" type="supporting">
                  Sending this request. You can close this dialog and reopen it to check the result.
                </Text>
              )}
              {state === "error" && (
                <VStack gap={2}>
                  <Banner
                    status={deliveryError?.status ?? "error"}
                    role="alert"
                    title={deliveryError?.title}
                    description={deliveryError?.description}
                  />
                  <Text type="supporting">
                    Last attempt: {[request?.summary, request?.email].filter(Boolean).join(" · ")}
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
        </VStack>
      )}
    </AccessDialog>
  );
}

/** What a failed response means for the candidate, and what to do next. */
async function describeFailure(res: Response, authenticated: boolean): Promise<Failure> {
  if (!authenticated && (res.status === 404 || res.status === 405)) return ASK_INVIGILATOR;
  if (res.status === 429) {
    // Server errors carry their text in `detail.error`; newer ones may use
    // `detail.message`. Read either.
    const body = (await res.json().catch(() => null)) as { detail?: unknown } | null;
    const detail =
      body?.detail && typeof body.detail === "object"
        ? (body.detail as { message?: string; error?: string; retry_after?: number })
        : {};
    const text = detail.message ?? detail.error;
    const wait = detail.retry_after ?? Number(res.headers?.get("Retry-After"));
    return {
      status: "error",
      title: "Too many requests",
      description: [
        text,
        wait > 0
          ? `Try again in ${Math.ceil(wait)} seconds, or ask an invigilator.`
          : "Try again shortly, or ask an invigilator.",
      ]
        .filter(Boolean)
        .join(" "),
    };
  }
  return res.status >= 400 && res.status < 500 ? REJECTED : UNCONFIRMED;
}
