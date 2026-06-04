"use client";

import { useState, useEffect, useMemo, memo, useRef } from "react";
import { getThemeColors, getContestEntryState, getScheduledContestTickDelay } from "./utils";
import type { InvitedContest } from "./types";

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
    const themeColors = useMemo(() => getThemeColors(theme), [theme]);
    const isLight = theme === "light";
    const cardRef = useRef<HTMLDivElement>(null);
    const joinBtnRef = useRef<HTMLButtonElement>(null);
    const joinIconRef = useRef<SVGSVGElement>(null);

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

    return (
      <div
        ref={cardRef}
        onMouseEnter={() => {
          const el = cardRef.current;
          if (!el) return;
          el.style.borderColor = themeColors.accent;
          el.style.boxShadow = isLight
            ? "0 20px 40px rgba(124, 58, 237, 0.08)"
            : "0 20px 48px rgba(168, 85, 247, 0.08)";
          el.style.transform = "translateY(-4px)";
          const btn = joinBtnRef.current;
          if (canJoin && btn) {
            btn.style.background = themeColors.accent;
            btn.style.color = "#ffffff";
            btn.style.boxShadow = isLight
              ? "0 8px 20px rgba(124, 58, 237, 0.2)"
              : "0 8px 24px rgba(168, 85, 247, 0.3)";
          }
          const icon = joinIconRef.current;
          if (icon) icon.style.transform = "scale(1.1) rotate(5deg)";
        }}
        onMouseLeave={() => {
          const el = cardRef.current;
          if (!el) return;
          el.style.borderColor = themeColors.borderStrong;
          el.style.boxShadow = themeColors.shadow;
          el.style.transform = "translateY(0)";
          const btn = joinBtnRef.current;
          if (btn) {
            btn.style.background = canJoin
              ? "#a855f7"
              : phase === "too_early"
                ? "rgba(245,158,11,0.08)"
                : "rgba(255,255,255,0.055)";
            btn.style.color = canJoin
              ? "#ffffff"
              : phase === "too_early"
                ? "#f59e0b"
                : themeColors.textMuted;
            btn.style.boxShadow = "none";
          }
          const icon = joinIconRef.current;
          if (icon) icon.style.transform = "none";
        }}
        style={{
          background: isLight
            ? "linear-gradient(135deg, #ffffff 0%, #FAF8F5 100%)"
            : "linear-gradient(135deg, #090d16 0%, #05070b 100%)",
          border: `1px solid ${themeColors.borderStrong}`,
          borderRadius: "8px",
          padding: "28px 32px",
          transition: "all 400ms cubic-bezier(0.16, 1, 0.3, 1)",
          boxShadow: themeColors.shadow,
          transform: "translateY(0)",
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
            <span
              style={{
                flexShrink: 0,
                fontSize: "10px",
                fontWeight: 600,
                color: themeColors.textMuted,
                letterSpacing: "0.08em",
                fontFamily: "'JetBrains Mono', monospace",
                padding: "3px 8px",
                borderRadius: "4px",
                border: `1px solid ${themeColors.border}`,
                background: "rgba(255,255,255,0.04)",
                textTransform: "uppercase" as const,
              }}
            >
              {entryState.statusLabel}
            </span>
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
              <svg
                width="13"
                height="13"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <circle cx="8" cy="8" r="6" />
                <path d="M8 3.5v5h4" />
              </svg>
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
              <svg
                width="13"
                height="13"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M3 5h10M3 8h10M3 11h7" strokeLinecap="round" />
              </svg>
              <span>{c.question_count} Questions</span>
            </div>
          </div>

          <button
            ref={joinBtnRef}
            onClick={() => {
              if (canJoin) onPreflight(c.id, joinType);
            }}
            disabled={!canJoin}
            title={entryState.disabledTitle}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "12px 28px",
              borderRadius: "8px",
              border: `1px solid ${canJoin ? themeColors.accent : "rgba(245,158,11,0.35)"}`,
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
              fontSize: "14px",
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: canJoin ? "pointer" : "not-allowed",
              letterSpacing: "0.02em",
              whiteSpace: "nowrap",
              transition: "all 300ms cubic-bezier(0.16, 1, 0.3, 1)",
              boxShadow: "none",
            }}
          >
            <svg
              ref={joinIconRef}
              width="14"
              height="14"
              viewBox="0 0 12 12"
              fill="none"
              style={{
                transform: "none",
                transition: "transform 300ms ease",
              }}
            >
              <path
                d="M6 1L2 3.5v3c0 2.5 2 4.5 4 5 2-.5 4-2.5 4-5v-3L6 1z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
            <span>{label}</span>
          </button>
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
  }: {
    c: InvitedContest;
    onPreflight: (contestId: string, type: "new" | "resume") => void;
    theme: "dark" | "light";
    col: { dot: string; bg: string; border: string };
  }) {
    const [now, setNow] = useState(() => Date.now());
    const themeColors = useMemo(() => getThemeColors(theme), [theme]);
    const isLight = theme === "light";
    const cardRef = useRef<HTMLDivElement>(null);
    const entryState = useMemo(() => getContestEntryState(c, now), [c, now]);
    const canEnter = entryState.canEnter;

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

    return (
      <div
        ref={cardRef}
        onMouseEnter={() => {
          if (!canEnter || !cardRef.current) return;
          cardRef.current.style.borderColor = themeColors.accent;
          cardRef.current.style.boxShadow = isLight
            ? "0 20px 40px rgba(124, 58, 237, 0.08)"
            : "0 20px 48px rgba(168, 85, 247, 0.08)";
          cardRef.current.style.transform = "translateY(-4px)";
        }}
        onMouseLeave={() => {
          if (!cardRef.current) return;
          cardRef.current.style.borderColor = canEnter
            ? themeColors.borderStrong
            : themeColors.border;
          cardRef.current.style.boxShadow = themeColors.shadow;
          cardRef.current.style.transform = "translateY(0)";
        }}
        style={{
          background: isLight
            ? "linear-gradient(135deg, #ffffff 0%, #FAF8F5 100%)"
            : "linear-gradient(135deg, #090d16 0%, #05070b 100%)",
          border: `1px solid ${canEnter ? themeColors.borderStrong : themeColors.border}`,
          borderRadius: "8px",
          padding: "28px 32px",
          transition: "all 400ms cubic-bezier(0.16, 1, 0.3, 1)",
          boxShadow: themeColors.shadow,
          transform: "translateY(0)",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
          position: "relative",
          overflow: "hidden",
          opacity: canEnter ? 1 : 0.75,
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
            <span
              style={{
                flexShrink: 0,
                fontSize: "10px",
                fontWeight: 600,
                color: col.dot,
                letterSpacing: "0.08em",
                fontFamily: "'JetBrains Mono', monospace",
                padding: "3px 8px",
                borderRadius: "4px",
                border: `1px solid ${col.border}`,
                background: col.bg,
                textTransform: "uppercase" as const,
              }}
            >
              {entryState.statusLabel}
            </span>
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
                {new Date(c.start_at).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                —{" "}
                {new Date(c.end_at).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                ,{" "}
                {new Date(c.start_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </div>

            {entryState.phase !== "draft" && (
              <>
                <div
                  style={{
                    width: "4px",
                    height: "4px",
                    borderRadius: "50%",
                    background: themeColors.borderStrong,
                  }}
                />

                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <div
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: col.dot,
                      boxShadow: canEnter ? `0 0 8px ${col.dot}` : "none",
                      animation: canEnter ? "pulse-dot 1.5s ease-in-out infinite" : "none",
                    }}
                  />
                  <span style={{ color: canEnter ? "#10b981" : themeColors.textMuted }}>
                    {entryState.timingLabel}
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
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path d="M3 5h10M3 8h10M3 11h7" strokeLinecap="round" />
                  </svg>
                  <span>{c.question_count} Questions</span>
                </div>
              </>
            )}
          </div>

          {canEnter ? (
            <button
              onClick={() => onPreflight(c.id, entryState.sessionType)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "12px 24px",
                borderRadius: "8px",
                border: "1px solid #a855f7",
                background: "#a855f7",
                color: "#22c55e",
                fontSize: "13px",
                fontWeight: 600,
                fontFamily: "inherit",
                cursor: "pointer",
                letterSpacing: "0.02em",
                whiteSpace: "nowrap",
                transition: "all 200ms ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(34,197,94,0.16)";
                e.currentTarget.style.borderColor = "#c084fc";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#a855f7";
                e.currentTarget.style.borderColor = "#a855f7";
              }}
            >
              <span>{entryState.ctaLabel}</span>
            </button>
          ) : (
            <span
              style={{
                fontSize: "10px",
                fontWeight: 600,
                color: themeColors.textMuted,
                fontFamily: "'JetBrains Mono', monospace",
                padding: "3px 8px",
                borderRadius: "4px",
                border: `1px solid ${themeColors.border}`,
                background: "rgba(255,255,255,0.03)",
                textTransform: "uppercase" as const,
                letterSpacing: "0.08em",
              }}
            >
              {entryState.statusLabel}
            </span>
          )}
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.c === next.c &&
    prev.theme === next.theme &&
    prev.col.dot === next.col.dot &&
    prev.col.bg === next.col.bg &&
    prev.col.border === next.col.border &&
    prev.onPreflight === next.onPreflight
);
