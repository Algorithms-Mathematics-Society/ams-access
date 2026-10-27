"use client";
import { useEffect, useRef, useCallback, useState, useSyncExternalStore } from "react";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { AccessDialog } from "@/components/AccessDialog";
import { Button } from "@astryxdesign/core/Button";
import { resolveApiBase } from "@/lib/api-base";
import {
  EMPTY_STATUS,
  isCurrent,
  relevant,
  reportTime,
  timestamp,
  type Component,
  type Platform,
} from "@/lib/service-status";
import { ServiceStatusReader } from "@/lib/service-status-reader";
let reader: ServiceStatusReader | undefined;
function getReader() {
  if (!reader)
    reader = new ServiceStatusReader(`${resolveApiBase()}/client/status`, {
      fetch: (...args) => fetch(...args),
      now: () => performance.now(),
      random: Math.random,
      visible: () => document.visibilityState !== "hidden",
      online: () => navigator.onLine !== false,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (id) => clearTimeout(id),
    });
  return reader;
}
let subscriptions = 0;
function subscribe(fn: () => void) {
  const current = getReader();
  if (subscriptions++ === 0) {
    document.addEventListener("visibilitychange", current.wake);
    window.addEventListener("online", current.wake);
    window.addEventListener("offline", current.wake);
  }
  const stop = current.subscribe(fn);
  return () => {
    stop();
    if (--subscriptions === 0) {
      document.removeEventListener("visibilitychange", current.wake);
      window.removeEventListener("online", current.wake);
      window.removeEventListener("offline", current.wake);
    }
  };
}
const snapshot = () => reader?.snapshot() ?? EMPTY_STATUS;
const serverSnapshot = () => EMPTY_STATUS;
function platform(): Platform {
  const ua = navigator.userAgent;
  return /Windows/i.test(ua)
    ? "windows"
    : /Macintosh|Mac OS X/i.test(ua)
      ? "macos"
      : /Linux/i.test(ua)
        ? "linux"
        : "unknown";
}
const componentLabels: Record<Component, string> = {
  sign_in: "sign-in",
  contest_entry: "contest entry",
  judging: "judging",
  submissions: "submissions",
  support: "support",
  general: "general service",
};
/** Always mounted, bounded region: feed changes never move focused fields/editor. */
export function ServiceStatus({
  components,
  localFailure = false,
  expanded = false,
  suspended = false,
}: {
  components: Component[];
  localFailure?: boolean;
  expanded?: boolean;
  suspended?: boolean;
}) {
  const state = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;
  const shouldRestoreFocus = useCallback(() => !suspendedRef.current, []);
  const [details, setDetails] = useState(expanded);
  useEffect(() => {
    if (localFailure) getReader().localFailure();
  }, [localFailure]);
  const incidents = relevant(
    state.report,
    components,
    typeof navigator === "undefined" ? "unknown" : platform()
  );
  const current = isCurrent(state);
  const visible = details || localFailure || incidents.length > 0;
  useEffect(() => {
    if (suspended) setDetails(false);
  }, [suspended]);
  const summary = !state.checked
    ? "Service status has not been checked yet."
    : current
      ? incidents.length
        ? "AMS has published a service update."
        : "No relevant incident was reported at the last status check. The cause of any local problem is not confirmed."
      : state.report
        ? "Last known service update; current status is unverified."
        : "Current service status is unavailable. This does not establish whether the problem is personal or shared.";
  const content = (
    <VStack
      gap={2}
      padding={2}
      aria-label="Service status"
      style={{ minWidth: 0, overflowWrap: "anywhere" }}
    >
      <Text type="supporting" role="status" aria-live="polite">
        {incidents.length
          ? `${current ? "AMS report" : "Last known AMS report"}: ${incidents.map((i) => `${i.title} (${i.state})`).join("; ")}`
          : "Service status"}
      </Text>
      {visible && (
        <>
          <Text type="supporting">{summary}</Text>
          {state.offline && (
            <Text type="supporting">
              This device reports being offline. Any report below is last known information.
            </Text>
          )}
          {state.failed && state.report && (
            <Text type="supporting">The latest status check failed.</Text>
          )}
          {incidents.map((i) => (
            <VStack gap={1} key={i.id}>
              <Text type="supporting">{i.message}</Text>
              <Text type="supporting">{i.candidate_action}</Text>
              <Text type="supporting">
                Scope: {i.components.map((c) => componentLabels[c]).join(", ")} ·{" "}
                {i.platforms.join(", ")}. Updated {i.updated_at}.
              </Text>
              {i.next_update_at && (
                <Text type="supporting">
                  Next update: {i.next_update_at}.
                  {reportTime(state) !== null && reportTime(state)! >= timestamp(i.next_update_at)
                    ? " The promised update time has passed."
                    : ""}
                </Text>
              )}
            </VStack>
          ))}
        </>
      )}
      <Text type="supporting">Checks run automatically. Repeated requests are limited.</Text>
      <Button
        label="Check status"
        variant="ghost"
        size="sm"
        isDisabled={state.checking || state.offline}
        onClick={() => {
          setDetails(true);
          void getReader().check();
        }}
      />
    </VStack>
  );
  if (expanded) return content;
  return (
    <>
      <HStack
        gap={2}
        paddingInline={2}
        style={{
          height: "var(--spacing-10)",
          minHeight: "var(--spacing-10)",
          flexShrink: 0,
          minWidth: 0,
        }}
      >
        <Text
          type="supporting"
          role="status"
          aria-live="polite"
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
            flex: 1,
          }}
        >
          {incidents.length
            ? `${current ? "AMS report" : "Last known AMS report"}: ${incidents[0].title} (${incidents[0].state})`
            : localFailure
              ? current
                ? "No relevant incident reported; cause unconfirmed."
                : "Service status unavailable; cause unconfirmed."
              : "Service status"}
        </Text>
        <Button
          label="View status"
          size="sm"
          variant="ghost"
          isDisabled={suspended}
          onClick={() => setDetails(true)}
        />
      </HStack>
      {details && !suspended && (
        <AccessDialog
          open
          onClose={() => setDetails(false)}
          title="Service status"
          labelId="service-status-details"
          shouldRestoreFocus={shouldRestoreFocus}
          width="min(calc(100vw - var(--spacing-8)), calc(var(--spacing-10) * 15))"
        >
          {content}
        </AccessDialog>
      )}
    </>
  );
}
