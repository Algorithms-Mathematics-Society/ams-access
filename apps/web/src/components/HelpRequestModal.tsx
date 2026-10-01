"use client";

import { useState } from "react";
import { AccessDialog } from "./AccessDialog";
import { VStack, HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TextArea } from "@astryxdesign/core/TextArea";
import { Button } from "@astryxdesign/core/Button";
import { Banner } from "@astryxdesign/core/Banner";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { resolveApiBase } from "@/lib/api-base";
import { STORAGE_KEYS } from "@/constants/storage-keys";

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

  if (!open) return null;

  async function submit() {
    if (!email.trim()) {
      setState("error");
      return;
    }
    setState("sending");
    const payload = {
      candidate_email: email.trim(),
      contest_id: contestId ?? undefined,
      kind,
      summary,
      details: { ...(details ?? {}), candidate_note: note.trim() || undefined },
    };
    try {
      const url = sessionId
        ? `${API_URL}/participant/sessions/${encodeURIComponent(sessionId)}/incidents`
        : `${API_URL}/participant/support-incidents`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setState("error");
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { id?: string };
      setReference(data.id ?? null);
      setState("sent");
    } catch {
      setState("error");
    }
  }

  return (
    <AccessDialog open={open} onClose={onClose} labelId="help-request-title"
      title={state === "sent" ? "Your organizer has been notified" : "Get help from your organizer"}
      width="calc(var(--spacing-10) * 13)">
      {state === "sent" ? (
        <VStack gap={5}>
          <Text color="secondary">
            We&apos;ve sent your help request along with diagnostic details. Keep this window or
            your reference handy if a proctor contacts you.
          </Text>
          {reference && (
            <MetadataList>
              <MetadataListItem label="Reference">
                <Text type="code" style={{ overflowWrap: "anywhere", userSelect: "all" }}>{reference}</Text>
              </MetadataListItem>
            </MetadataList>
          )}
          <HStack justify="end"><Button label="Done" variant="primary" onClick={onClose} /></HStack>
        </VStack>
      ) : (
        <VStack gap={5}>
          <Text color="secondary">{summary}</Text>
          <TextInput label="Your email" type="email" value={email} onChange={setEmail}
            placeholder="you@institution.edu" isRequired />
          <TextArea label="What happened?" isOptional value={note} onChange={setNote} rows={3}
            placeholder="Describe the problem so your proctor can help faster." />
          <Text type="supporting">
            Diagnostic details about your device and the error are included automatically.
          </Text>
          {state === "error" && <Banner status="error" title="Couldn't send the request"
            description="Check your email and connection, then try again." />}
          <HStack gap={3} justify="end" wrap="wrap">
            <Button label="Cancel" variant="ghost" onClick={onClose} />
            <Button label={state === "sending" ? "Sending…" : "Send to organizer"}
              onClick={() => void submit()} isDisabled={state === "sending"}
              isLoading={state === "sending"} variant="primary" />
          </HStack>
        </VStack>
      )}
    </AccessDialog>
  );
}
