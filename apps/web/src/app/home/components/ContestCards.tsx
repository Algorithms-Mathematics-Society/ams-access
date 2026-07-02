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

    const cardHoverShadow = "var(--home-shadow-card)";
    const btnHoverShadow = "var(--home-shadow-cta)";

    return (
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        style={{
          background: "var(--home-activecard-bg)",
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
                    ? "var(--home-status-warn-border-35)"
                    : phase === "blocked" || phase === "metadata_unavailable"
                      ? "var(--home-status-error-border-28)"
                      : themeColors.border
              }`,
              background: canJoin
                ? "var(--color-accent-base)"
                : phase === "too_early"
                  ? "var(--home-status-warn-bg)"
                  : "rgba(255,255,255,0.055)",
              color: canJoin
                ? "#ffffff"
                : phase === "too_early"
                  ? "var(--home-status-warn)"
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
          Times shown in your local timezone
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
            rail: "var(--home-status-warn-dot)",
            statusColor: "var(--home-status-warn)",
            statusBg: "var(--home-status-warn-bg)",
            statusBorder: "var(--home-status-warn-border-24)",
            actionBg: "var(--home-status-warn-bg)",
            actionBorder: "var(--home-status-warn-border-35)",
            actionText: "var(--home-status-warn)",
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
            rail: "var(--home-status-error-dot)",
            statusColor: "var(--theme-error-text)",
            statusBg: "var(--home-status-error-bg)",
            statusBorder: "var(--home-status-error-border-24)",
            actionBg: "var(--home-status-error-bg)",
            actionBorder: "var(--home-status-error-border-28)",
            actionText: "var(--theme-error-text)",
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

    // The time-to-next-state readout used by the meta line.
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

    // Date string for the meta line (e.g. "1 June, 2026").
    const cardDate = (() => {
      const ms = Date.parse(c.start_at);
      if (Number.isNaN(ms)) return entryState.contestDateLabel;
      try {
        return new Intl.DateTimeFormat(undefined, {
          day: "numeric",
          month: "long",
          year: "numeric",
        }).format(ms);
      } catch {
        return entryState.contestDateLabel;
      }
    })();

    // Human-readable status for the single meta line.
    const metaStatus = (() => {
      if (entryState.phase === "ended") {
        if (resultsUnlocked) return "Results Ready";
        if (resultsLockedCountdown) return `Results in ${resultsLockedCountdown}`;
        return "Session Ended";
      }
      if (entryState.phase === "live") return `${hero.value} left`;
      if (entryState.phase === "too_early" || entryState.phase === "verification_open")
        return `Starts in ${hero.value}`;
      return entryState.timingLabel;
    })();

    const showHelper = ["blocked", "metadata_unavailable", "draft"].includes(entryState.phase);
    const resultsReady = entryState.phase === "ended" && resultsUnlocked;

    return (
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        style={{
          background: hovered && canEnter ? "var(--surface-2)" : "var(--surface-1)",
          border: `1px solid ${
            hovered && canEnter ? "rgb(var(--accent-rgb) / 0.25)" : themeColors.border
          }`,
          borderRadius: "var(--radius-md)",
          padding: "16px 20px",
          transition: "background var(--transition-fast), border-color var(--transition-fast)",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
        }}
      >
        {/* Header row: title + status chip */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "12px",
          }}
        >
          <h3
            style={{
              fontSize: "16px",
              fontWeight: 600,
              color: themeColors.text,
              letterSpacing: "-0.01em",
              lineHeight: 1.3,
              margin: 0,
              fontFamily: "var(--font-sans), system-ui, sans-serif",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {c.title}
          </h3>
          <ContestStatePill phase={entryState.phase} theme={theme}>
            {entryState.statusLabel}
          </ContestStatePill>
        </div>

        {/* Single muted meta line: date · status · N Questions */}
        <p
          style={{
            fontSize: "12px",
            color: themeColors.textMuted,
            margin: 0,
            fontFamily: "'JetBrains Mono', monospace",
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1.4,
          }}
        >
          {cardDate} · {metaStatus} · {c.question_count}{" "}
          {c.question_count === 1 ? "Question" : "Questions"}
        </p>

        {/* Action row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: "10px",
            marginTop: "2px",
          }}
        >
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
            size="small"
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
                size={13}
                strokeWidth={2}
                style={{ animation: "spin 600ms linear infinite" }}
              />
            ) : (
              canEnter && (
                <Play
                  size={13}
                  strokeWidth={2}
                  style={{
                    transition: "transform var(--transition-fast)",
                    transform: btnHovered ? "translateX(2px)" : "none",
                  }}
                />
              )
            )}
            {entryState.phase === "ended" ? "View Results" : entryState.ctaLabel}
          </Button>
        </div>

        {/* Gating helper for blocked / metadata_unavailable / draft */}
        {showHelper && (
          <div
            style={{
              borderTop: `1px solid ${themeColors.border}`,
              paddingTop: "10px",
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

        {/* Readiness context — "fix N checks before entering" gating hint */}
        {readinessContext && readinessContext.status !== "checking" && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "7px",
              paddingTop: "10px",
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
