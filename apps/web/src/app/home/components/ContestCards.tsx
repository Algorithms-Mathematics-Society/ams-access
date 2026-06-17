"use client";

import { useState, useEffect, useMemo, memo } from "react";
import { useRouter } from "next/navigation";
import { Clock3, ListChecks, Loader2, Play, ShieldCheck } from "lucide-react";
import {
  getThemeColors,
  getContestEntryState,
  getScheduledContestTickDelay,
  formatDurationUntil,
} from "./utils";
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
      return "rgb(var(--accent-rgb) / 0.7)";
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

    const cardHoverShadow = isLight ? "0 20px 40px rgba(124, 58, 237, 0.08)" : "var(--elevation-2)";
    const btnHoverShadow = isLight
      ? "0 8px 20px rgba(124, 58, 237, 0.2)"
      : "0 8px 24px rgb(var(--accent-rgb) / 0.3)";

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
          borderRadius: "var(--radius-md)",
          padding: "28px 32px",
          transition:
            "border-color var(--transition-slow), box-shadow var(--transition-slow), transform var(--transition-slow)",
          boxShadow: hovered ? cardHoverShadow : "var(--elevation-1)",
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
                ? "var(--color-accent-base)"
                : phase === "too_early"
                  ? "rgba(245,158,11,0.08)"
                  : "rgba(255,255,255,0.055)",
              color: canJoin
                ? "#ffffff"
                : phase === "too_early"
                  ? "#f59e0b"
                  : themeColors.textMuted,
              boxShadow: hovered && canJoin ? btnHoverShadow : "none",
              transition: "box-shadow var(--transition-slow)",
            }}
          >
            <ShieldCheck
              size={14}
              strokeWidth={1.9}
              style={{
                transition: "transform var(--transition-standard)",
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
    const [entering, setEntering] = useState(false);
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
            actionBg: "var(--color-accent-base)",
            actionBorder: "var(--color-accent-base)",
            actionText: "#ffffff",
          };
        case "live":
          return {
            rail: col.dot,
            statusColor: col.dot,
            statusBg: col.bg,
            statusBorder: col.border,
            actionBg: "var(--color-accent-base)",
            actionBorder: "var(--color-accent-base)",
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

    const formatClock = (iso: string) => {
      const ms = Date.parse(iso);
      if (Number.isNaN(ms)) return "";
      try {
        return new Intl.DateTimeFormat(undefined, {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: c.timezone || undefined,
        }).format(ms);
      } catch {
        return "";
      }
    };

    // The instrument — the single time-to-next-state readout that leads the card.
    const hero = (() => {
      const start = Date.parse(c.start_at);
      const end = Date.parse(c.end_at);
      if (entryState.phase === "live")
        return { label: "Time left", value: formatDurationUntil(end, now), big: true };
      if (entryState.phase === "too_early" || entryState.phase === "verification_open")
        return { label: "Starts in", value: formatDurationUntil(start, now), big: true };
      if (entryState.phase === "ended") {
        if (resultsUnlocked) return { label: "Results", value: "Ready", big: false };
        if (resultsLockedCountdown)
          return { label: "Results in", value: resultsLockedCountdown, big: true };
        return { label: "Status", value: "Ended", big: false };
      }
      return { label: "Status", value: entryState.statusLabel, big: false };
    })();

    const metaParts = [
      `${c.question_count} ${c.question_count === 1 ? "problem" : "problems"}`,
      formatClock(c.start_at) ? `${formatClock(c.start_at)}–${formatClock(c.end_at)}` : null,
      entryState.contestDateLabel && entryState.contestDateLabel !== "Date unavailable"
        ? entryState.contestDateLabel
        : null,
    ].filter(Boolean) as string[];

    const showHelper = ["blocked", "metadata_unavailable", "draft"].includes(entryState.phase);
    const resultsReady = entryState.phase === "ended" && resultsUnlocked;

    return (
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        style={{
          background: isLight
            ? "#ffffff"
            : hovered && canEnter
              ? "var(--surface-2)"
              : "var(--surface-1)",
          border: `1px solid ${
            hovered && canEnter ? "rgb(var(--accent-rgb) / 0.35)" : themeColors.border
          }`,
          borderLeft: `2px solid ${entryTone.rail}`,
          borderRadius: "var(--radius-lg)",
          padding: "22px 24px",
          transition: "background var(--transition-fast), border-color var(--transition-fast)",
          boxShadow: "var(--elevation-1)",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
          position: "relative",
          overflow: "hidden",
          opacity:
            entryState.phase === "ended" || entryState.phase === "metadata_unavailable" ? 0.6 : 1,
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
                  fontWeight: 600,
                  color: themeColors.text,
                  letterSpacing: "-0.01em",
                  lineHeight: 1.3,
                  margin: 0,
                  fontFamily: "var(--font-sans), system-ui, sans-serif",
                  maxWidth: "100%",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {c.title}
              </h3>
              <p
                style={{
                  fontSize: "13px",
                  color: themeColors.textMuted,
                  fontWeight: 500,
                  margin: "4px 0 0",
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

        {/* The instrument — time-to-next-state, the readout the eye lands on first */}
        <div>
          <div
            style={{
              fontSize: "11px",
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase" as const,
              color: themeColors.textMuted,
              marginBottom: "6px",
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {hero.label}
          </div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontVariantNumeric: "tabular-nums",
              fontSize: hero.big ? "var(--text-xl)" : "19px",
              fontWeight: 600,
              letterSpacing: "-0.01em",
              lineHeight: hero.big ? 1.1 : 1.05,
              color: themeColors.text,
            }}
          >
            {hero.value}
          </div>
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
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {metaParts.join("  ·  ")}
            </span>
          </div>

          <Button
            type="button"
            onClick={() => {
              if (entering) return;
              if (resultsReady) {
                const email = localStorage.getItem(STORAGE_KEYS.USER_EMAIL) ?? "";
                router.push(
                  `/results?contestId=${encodeURIComponent(c.id)}&email=${encodeURIComponent(email)}`
                );
              } else if (canEnter) {
                setEntering(true);
                try {
                  onPreflight(c.id, entryState.sessionType);
                } finally {
                  // onPreflight is async-like (navigates away); reset only if still mounted.
                  // Use a short timeout so the spinner shows during navigation.
                  setTimeout(() => setEntering(false), 5000);
                }
              }
            }}
            disabled={(!canEnter && !resultsReady) || entering}
            theme={theme}
            variant={
              canEnter || resultsReady
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
              border: `1px solid ${btnHovered && canEnter ? "var(--color-accent-light)" : entryTone.actionBorder}`,
              background: btnHovered && canEnter ? "var(--color-accent-base)" : entryTone.actionBg,
              color: entryTone.actionText,
              transition: "background var(--transition-fast), border-color var(--transition-fast)",
              cursor: entering ? "wait" : undefined,
            }}
          >
            {entering ? (
              <Loader2
                size={14}
                strokeWidth={2}
                style={{
                  animation: "spin 600ms linear infinite",
                }}
              />
            ) : (
              canEnter && (
                <Play
                  size={14}
                  strokeWidth={2}
                  style={{
                    transition: "transform var(--transition-fast)",
                    transform: btnHovered ? "translateX(2px)" : "none",
                  }}
                />
              )
            )}
            {resultsReady ? "View results" : entryState.ctaLabel}
          </Button>
        </div>

        {showHelper && (
          <div
            style={{
              borderTop: `1px solid ${themeColors.border}`,
              paddingTop: "12px",
            }}
          >
            <span
              style={{
                color: entryTone.statusColor,
                fontSize: "12px",
                lineHeight: 1.45,
              }}
            >
              {entryState.actionHelper}
            </span>
          </div>
        )}

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
