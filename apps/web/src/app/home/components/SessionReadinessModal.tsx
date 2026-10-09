"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getContest } from "@/lib/proctor-api";
import { decideEntry, shouldRunChecks, blockedMessage } from "@/app/session/onboarding/entry-gate";
import { invoke } from "@ams/api-client";
import { getThemeColors, toPreflightPolicyItem, calculateReadinessScore } from "./utils";
import { deriveContestantReadiness } from "./readiness-context";
import { Button } from "./ui-primitives";
import { Grid } from "@astryxdesign/core/Grid";
import { Spinner } from "@astryxdesign/core/Spinner";
import { AccessDialog } from "@/components/AccessDialog";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { parseLogLine } from "./SecurityOperationsLog";
import { HelpRequestModal } from "@/components/HelpRequestModal";
import type { ReadinessState, ReadinessStatus } from "./types";
import { hasNativeBridge } from "./readiness-status";
import type { ReadinessReport } from "@ams/api-client";

// Visible text supplements the status dot for every required and advisory check.
function PreflightCheckItem({
  label,
  status,
  successLabel,
  failLabel,
  variant = "required",
}: {
  label: string;
  status: ReadinessStatus;
  successLabel: string;
  failLabel: string;
  theme: "dark" | "light";
  variant?: "required" | "optional";
}) {
  // Same correction as ReadinessItem: "Checking..." means the scan is still
  // running, and nothing else. A check that failed advisorily, or that this
  // machine cannot run at all, says which — the modal used to show both as
  // though they were still in progress.
  const stateLabel =
    status === "ok"
      ? successLabel
      : status === "fail" || status === "warn"
        ? failLabel
        : status === "unavailable"
          ? "Unavailable on this device"
          : "Checking...";
  return (
    <HStack
      justify="between"
      align="center"
      gap={3}
      paddingBlock={3}
      style={{ borderBottom: "var(--border-width) solid var(--color-border)" }}
    >
      <VStack gap={1}>
        <Text>{label}</Text>
        <Text type="supporting">{stateLabel}</Text>
      </VStack>
      <StatusDot
        label={stateLabel}
        variant={
          status === "ok"
            ? "success"
            : status === "checking"
              ? "neutral"
              : variant === "optional"
                ? "warning"
                : "error"
        }
      />
    </HStack>
  );
}

interface SessionReadinessModalProps {
  contestId: string;
  sessionType: "new" | "resume";
  theme: "dark" | "light";
  onClose: () => void;
  onProceed?: () => Promise<void> | void;
  readiness: ReadinessState;
  readinessReport: ReadinessReport | null;
  onSettingsRedirect: () => void;
  onRescan: () => Promise<void>;
}

export function SessionReadinessModal({
  contestId,
  sessionType,
  theme,
  onClose,
  onProceed,
  readiness,
  readinessReport,
  onSettingsRedirect,
  onRescan,
}: SessionReadinessModalProps) {
  const router = useRouter();
  const c = getThemeColors(theme);
  const [isRescanning, setIsRescanning] = useState(false);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [entryWindow, setEntryWindow] = useState<{
    status: "checking" | "allowed" | "blocked";
    reason: string | null;
  }>({ status: "checking", reason: null });
  const [entryWindowRefreshIndex, setEntryWindowRefreshIndex] = useState(0);
  const activeReport = readinessReport?.contest_id === contestId ? readinessReport : null;
  const hasPendingChecks = Object.values(readiness).some((status) => status === "checking");
  const entryWindowChecking = entryWindow.status === "checking";
  const scanStatus: "scanning" | "done" =
    isRescanning || entryWindowChecking || (activeReport === null && hasPendingChecks)
      ? "scanning"
      : "done";

  useEffect(() => {
    let cancelled = false;
    setEntryWindow({ status: "checking", reason: null });
    // `GET /contests/{uid}/session-window` used to answer this. It is a v1
    // staff route, it was deleted in the v2 migration, and this screen kept
    // calling it — so every candidate got a 404, the catch below fired, and
    // the modal said "Unable to validate contest entry window" over a contest
    // the server was perfectly happy to admit them to. Onboarding was moved
    // onto the participant route; this one was missed.
    //
    // The decision is the server's `phase`, via the same `decideEntry` the
    // onboarding gate uses — one rule for whether a candidate may enter, not
    // two that can disagree.
    getContest(contestId)
      .then((index) => {
        if (cancelled) return;
        const decision = decideEntry(index, Date.parse(index.server_time) || Date.now());
        setEntryWindow(
          shouldRunChecks(decision)
            ? { status: "allowed", reason: null }
            : {
                status: "blocked",
                reason: blockedMessage(decision) ?? "Contest entry window is not open.",
              }
        );
      })
      .catch(() => {
        if (!cancelled) {
          setEntryWindow({
            status: "blocked",
            reason: "Unable to validate contest entry window.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [contestId, entryWindowRefreshIndex, sessionType]);

  const score = calculateReadinessScore(readiness);
  const requiredReportChecks = activeReport?.required_checks ?? [];
  const context = useMemo(
    () =>
      deriveContestantReadiness({
        readiness,
        report: activeReport,
        entryWindowStatus:
          entryWindow.status === "checking"
            ? "checking"
            : entryWindow.status === "allowed"
              ? "allowed"
              : "blocked",
        entryWindowReason: entryWindow.reason,
      }),
    [readiness, activeReport, entryWindow.status, entryWindow.reason]
  );

  const modalTitle =
    context.status === "checking"
      ? "Checking your device"
      : context.status === "ready"
        ? sessionType === "resume"
          ? "Ready to resume"
          : "Ready to enter"
        : context.status === "needs_action"
          ? `Fix ${context.failedRequired === 1 ? "1 required check" : `${context.failedRequired} required checks`}`
          : context.status === "advisory_warning"
            ? "Device ready — review advisory warnings"
            : "Contest window not open";

  const decisionTone =
    context.status === "ready" || context.status === "advisory_warning"
      ? { color: c.dot, bg: "var(--home-status-ok-bg)", border: "var(--home-status-ok-border-24)" }
      : context.status === "needs_action"
        ? {
            color: "var(--home-status-warn)",
            bg: "var(--home-status-warn-bg-09)",
            border: "var(--home-status-warn-border-28)",
          }
        : context.status === "blocked_by_policy"
          ? {
              color: "var(--theme-error-text)",
              bg: "var(--home-status-error-bg)",
              border: "var(--home-status-error-border-26)",
            }
          : { color: c.accentText, bg: c.accentLight, border: c.accentBorder };

  const requiredPolicyChecks = requiredReportChecks;
  const requiredChecksPassed =
    !!activeReport &&
    requiredPolicyChecks.every((check) => check.outcome === "pass" && !check.blocking);

  // Readiness is evaluated natively, so running the client in a browser
  // produces no report at all and entry could never be offered — which made
  // the contest room untestable outside a packaged build.
  //
  // This cannot fire in a shipped build: the Tauri shell always has the
  // bridge, so `unproctoredDevSession` is false there and entry depends on
  // the report exactly as before. It is also not a new hole — the contest
  // room already opens its lock gate in this situation, saying so in as many
  // words ("Tauri unavailable (dev/browser) — no real lockdown exists here"),
  // and the distributed artefact is the desktop app.
  //
  // It is deliberately loud. A session entered this way is unproctored, and
  // the modal says so rather than looking like a normal pass.
  const unproctoredDevSession = !hasNativeBridge();
  const policyAllowsProceed = unproctoredDevSession
    ? true
    : !!activeReport && activeReport.decision !== "blocked" && requiredChecksPassed;
  const entryWindowAllowed = entryWindow.status === "allowed";
  const canProceed = scanStatus === "done" && entryWindowAllowed && policyAllowsProceed;
  const primaryActionLabel = canProceed
    ? sessionType === "resume"
      ? "Resume contest"
      : "Enter contest"
    : scanStatus === "scanning"
      ? "Checking..."
      : context.status === "needs_action" || context.status === "advisory_warning"
        ? "Open settings"
        : "Back to contests";
  const requiredPreflightItems = activeReport
    ? activeReport.required_checks.map((check) => toPreflightPolicyItem(check, "required"))
    : [
        {
          key: "required-policy-pending",
          label: "Required checks",
          status: "checking" as ReadinessStatus,
          successLabel: "Policy ready",
          failLabel: "Policy pending",
        },
      ];
  const optionalPreflightItems = activeReport
    ? activeReport.optional_checks.map((check) => toPreflightPolicyItem(check, "optional"))
    : [];
  const optionalWarningCount = activeReport
    ? activeReport.optional_checks.filter((check) => check.outcome !== "pass").length
    : 0;

  // macOS permission gate: keyboard_lockdown is failing because the user
  // hasn't granted Accessibility (or, when the tap is refused, Input
  // Monitoring) permission. The detail string emitted by core-rs carries the
  // native method — both substrings are macOS-specific so no explicit platform
  // check is required. Searched in every check, not only required ones:
  // keyboard lockdown is optional on macOS.
  const keyboardPermissionMissing = useMemo(() => {
    if (!activeReport) return null;
    const kbCheck = activeReport.checks.find((check) => check.kind === "keyboard_lockdown");
    if (!kbCheck || kbCheck.outcome === "pass" || typeof kbCheck.detail !== "string") return null;
    if (kbCheck.detail.includes("accessibility_denied")) return "accessibility" as const;
    if (kbCheck.detail.includes("input_monitoring_denied")) return "input_monitoring" as const;
    return null;
  }, [activeReport]);
  const showAccessibilityRecovery = keyboardPermissionMissing !== null;
  const permissionPane =
    keyboardPermissionMissing === "input_monitoring" ? "Input Monitoring" : "Accessibility";

  const consoleLogs = useMemo(() => {
    if (scanStatus === "scanning") {
      return [
        entryWindowChecking
          ? "Validating the contest entry window..."
          : "Waiting for the readiness report...",
        "Checking your device from local device checks.",
      ];
    }

    if (entryWindow.status === "blocked") {
      return [
        `Contest window not open: ${entryWindow.reason ?? "unavailable"}`,
        "Entry decision: blocked",
      ];
    }

    if (!activeReport) {
      return ["Readiness report unavailable.", "Entry decision: blocked"];
    }

    const checkLog = (kind: string, prefix: string, label: string) => {
      const check = activeReport.checks.find((item) => item.kind === kind);
      if (!check) return `[${prefix}] ${label}: unavailable`;
      // Four outcomes, four words. This printed PASS for `pass` and FAIL for
      // everything else, so an advisory warning and a probe this machine
      // cannot run both appeared in the log as hard failures — which is how
      // "[NET] Network connectivity: FAIL - readiness probe did not return a
      // result" came to describe a probe that was never run.
      const outcome =
        check.outcome === "pass"
          ? "PASS"
          : check.outcome === "warn"
            ? "WARN"
            : check.outcome === "unknown"
              ? "UNAVAILABLE"
              : "FAIL";
      const detail = check.detail ? ` - ${check.detail}` : "";
      return `[${prefix}] ${label}: ${outcome}${detail}`;
    };

    return [
      `Readiness report received at ${new Date(activeReport.generated_at_ms).toLocaleTimeString()}`,
      checkLog("network", "NET", "Network connectivity"),
      checkLog("microphone", "AUD", "Microphone"),
      checkLog("camera", "CAM", "Camera"),
      checkLog("virtualization", "SEC", "Virtual machine check"),
      checkLog("keyboard_lockdown", "SEC", "Keyboard lockdown"),
      checkLog("restricted_apps", "SEC", "Restricted app check"),
      checkLog("platform", "SEC", "Platform compatibility"),
      checkLog("external_display", "SEC", "Extra monitors"),
      checkLog("remote_server", "SEC", "Remote access"),
      `Entry decision: ${activeReport.decision.toUpperCase()}`,
    ].filter((log): log is string => Boolean(log));
  }, [activeReport, entryWindow.reason, entryWindow.status, entryWindowChecking, scanStatus]);

  async function handleRescan() {
    setIsRescanning(true);
    setEntryWindowRefreshIndex((value) => value + 1);
    await onRescan();
    setIsRescanning(false);
  }

  // SECURITY: every contest entry — new OR resume — must route through
  // onboarding, which is the only path that runs verification and engages the
  // desktop lockdown (lock_desktop via startSecureSession). Sending a resume
  // straight to /session/contest skips the lock and lets a candidate sit in a
  // live contest with the machine wide open. Onboarding reuses the existing
  // IN_PROGRESS session (backend CreateSession reuses it), so re-entering does
  // not create duplicate sessions.
  const proceedHref = `/session/onboarding?contestId=${contestId}`;

  useEffect(() => {
    router.prefetch(proceedHref);
  }, [proceedHref, router]);

  const currentProgress = scanStatus === "scanning" ? 0 : score;

  // §4 — Technical details: smooth height+opacity reveal
  const techDetailsContentRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <AccessDialog
        open
        onClose={onClose}
        title={modalTitle}
        subtitle={context.message}
        labelId="session-readiness-title"
        width="calc(var(--spacing-10) * 17)"
      >
        <VStack gap={6} style={{ flexShrink: 0 }}>
          <VStack as="header" gap={2}>
            <HStack gap={3} justify="between" align="center" wrap="wrap">
              <Text type="label" style={{ color: decisionTone.color }}>
                Device readiness
              </Text>
              <Text type="supporting" hasTabularNumbers>
                {activeReport ? `${Math.round(currentProgress)}% complete` : "Not verified"}
              </Text>
            </HStack>
          </VStack>

          {unproctoredDevSession && (
            <VStack
              gap={1}
              padding={3}
              style={{
                borderRadius: "var(--radius-md)",
                border: "var(--border-width) solid var(--home-status-error-border-26)",
                background: "var(--home-status-error-bg)",
              }}
            >
              <Text style={{ color: "var(--theme-error-text)", fontWeight: 600 }}>
                Unproctored development session
              </Text>
              <Text type="supporting">
                This is a browser, not the AMS Access app, so none of the device checks can run and
                nothing is being monitored. Entry is allowed here for testing only. A real contest
                requires the installed app.
              </Text>
            </VStack>
          )}

          <Grid columns={{ minWidth: 240, max: 2 }} gap={4} align="start">
            <VStack as="section" gap={0} style={{ minWidth: 0 }}>
              <VStack gap={3}>
                <HStack align="center" justify="between" gap={3} wrap="wrap">
                  <Heading level={4} accessibilityLevel={3}>
                    Required checks
                  </Heading>
                  <Text type="supporting">
                    {!activeReport
                      ? "Not verified"
                      : context.failedRequired > 0
                        ? `${context.failedRequired} to fix`
                        : "Passing"}
                  </Text>
                </HStack>
                <Text type="supporting">
                  {unproctoredDevSession
                    ? "Not run: these are native probes and this is a browser."
                    : "These checks must pass before this device can enter the contest."}
                </Text>
                <VStack gap={0}>
                  {!activeReport && scanStatus === "done" ? (
                    <Text type="supporting" role="status">
                      Readiness report unavailable. Run checks again or ask your invigilator.
                    </Text>
                  ) : (
                    requiredPreflightItems.map((item) => (
                      <PreflightCheckItem
                        key={item.key}
                        label={item.label}
                        status={item.status}
                        successLabel={item.successLabel}
                        failLabel={item.failLabel}
                        theme={theme}
                        variant="required"
                      />
                    ))
                  )}
                </VStack>
              </VStack>
            </VStack>

            <VStack as="section" gap={0} style={{ minWidth: 0 }}>
              <VStack gap={3}>
                <HStack align="center" justify="between" gap={3} wrap="wrap">
                  <Heading level={4} accessibilityLevel={3}>
                    Optional warnings
                  </Heading>
                  <Text type="supporting">
                    {optionalWarningCount > 0
                      ? `${optionalWarningCount} advisory`
                      : "Advisory only"}
                  </Text>
                </HStack>
                <Text type="supporting">
                  These do not block entry, but they may help support diagnose issues.
                </Text>
                {optionalPreflightItems.length > 0 ? (
                  <VStack gap={0}>
                    {optionalPreflightItems.map((item) => (
                      <PreflightCheckItem
                        key={item.key}
                        label={item.label}
                        status={item.status}
                        successLabel={item.successLabel}
                        failLabel={item.failLabel}
                        theme={theme}
                        variant="optional"
                      />
                    ))}
                  </VStack>
                ) : (
                  <Text type="supporting">
                    {activeReport
                      ? "No optional warnings reported."
                      : "Waiting for a readiness report."}
                  </Text>
                )}
              </VStack>
            </VStack>
          </Grid>

          {/* macOS keyboard-permission recovery panel */}
          {showAccessibilityRecovery && (
            <VStack
              as="section"
              gap={0}
              padding={4}
              style={{
                minWidth: 0,
                background: "var(--color-background-muted)",
                borderRadius: "var(--radius-container)",
              }}
            >
              <VStack gap={3}>
                <HStack align="center" gap={2}>
                  <StatusDot variant="error" label="Permission required" />
                  <Heading level={4} accessibilityLevel={3}>
                    Grant {permissionPane} permission
                  </Heading>
                </HStack>
                <Text color="secondary">
                  AMS Access needs macOS {permissionPane} permission to lock the keyboard — open
                  Settings, enable AMS Access under Privacy &amp; Security → {permissionPane}, then
                  re-run the checks.
                </Text>
                <HStack gap={2} wrap="wrap">
                  <Button
                    theme={theme}
                    variant="primary"
                    onClick={() =>
                      void invoke("open_privacy_settings", { section: keyboardPermissionMissing })
                    }
                  >
                    Open {permissionPane} Settings
                  </Button>
                  <Button
                    theme={theme}
                    variant="secondary"
                    onClick={handleRescan}
                    disabled={isRescanning}
                  >
                    Run checks again
                  </Button>
                </HStack>
              </VStack>
            </VStack>
          )}

          {/* §4 — Technical details: smooth height+opacity CSS transition */}
          <VStack gap={0} style={{ flexShrink: 0 }}>
            <Button
              theme={theme}
              variant="secondary"
              type="button"
              aria-expanded={showTechnicalDetails}
              onClick={() => setShowTechnicalDetails((v) => !v)}
            >
              <Text>Technical details</Text>
              <Text type="supporting">{showTechnicalDetails ? "Hide" : "Show"}</Text>
            </Button>
            <VStack
              ref={techDetailsContentRef}
              aria-hidden={!showTechnicalDetails}
              style={{
                maxHeight: showTechnicalDetails ? "calc(var(--spacing-10) * 8.5)" : 0,
                flexShrink: 0,
                opacity: showTechnicalDetails ? 1 : 0,
                overflow: "hidden",
                transition:
                  "max-height var(--transition-standard), opacity var(--transition-standard)",
              }}
            >
              <VStack
                gap={1}
                padding={3}
                isScrollable
                style={{
                  borderTop: "var(--border-width) solid var(--color-border)",
                  maxHeight: "calc(var(--spacing-10) * 7.5)",
                  flexShrink: 0,
                }}
              >
                {consoleLogs.map((log, index) => (
                  <Text
                    key={index}
                    type="code"
                    style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                  >
                    {parseLogLine(log, c.dot)}
                  </Text>
                ))}
                {scanStatus === "scanning" && (
                  <HStack align="center" gap={2}>
                    <Spinner size="sm" aria-label="Checking your device" />
                    <Text type="supporting">Checking your device</Text>
                  </HStack>
                )}
              </VStack>
            </VStack>
          </VStack>

          <HStack gap={3} wrap="wrap" align="center" justify="end" style={{ flexShrink: 0 }}>
            {canProceed ? (
              onProceed ? (
                /* §3 — Primary: AMS purple, unified radius (matches Validate / app buttons) */
                <Button theme={theme} variant="primary" onClick={() => void onProceed()}>
                  {primaryActionLabel}
                </Button>
              ) : (
                <Link
                  href={proceedHref}
                  prefetch
                  onClick={onClose}
                  style={{
                    minWidth: "calc(var(--spacing-10) * 4)",
                    height: "var(--spacing-10)",
                    borderRadius: "var(--radius-md)",
                    border: "none",
                    background: "var(--color-background-inverted)",
                    color: "var(--color-background-body)",
                    fontSize: "var(--font-size-base)",
                    fontWeight: 700,
                    fontFamily: "inherit",
                    cursor: "pointer",
                    transition: "all var(--transition-fast)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    textDecoration: "none",
                  }}
                >
                  {primaryActionLabel}
                </Link>
              )
            ) : scanStatus === "scanning" ? (
              <Button theme={theme} variant="primary" disabled>
                {primaryActionLabel}
              </Button>
            ) : context.status === "needs_action" || context.status === "advisory_warning" ? (
              <Button theme={theme} variant="primary" onClick={onSettingsRedirect}>
                {primaryActionLabel}
              </Button>
            ) : (
              <Button theme={theme} variant="primary" onClick={onClose}>
                {primaryActionLabel}
              </Button>
            )}
            {/* §3 — Secondary buttons: flat muted text, no border/bg */}
            {scanStatus !== "scanning" && (
              <Button
                theme={theme}
                variant="secondary"
                onClick={handleRescan}
                disabled={isRescanning}
              >
                Run checks again
              </Button>
            )}
            {primaryActionLabel !== "Open settings" && (
              <Button theme={theme} variant="secondary" onClick={onSettingsRedirect}>
                Open settings
              </Button>
            )}
            {primaryActionLabel !== "Back to contests" && (
              <Button theme={theme} variant="secondary" onClick={onClose}>
                Back to contests
              </Button>
            )}
            {!canProceed && scanStatus !== "scanning" && (
              <Button theme={theme} variant="secondary" onClick={() => setHelpOpen(true)}>
                Get help
              </Button>
            )}
          </HStack>
        </VStack>
      </AccessDialog>
      <HelpRequestModal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        kind={entryWindow.status === "blocked" ? "POLICY_BLOCK" : "READINESS"}
        contestId={contestId}
        summary={
          entryWindow.status === "blocked"
            ? `Blocked from entering the contest: ${entryWindow.reason ?? "entry window not open"}.`
            : "I can't pass the device readiness checks to enter the contest."
        }
        details={{
          source: "readiness_modal",
          session_type: sessionType,
          entry_window: entryWindow.status,
          entry_window_reason: entryWindow.reason,
          decision: activeReport?.decision,
          diagnostics: consoleLogs,
        }}
      />
    </>
  );
}
