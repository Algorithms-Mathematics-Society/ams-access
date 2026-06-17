"use client";

import { useState } from "react";
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
  const [email, setEmail] = useState(
    defaultEmail ||
      (typeof window !== "undefined" ? (localStorage.getItem(STORAGE_KEYS.USER_EMAIL) ?? "") : "")
  );
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
        ? `${API_URL}/sessions/${encodeURIComponent(sessionId)}/incidents`
        : `${API_URL}/support-incidents`;
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
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        background: "rgba(7,10,16,0.72)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        fontFamily: "system-ui, sans-serif",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 460,
          background: "#0d1117",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 12,
          padding: "24px 26px",
          color: "#e2e8f0",
        }}
      >
        {state === "sent" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: 17, fontWeight: 600 }}>Your organizer has been notified</div>
            <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>
              We&apos;ve sent your help request along with diagnostic details. Keep this window or
              your reference handy if a proctor contacts you.
            </div>
            {reference && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--color-accent-light)",
                  fontFamily: "monospace",
                  background: "rgb(var(--accent-rgb) / 0.1)",
                  border: "1px solid rgb(var(--accent-rgb) / 0.2)",
                  borderRadius: 6,
                  padding: "8px 10px",
                }}
              >
                Reference: {reference}
              </div>
            )}
            <button onClick={onClose} style={primaryBtn}>
              Done
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: 17, fontWeight: 600 }}>Get help from your organizer</div>
            <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.5 }}>{summary}</div>

            <label style={labelStyle}>Your email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@institution.edu"
              style={inputStyle}
            />

            <label style={labelStyle}>What happened? (optional)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Describe the problem so your proctor can help faster."
              style={{ ...inputStyle, resize: "vertical" }}
            />

            <div style={{ fontSize: 11, color: "#475569", lineHeight: 1.5 }}>
              Diagnostic details about your device and the error are included automatically.
            </div>

            {state === "error" && (
              <div style={{ fontSize: 12, color: "#fca5a5" }}>
                Couldn&apos;t send the request. Check your email and connection, then try again.
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <button onClick={onClose} style={ghostBtn}>
                Cancel
              </button>
              <button
                onClick={() => void submit()}
                disabled={state === "sending"}
                style={primaryBtn}
              >
                {state === "sending" ? "Sending…" : "Send to organizer"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#64748b",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 6,
  padding: "9px 11px",
  color: "#e2e8f0",
  fontSize: 13,
  boxSizing: "border-box",
};

const primaryBtn: React.CSSProperties = {
  flex: 1,
  padding: "10px 18px",
  background: "#7c3aed",
  border: "none",
  borderRadius: 6,
  color: "#fff",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const ghostBtn: React.CSSProperties = {
  padding: "10px 18px",
  background: "transparent",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 6,
  color: "#94a3b8",
  fontSize: 13,
  cursor: "pointer",
};
