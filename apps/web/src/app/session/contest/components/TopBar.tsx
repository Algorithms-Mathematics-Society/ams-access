import { type Dispatch, type SetStateAction } from "react";
import { Headset, LogOut } from "lucide-react";
import { CountdownBadge } from "./CountdownBadge";
import { type ContestMeta } from "./questions";

export interface TopBarProps {
  contest: ContestMeta | null;
  fallbackEndAt: string;
  handleContestExpiry: () => void | Promise<void>;
  setShowSupportModal: Dispatch<SetStateAction<boolean>>;
  submitConfirm: boolean;
  setSubmitConfirm: Dispatch<SetStateAction<boolean>>;
  submitError: string | null;
  setSubmitError: Dispatch<SetStateAction<string | null>>;
  handleSubmitConfirmed: () => void | Promise<void>;
  timeUpState: "idle" | "submitting" | "submitted" | "error";
}

export function TopBar({
  contest,
  fallbackEndAt,
  handleContestExpiry,
  setShowSupportModal,
  submitConfirm,
  setSubmitConfirm,
  submitError,
  setSubmitError,
  handleSubmitConfirmed,
  timeUpState,
}: TopBarProps) {
  return (
    <header
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr",
        alignItems: "center",
        padding: "0 20px",
        height: "48px",
        borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
        background: "#0F0F0F",
        flexShrink: 0,
        boxShadow: "none",
      }}
    >
      {/* Left: Logo + contest title */}
      <div style={{ display: "flex", alignItems: "center", gap: "14px", minWidth: 0 }}>
        <svg width="28" height="24" viewBox="0 0 172 164" fill="none">
          <path
            d="M2 162L87 2L172 162"
            stroke="url(#tg)"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <defs>
            <linearGradient id="tg" x1="2" y1="82" x2="172" y2="82" gradientUnits="userSpaceOnUse">
              <stop stopColor="#7B00FF" />
              <stop offset="0.5" stopColor="#C649F0" />
              <stop offset="1" stopColor="#E365FF" />
            </linearGradient>
          </defs>
        </svg>
        <span
          style={{
            fontSize: "12px",
            fontWeight: 700,
            color: "#ffffff",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: "260px",
          }}
        >
          {contest?.title ?? "Contest"}
        </span>
      </div>

      {/* Center: Timer */}
      <CountdownBadge endAt={contest?.end_at ?? fallbackEndAt} onExpiry={handleContestExpiry} />

      {/* Right: Support + exit */}
      <div
        style={{ display: "flex", alignItems: "center", gap: "10px", justifyContent: "flex-end" }}
      >
        <button
          type="button"
          onClick={() => setShowSupportModal(true)}
          className="ic-btn"
          title="Request support"
          aria-label="Request support"
          style={{ color: "#71717a" }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = "#ffffff";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = "#71717a";
          }}
        >
          <Headset size={18} strokeWidth={1.75} />
        </button>

        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <button
            type="button"
            onClick={() => setSubmitConfirm(true)}
            className="ic-btn"
            title="Submit & exit contest"
            aria-label="Submit and exit contest"
            style={{ color: "#71717a" }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "#ef4444";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "#71717a";
            }}
          >
            <LogOut size={18} strokeWidth={1.75} />
          </button>
          {submitConfirm && (
            <div
              role="dialog"
              aria-modal="false"
              aria-label="Confirm contest submission"
              style={{
                position: "absolute",
                top: "calc(100% + 8px)",
                right: 0,
                zIndex: "var(--modal-z-base)",
                width: "260px",
                padding: "12px",
                border: "1px solid rgba(239,68,68,0.45)",
                background: "#160b0b",
                boxShadow: "0 18px 44px rgba(0,0,0,0.35)",
              }}
            >
              <p
                style={{
                  margin: "0 0 10px",
                  color: "#fecaca",
                  fontSize: "12px",
                  lineHeight: 1.45,
                }}
              >
                Submit final answers and exit the contest? This cannot be undone.
              </p>
              {submitError && (
                <p
                  style={{
                    margin: "0 0 10px",
                    color: "#fca5a5",
                    fontSize: "11px",
                    lineHeight: 1.35,
                  }}
                >
                  {submitError}
                </p>
              )}
              <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => {
                    setSubmitConfirm(false);
                    setSubmitError(null);
                  }}
                  style={{
                    padding: "6px 10px",
                    border: "1px solid #334155",
                    background: "transparent",
                    color: "#cbd5e1",
                    cursor: "pointer",
                    fontSize: "11px",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSubmitConfirmed}
                  disabled={timeUpState === "submitting"}
                  style={{
                    padding: "6px 10px",
                    border: "1px solid #ef4444",
                    background: "rgba(239,68,68,0.16)",
                    color: "#fecaca",
                    cursor: timeUpState === "submitting" ? "not-allowed" : "pointer",
                    fontSize: "11px",
                    fontWeight: 700,
                  }}
                >
                  {timeUpState === "submitting" ? "Submitting…" : "Confirm"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
