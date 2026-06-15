"use client";

import { useState, useEffect, useMemo, memo } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Clock3, ListChecks, Play, ShieldCheck } from "lucide-react";
import { getThemeColors, getContestEntryState, getScheduledContestTickDelay } from "./utils";
import { Button, ContestStatePill } from "./ui-primitives";
import { STORAGE_KEYS } from "@/constants/storage-keys";
import type {
  InvitedContest,
  ContestantReadinessContext,
  ContestantReadinessStatus,
} from "./types";

function readinessStatusColor(status: ContestantReadinessStatus): string {
  switch (status) {
    case "ready":
      return "#4ade80";
    case "needs_action":
      return "#fca5a5";
    case "advisory_warning":
      return "#fcd34d";
    case "blocked_by_policy":
      return "#fca5a5";
    default:
      return "rgba(168,85,247,0.7)";
  }
}

export const ScheduledContestCard = memo(
  function ScheduledContestCard({
    c,
    onPreflight,
    theme,
  }: {
    c: InvitedContest;
    onPreflight: (contestId: string, type: "new" | "resume") => void;
    theme: "dark" | "light";
  }) {
    const [now, setNow] = useState(() => Date.now());
    const [hovered, setHovered] = useState(false);
    const themeColors = useMemo(() => getThemeColors(theme), [theme]);
    const isLight = theme === "light";

    useEffect(() => {
      let active = true;
      let timerId: ReturnType<typeof setTimeout> | null = null;

      const scheduleNextTick = () => {
        const current = Date.now();
        timerId = setTimeout(
          () => {
            if (!active) return;
            setNow(Date.now());
            scheduleNextTick();
          },
          getScheduledContestTickDelay(c, current)
        );
      };

      setNow(Date.now());
      scheduleNextTick();

      return () => {
        active = false;
        if (timerId) clearTimeout(timerId);
      };
    }, [c]);

    const entryState = useMemo(() => getContestEntryState(c, now), [c, now]);
    const phase = entryState.phase;
    const canJoin = entryState.canEnter;
    const joinType = entryState.sessionType;
    const label = entryState.ctaLabel;

    const cardHoverShadow = isLight
      ? "0 20px 40px rgba(124, 58, 237, 0.08)"
      : "0 20px 48px rgba(168, 85, 247, 0.08)";
    const btnHoverShadow = isLight
      ? "0 8px 20px rgba(124, 58, 237, 0.2)"
      : "0 8px 24px rgba(168, 85, 247, 0.3)";

    return (
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        style={{
          background: isLight
            ? "linear-gradient(135deg, #ffffff 0%, #FAF8F5 100%)"
            : "linear-gradient(135deg, #090d16 0%, #05070b 100%)",
          border: `1px solid ${hovered ? themeColors.accent : themeColors.borderStrong}`,
          borderRadius: "8px",
          padding: "28px 32px",
          transition:
            "border-color 400ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 400ms cubic-bezier(0.16, 1, 0.3, 1), transform 400ms cubic-bezier(0.16, 1, 0.3, 1)",
          boxShadow: hovered ? cardHoverShadow : themeColors.shadow,
          transform: hovered ? "translateY(-4px)" : "translateY(0)",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "16px",
              marginBottom: "8px",
            }}
          >
            <h3
              style={{
                fontSize: "19px",
                fontWeight: 700,
                color: themeColors.text,
                letterSpacing: "-0.02em",
                lineHeight: 1.2,
                margin: 0,
                fontFamily: "var(--font-mono), monospace",
              }}
            >
              {c.title}
            </h3>
            <ContestStatePill phase={phase} theme={theme}>
              {entryState.statusLabel}
            </ContestStatePill>
          </div>
          <p
            style={{
              fontSize: "14px",
              color: themeColors.textMuted,
              fontWeight: 500,
              margin: 0,
            }}
          >
            {c.org_name}
          </p>
        </div>

        {c.description && (
          <p
            style={{
              fontSize: "14px",
              color: themeColors.textMutedStrong,
              lineHeight: 1.6,
              margin: 0,
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {c.description}
          </p>
        )}

        <div style={{ height: "1px", background: themeColors.border, margin: "4px 0 0 0" }} />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "24px",
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "20px",
              fontSize: "12px",
              color: themeColors.textMutedStrong,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span>
                {new Date(c.start_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}{" "}
                —{" "}
                {new Date(c.end_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </div>

            <div
              style={{
                width: "4px",
                height: "4px",
                borderRadius: "50%",
                background: themeColors.borderStrong,
              }}
            />

            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <Clock3 size={13} strokeWidth={1.8} />
              <span style={{ color: themeColors.accent }}>{entryState.timingLabel}</span>
            </div>

            <div
              style={{
                width: "4px",
                height: "4px",
                borderRadius: "50%",
                background: themeColors.borderStrong,
              }}
            />

            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <ListChecks size={13} strokeWidth={1.8} />
              <span>{c.question_count} Questions</span>
            </div>
          </div>

          <Button
            onClick={() => {
              if (canJoin) onPreflight(c.id, joinType);
            }}
            disabled={!canJoin}
            title={entryState.disabledTitle}
            theme={theme}
            variant={canJoin ? "primary" : phase === "too_early" ? "secondary" : "ghost"}
            style={{
              border: `1px solid ${
                canJoin
                  ? themeColors.accent
                  : phase === "too_early"
                    ? "rgba(245,158,11,0.35)"
                    : phase === "blocked" || phase === "metadata_unavailable"
                      ? "rgba(239,68,68,0.28)"
                      : themeColors.border
              }`,
              background: canJoin
                ? "#a855f7"
                : phase === "too_early"
                  ? "rgba(245,158,11,0.08)"
                  : "rgba(255,255,255,0.055)",
              color: canJoin
                ? "#ffffff"
                : phase === "too_early"
                  ? "#f59e0b"
                  : themeColors.textMuted,
              boxShadow: hovered && canJoin ? btnHoverShadow : "none",
              transition: "box-shadow 400ms cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            <ShieldCheck
              size={14}
              strokeWidth={1.9}
              style={{
                transition: "transform 300ms cubic-bezier(0.16, 1, 0.3, 1)",
                transform: hovered && canJoin ? "translateX(2px)" : "none",
              }}
            />
            <span>{label}</span>
          </Button>
        </div>
        <div style={{ marginTop: "4px", fontSize: "11px", color: themeColors.textMuted }}>
          Timezone: {c.timezone || "UTC"}
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.c === next.c && prev.theme === next.theme && prev.onPreflight === next.onPreflight
);

export const ActiveContestCard = memo(
  function ActiveContestCard({
    c,
    onPreflight,
    theme,
    col,
    readinessContext,
  }: {
    c: InvitedContest;
    onPreflight: (contestId: string, type: "new" | "resume") => void;
    theme: "dark" | "light";
    col: { dot: string; bg: string; border: string };
    readinessContext?: ContestantReadinessContext;
  }) {
    const router = useRouter();
    const [now, setNow] = useState(() => Date.now());
    const [hovered, setHovered] = useState(false);
    const [btnHovered, setBtnHovered] = useState(false);
    const themeColors = useMemo(() => getThemeColors(theme), [theme]);
    const isLight = theme === "light";
    const entryState = useMemo(() => getContestEntryState(c, now), [c, now]);
    const canEnter = entryState.canEnter;

    // Results visibility for ended contests.
    const resultsVisibleAt = c.results_visible_at ? new Date(c.results_visible_at).getTime() : null;
    const resultsUnlocked = resultsVisibleAt !== null && now >= resultsVisibleAt;
    const resultsLockedCountdown = useMemo(() => {
      if (!resultsVisibleAt || resultsUnlocked) return null;
      const diff = resultsVisibleAt - now;
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      return h > 0 ? `${h}h ${m}m` : `${m}m`;
    }, [resultsVisibleAt, resultsUnlocked, now]);

    useEffect(() => {
      let active = true;
      let timerId: ReturnType<typeof setTimeout> | null = null;

      const scheduleNextTick = () => {
        const current = Date.now();
        timerId = setTimeout(
          () => {
            if (!active) return;
            setNow(Date.now());
            scheduleNextTick();
          },
          getScheduledContestTickDelay(c, current)
        );
      };

      setNow(Date.now());
      scheduleNextTick();

      return () => {
        active = false;
        if (timerId) clearTimeout(timerId);
      };
    }, [c]);

    const entryTone = useMemo(() => {
      switch (entryState.phase) {
        case "too_early":
          return {
            rail: "#f59e0b",
            statusColor: "#f59e0b",
            statusBg: "rgba(245,158,11,0.08)",
            statusBorder: "rgba(245,158,11,0.24)",
            actionBg: "rgba(245,158,11,0.08)",
            actionBorder: "rgba(245,158,11,0.35)",
            actionText: "#f59e0b",
          };
        case "verification_open":
          return {
            rail: themeColors.accent,
            statusColor: themeColors.accentText,
            statusBg: themeColors.accentLight,
            statusBorder: themeColors.accentBorder,
            actionBg: "#a855f7",
            actionBorder: "#a855f7",
            actionText: "#ffffff",
          };
        case "live":
          return {
            rail: col.dot,
            statusColor: col.dot,
            statusBg: col.bg,
            statusBorder: col.border,
            actionBg: "#a855f7",
            actionBorder: "#a855f7",
            actionText: "#ffffff",
          };
        case "ended":
          return {
            rail: "rgba(255,255,255,0.24)",
            statusColor: themeColors.textMuted,
            statusBg: "rgba(255,255,255,0.035)",
            statusBorder: themeColors.border,
            actionBg: "rgba(255,255,255,0.04)",
            actionBorder: themeColors.border,
            actionText: themeColors.textMuted,
          };
        case "metadata_unavailable":
        case "blocked":
          return {
            rail: "#ef4444",
            statusColor: "#fca5a5",
            statusBg: "rgba(239,68,68,0.08)",
            statusBorder: "rgba(239,68,68,0.24)",
            actionBg: "rgba(239,68,68,0.08)",
            actionBorder: "rgba(239,68,68,0.28)",
            actionText: "#fca5a5",
          };
        default:
          return {
            rail: themeColors.textMuted,
            statusColor: themeColors.textMuted,
            statusBg: "rgba(255,255,255,0.035)",
            statusBorder: themeColors.border,
            actionBg: "rgba(255,255,255,0.04)",
            actionBorder: themeColors.border,
            actionText: themeColors.textMuted,
          };
      }
    }, [col.bg, col.border, col.dot, entryState.phase, themeColors]);

    const cardHoverShadow = isLight
      ? "0 20px 40px rgba(124, 58, 237, 0.08)"
      : "0 20px 48px rgba(168, 85, 247, 0.08)";

    const timingRows = [
      { label: "Verification opens", value: entryState.verificationOpensAt },
      { label: "Contest starts", value: entryState.contestStartsAt },
      { label: "Contest ends", value: entryState.contestEndsAt },
    ];

    return (
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        style={{
          background: isLight
            ? "linear-gradient(135deg, #ffffff 0%, #FAF8F5 100%)"
            : "linear-gradient(135deg, #090d16 0%, #05070b 100%)",
          border: `1px solid ${hovered && canEnter ? themeColors.accent : canEnter ? themeColors.borderStrong : themeColors.border}`,
          borderLeft: `3px solid ${entryTone.rail}`,
          borderRadius: "8px",
          padding: "26px 30px",
          transition:
            "border-color 400ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 400ms cubic-bezier(0.16, 1, 0.3, 1), transform 400ms cubic-bezier(0.16, 1, 0.3, 1)",
          boxShadow: hovered && canEnter ? cardHoverShadow : themeColors.shadow,
          transform: hovered && canEnter ? "translateY(-4px)" : "translateY(0)",
          display: "flex",
          flexDirection: "column",
          gap: "18px",
          position: "relative",
          overflow: "hidden",
          opacity:
            entryState.phase === "ended" || entryState.phase === "metadata_unavailable" ? 0.82 : 1,
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: "16px",
              marginBottom: "8px",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <h3
                style={{
                  fontSize: "19px",
                  fontWeight: 700,
                  color: themeColors.text,
                  letterSpacing: "0",
                  lineHeight: 1.25,
                  margin: 0,
                  fontFamily: "var(--font-mono), monospace",
                }}
              >
                {c.title}
              </h3>
              <p
                style={{
                  fontSize: "14px",
                  color: themeColors.textMuted,
                  fontWeight: 500,
                  margin: "5px 0 0",
                }}
              >
                {c.org_name}
              </p>
            </div>
            <ContestStatePill phase={entryState.phase} theme={theme}>
              {entryState.statusLabel}
            </ContestStatePill>
          </div>
        </div>

        {c.description && (
          <p
            style={{
              fontSize: "14px",
              color: themeColors.textMutedStrong,
              lineHeight: 1.6,
              margin: 0,
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {c.description}
          </p>
        )}

        <div style={{ height: "1px", background: themeColors.border }} />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: "10px",
          }}
        >
          {timingRows.map((row) => (
            <div
              key={row.label}
              style={{
                border: `1px solid ${themeColors.border}`,
                borderRadius: "6px",
                background: "rgba(255,255,255,0.025)",
                padding: "10px 12px",
              }}
            >
              <div
                style={{
                  color: themeColors.textMuted,
                  fontSize: "10px",
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase" as const,
                  marginBottom: "5px",
                }}
              >
                {row.label}
              </div>
              <div
                style={{
                  color: themeColors.text,
                  fontSize: "13px",
                  fontWeight: 600,
                  fontFamily: "'JetBrains Mono', monospace",
                  lineHeight: 1.25,
                }}
              >
                {row.value}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "18px",
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "14px",
              flexWrap: "wrap",
              color: themeColors.textMutedStrong,
              fontSize: "12px",
            }}
          >
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <CalendarDays size={13} strokeWidth={1.8} />
              {entryState.contestDateLabel}
            </span>
            <span style={{ color: themeColors.borderStrong }}>•</span>
            <span>{c.question_count} Questions</span>
            <span style={{ color: themeColors.borderStrong }}>•</span>
            <span style={{ color: canEnter ? themeColors.accent : entryTone.statusColor }}>
              {entryState.timingLabel}
            </span>
          </div>

          <Button
            type="button"
            onClick={() => {
              if (canEnter) onPreflight(c.id, entryState.sessionType);
            }}
            disabled={!canEnter}
            theme={theme}
            variant={
              canEnter
                ? "primary"
                : entryState.phase === "blocked" || entryState.phase === "metadata_unavailable"
                  ? "danger"
                  : "secondary"
            }
            onMouseEnter={() => {
              if (canEnter) setBtnHovered(true);
            }}
            onMouseLeave={() => setBtnHovered(false)}
            onFocus={() => {
              if (canEnter) setBtnHovered(true);
            }}
            onBlur={() => setBtnHovered(false)}
            style={{
              border: `1px solid ${btnHovered && canEnter ? "#c084fc" : entryTone.actionBorder}`,
              background: btnHovered && canEnter ? "#9333ea" : entryTone.actionBg,
              color: entryTone.actionText,
              transition: "background 150ms ease, border-color 150ms ease",
            }}
          >
            {canEnter && <Play size={14} strokeWidth={2} />}
            {entryState.ctaLabel}
          </Button>
        </div>

        <div
          style={{
            borderTop: `1px solid ${themeColors.border}`,
            paddingTop: "12px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <div
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: entryTone.rail,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              color: canEnter ? themeColors.textMutedStrong : entryTone.statusColor,
              fontSize: "12px",
              lineHeight: 1.45,
            }}
          >
            {entryState.actionHelper}
          </span>
        </div>

        {readinessContext && readinessContext.status !== "checking" && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "7px",
              paddingTop: "12px",
              borderTop: `1px solid ${themeColors.border}`,
            }}
          >
            <div
              style={{
                width: "5px",
                height: "5px",
                borderRadius: "50%",
                background: readinessStatusColor(readinessContext.status),
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: "11px",
                color: readinessStatusColor(readinessContext.status),
                lineHeight: 1.4,
              }}
            >
              {readinessContext.message}
            </span>
          </div>
        )}

        {/* Results availability row for ended contests */}
        {entryState.phase === "ended" && resultsVisibleAt !== null && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
              paddingTop: "12px",
              borderTop: `1px solid ${themeColors.border}`,
            }}
          >
            <span style={{ fontSize: "12px", color: themeColors.textMuted }}>
              {resultsUnlocked ? "Results available" : `Results in ${resultsLockedCountdown}`}
            </span>
            {resultsUnlocked && (
              <button
                onClick={() => {
                  const email = localStorage.getItem(STORAGE_KEYS.USER_EMAIL) ?? "";
                  router.push(
                    `/results?contestId=${encodeURIComponent(c.id)}&email=${encodeURIComponent(email)}`
                  );
                }}
                style={{
                  padding: "5px 14px",
                  fontSize: "12px",
                  fontWeight: 600,
                  background: "rgba(168,85,247,0.12)",
                  border: "1px solid rgba(168,85,247,0.3)",
                  borderRadius: "5px",
                  color: "#c084fc",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                View Results
              </button>
            )}
          </div>
        )}
      </div>
    );
  },
  (prev, next) =>
    prev.c === next.c &&
    prev.theme === next.theme &&
    prev.col.dot === next.col.dot &&
    prev.col.bg === next.col.bg &&
    prev.col.border === next.col.border &&
    prev.onPreflight === next.onPreflight &&
    prev.readinessContext?.status === next.readinessContext?.status &&
    prev.readinessContext?.message === next.readinessContext?.message
);
