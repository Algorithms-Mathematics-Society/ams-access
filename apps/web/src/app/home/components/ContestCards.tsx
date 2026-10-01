"use client";

import { useState, useEffect, useMemo, memo } from "react";
import { useRouter } from "next/navigation";
import { Clock3, ListChecks, Loader2, ShieldCheck } from "lucide-react";
import {
  getThemeColors,
  getContestEntryState,
  getScheduledContestTickDelay,
  formatDurationUntil,
} from "./utils";
import { Button, ContestStatePill } from "./ui-primitives";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Button as AstryxButton } from "@astryxdesign/core/Button";
import { Token } from "@astryxdesign/core/Token";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import type { InvitedContest, ContestantReadinessContext } from "./types";
import { ContestBriefing } from "./ContestBriefing";

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
                  : "var(--home-overlay-disabled)",
              color: canJoin
                ? "var(--color-on-accent)"
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
    isHighlighted = false,
  }: {
    c: InvitedContest;
    onPreflight: (contestId: string, type: "new" | "resume") => void;
    theme: "dark" | "light";
    col: { dot: string; bg: string; border: string };
    readinessContext?: ContestantReadinessContext;
    isHighlighted?: boolean;
  }) {
    const router = useRouter();
    const [now, setNow] = useState(() => Date.now());
    const [entering, setEntering] = useState(false);
    const entryState = useMemo(() => getContestEntryState(c, now), [c, now]);
    const canEnter = entryState.canEnter;

    // Preserve organizer-facing release timing on Home. The results page
    // continues to use the existing own-submissions endpoint and access paths.
    const resultsVisibleAt = c.results_visible_at ? new Date(c.results_visible_at).getTime() : null;
    const resultsUnlocked = resultsVisibleAt !== null && now >= resultsVisibleAt;
    const resultsReady = entryState.phase === "ended" && resultsUnlocked;
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

    // The time-to-next-state readout used by the meta line.
    const hero = (() => {
      const start = Date.parse(c.start_at);
      const end = Date.parse(c.end_at);
      if (entryState.phase === "live")
        return { label: "Time left", value: formatDurationUntil(end, now), big: true };
      if (entryState.phase === "too_early" || entryState.phase === "verification_open")
        return { label: "Starts in", value: formatDurationUntil(start, now), big: true };
      if (entryState.phase === "ended") return { label: "Status", value: "Ended", big: false };
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
        if (resultsUnlocked) return "Your recorded attempts are available";
        if (resultsLockedCountdown) return `Results available in ${resultsLockedCountdown}`;
        return "Contest ended · results release time not announced";
      }
      if (entryState.phase === "live") return `${hero.value} left`;
      if (entryState.phase === "too_early" || entryState.phase === "verification_open")
        return `Starts in ${hero.value}`;
      return entryState.timingLabel;
    })();

    const showHelper = ["blocked", "metadata_unavailable", "draft"].includes(entryState.phase);

    const statusColor =
      entryState.phase === "live" && !c.is_practice
        ? "green"
        : entryState.phase === "blocked" || entryState.phase === "metadata_unavailable"
          ? "red"
          : entryState.phase === "too_early"
            ? "yellow"
            : "gray";

    return (
      <VStack
        as="li"
        data-dashboard-contest
        id={`home-contest-${encodeURIComponent(c.id)}`}
        tabIndex={-1}
        aria-label={c.title}
        data-highlighted={isHighlighted || undefined}
        gap={5}
        padding={5}
        style={{
          minWidth: 0,
          scrollMarginBlock: "var(--spacing-6)",
          backgroundColor: isHighlighted ? "var(--color-accent-muted)" : undefined,
          outlineOffset: "calc(var(--spacing-1) * -1)",
          containerType: "inline-size",
        }}
      >
        <VStack gap={3} style={{ minWidth: 0 }}>
          <HStack gap={3} wrap="wrap" align="center">
            <Token label={entryState.phase === "draft" ? "Not published yet" : entryState.statusLabel} color={statusColor} size="sm" />
            {c.org_name && (
              <Text type="supporting" maxLines={1} style={{ minWidth: 0, maxWidth: "100%" }}>
                {c.org_name}
              </Text>
            )}
          </HStack>
          <Heading level={2} accessibilityLevel={3} maxLines={2} wordBreak="break-word">
            {c.title}
          </Heading>
          {c.description && <Text color="secondary" maxLines={2}>{c.description}</Text>}
        </VStack>
        <MetadataList columns={c.is_practice ? 2 : 3} label={{ position: "top" }} className="dashboard-contest-metadata">
          <MetadataListItem label={c.is_practice ? "Format" : "Date"}>
            <Text hasTabularNumbers>{c.is_practice ? "Practice · untimed" : cardDate}</Text>
          </MetadataListItem>
          {!c.is_practice && <MetadataListItem label="Starts">
            <Text hasTabularNumbers>{entryState.contestStartsAt}</Text>
          </MetadataListItem>}
          <MetadataListItem label="Questions">
            <Text hasTabularNumbers>{c.question_count} {c.question_count === 1 ? "question" : "questions"}</Text>
          </MetadataListItem>
        </MetadataList>
        <ContestBriefing contest={c} entryState={entryState} />
        <HStack gap={4} justify="between" align="center" wrap="wrap" style={{
          borderTop: "var(--border-width) solid var(--color-border)", paddingTop: "var(--spacing-4)",
        }}>
          <Text type="supporting" style={{ flex: "1 1 calc(var(--spacing-10) * 3)", minWidth: 0 }}>
            {showHelper ? entryState.actionHelper : c.is_practice ? "Practice at your own pace." : metaStatus}
          </Text>
            <AstryxButton
              onClick={() => {
                if (entering) return;
                if (resultsReady) {
                  // No identity in the URL. Results are own-only and the
                  // participant token says whose they are; an `?email=` param
                  // was both redundant and an invitation to change it.
                  router.push(`/results?contestId=${encodeURIComponent(c.id)}`);
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
              label={
                entering
                  ? "Opening..."
                  : entryState.phase === "ended"
                    ? "View my submissions"
                    : entryState.phase === "draft"
                      ? "Not published yet"
                      : entryState.ctaLabel
              }
              isDisabled={(!canEnter && !resultsReady) || entering}
              isLoading={entering}
              variant={canEnter || resultsReady ? "primary" : "secondary"}
              tooltip={!canEnter && !resultsReady ? (entryState.phase === "ended" ? metaStatus : entryState.phase === "draft" ? "This contest is not published yet" : entryState.disabledTitle) : undefined}
            />
        </HStack>
      </VStack>
    );
  },
  (prev, next) =>
    prev.c === next.c &&
    prev.theme === next.theme &&
    prev.isHighlighted === next.isHighlighted &&
    prev.col.dot === next.col.dot &&
    prev.col.bg === next.col.bg &&
    prev.col.border === next.col.border &&
    prev.onPreflight === next.onPreflight &&
    prev.readinessContext?.status === next.readinessContext?.status &&
    prev.readinessContext?.message === next.readinessContext?.message
);
