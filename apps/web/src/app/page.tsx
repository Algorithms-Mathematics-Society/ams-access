"use client";

/**
 * The one gate every launch passes through.
 *
 * Two things have to happen here, in this order, and neither can live on the
 * login screen any more.
 *
 * **The update prompt.** It was on `/login`, which was fine while every
 * launch went through it. It no longer does: a candidate with a valid token
 * is now sent straight to `/home`, so a prompt on the login screen would be
 * shown to precisely the people who do not need it and hidden from everyone
 * else. It belongs before the routing decision, not after.
 *
 * **Staying signed in.** The token has always persisted -- it is in storage
 * with the server's expiry, now a week -- and launch simply never looked at
 * it. Every restart went to the login screen, so a candidate whose entry had
 * failed was sent to the single most expensive endpoint on the server at the
 * moment it could least afford it. That is the restart storm from 21 Oct, and
 * it was one `if` away from not happening.
 *
 * **Whose session it is.** A token lasts a week, and lab Macs are shared, so
 * the person launching the app may not be the one who signed in. A valid
 * token stops at "Continue as {name}?" rather than opening that candidate's
 * workspace for whoever sat down next.
 *
 * The version check runs first on purpose. A client below the server's
 * minimum should not be quietly signed in to sit a contest; it should be told
 * to update. A newer advisory release is only a dismissible notice.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@astryxdesign/core/AppShell";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { invoke } from "@ams/api-client";
import { RouteLoadingShell } from "@/components/RouteLoadingShell";
import WelcomeScreen from "./WelcomeScreen";
import { StartupAnimation } from "@/components/StartupAnimation";
import { UpdateRequiredDialog } from "./login/UpdateRequiredDialog";
import { belowMinimum, fetchClientVersion, minorUpgradeAvailable } from "@/lib/client-update";
import { resolveApiBase } from "@/lib/api-base";
import { ProctorApiError, currentToken, listContests, logout } from "@/lib/proctor-api";
import { clearQueryCache } from "@/lib/api-client";
import { openExternal } from "@/lib/open-external";
import { STORAGE_KEYS } from "@/constants/storage-keys";
import { isBufferKey } from "@/app/session/contest/answer-buffer";

type Gate = "checking" | "update" | "confirm" | "signed-in" | "welcome";

function storedDisplayName(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.DISPLAY_NAME);
  } catch {
    return null;
  }
}

/**
 * Home's sign-out, for someone who never reached Home.
 *
 * Two differences. The native event stream is reset without waiting: this is
 * a fresh launch, so nothing has configured it yet. And the previous
 * candidate's unsent drafts are kept: Home asks before deleting them, and the
 * person at the keyboard now is not the one who can answer.
 */
function signOutPreviousCandidate() {
  logout();
  clearQueryCache();
  void invoke("configure_event_stream", { apiUrl: "", sessionId: null, token: null }).catch(
    () => {}
  );
  try {
    Object.keys(localStorage)
      .filter(
        (key) =>
          key.startsWith("ams_") &&
          key !== STORAGE_KEYS.DEVICE_ID &&
          key !== STORAGE_KEYS.THEME &&
          !isBufferKey(key)
      )
      .forEach((key) => {
        try {
          localStorage.removeItem(key);
        } catch {
          // Keep clearing other keys if this one is blocked.
        }
      });
  } catch {
    // Storage may be inaccessible even to enumeration; the token is already gone.
  }
}

export default function RootPage() {
  const router = useRouter();
  const [gate, setGate] = useState<Gate>("checking");
  const [update, setUpdate] = useState<{ latest: string; url: string } | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "";

  useEffect(() => {
    let cancelled = false;
    // The version check and the token check can take up to 26 s between
    // them on a struggling server. Say so rather than spin in silence.
    const slowTimer = setTimeout(() => setSlow(true), 5_000);

    void (async () => {
      // 1. Is this build still the one to be running?
      if (appVersion) {
        const info = await fetchClientVersion(resolveApiBase());
        if (cancelled) return;
        // Only the server's minimum blocks: it refuses those builds with 426
        // anyway. A newer `latest` is advisory and must never stop an exam.
        if (info?.minimum && belowMinimum(appVersion, info.minimum)) {
          setUpdate({ latest: info.latest || info.minimum, url: info.download_url });
          setGate("update");
          return;
        }
        if (info?.latest && minorUpgradeAvailable(appVersion, info.latest)) {
          setUpdate({ latest: info.latest, url: info.download_url });
        }
      }

      // 2. Is there still a session to resume? A stored token can be
      //    expired, revoked, or from a rotated credential, and only the
      //    server knows which -- so ask it, with the cheapest authenticated
      //    call there is. Only a 401 means signing in again. A timeout,
      //    an unreachable host or a 5xx says nothing about the token, and
      //    sending everyone to the login endpoint during an outage is the
      //    storm this gate exists to prevent; Home shows its own error and
      //    retry.
      if (currentToken()) {
        try {
          await listContests();
        } catch (caught) {
          if (cancelled) return;
          if (caught instanceof ProctorApiError && caught.status === 401) {
            setGate("welcome");
            return;
          }
        }
        if (cancelled) return;
        setName(storedDisplayName());
        setGate("confirm");
        return;
      }

      setGate("welcome");
    })();

    return () => {
      cancelled = true;
      clearTimeout(slowTimer);
    };
  }, [appVersion, router]);

  if (gate === "update" && update) {
    return (
      <UpdateRequiredDialog
        currentVersion={appVersion}
        latestVersion={update.latest}
        downloadUrl={update.url}
        onInstall={openExternal}
      />
    );
  }

  const notice = update && (
    <Banner
      status="info"
      container="section"
      isDismissable
      title="Update available, install after your exam"
      description={`${appVersion} → ${update.latest}`}
      endContent={
        <Button
          label="Download"
          variant="secondary"
          size="sm"
          onClick={() => openExternal(update.url)}
        />
      }
    />
  );

  // Keep a visible status after Skip, reduced motion, or the intro deadline
  // while the gates finish. Entry remains unavailable until they resolve.
  return (
    <StartupAnimation>
      {gate === "welcome" ? (
        <WelcomeScreen banner={notice} onEnter={() => router.push("/login")} />
      ) : gate === "confirm" ? (
        <AppShell height="fill" variant="section" contentPadding={4} banner={notice}>
          <VStack gap={6} align="center" justify="center" style={{ minHeight: "100%" }}>
            <VStack gap={2} align="center">
              <Heading level={1} justify="center" textWrap="balance">
                {name ? `Continue as ${name}?` : "Continue where you left off?"}
              </Heading>
              <Text color="secondary" justify="center">
                This computer is still signed in from an earlier session.
              </Text>
            </VStack>
            <VStack gap={3} align="center">
              <Button
                label="Continue"
                variant="primary"
                size="lg"
                data-startup-focus
                onClick={() => {
                  router.replace("/home");
                  setGate("signed-in");
                }}
              />
              <Button
                label="Not you? Sign out"
                variant="ghost"
                onClick={() => {
                  signOutPreviousCandidate();
                  setGate("welcome");
                }}
              />
            </VStack>
          </VStack>
        </AppShell>
      ) : (
        <VStack role="status" aria-live="polite">
          <RouteLoadingShell
            variant="home"
            label={
              gate === "signed-in"
                ? "Opening your workspace…"
                : slow
                  ? "Still checking your access. The exam server is slow to answer…"
                  : "Checking your access…"
            }
          />
        </VStack>
      )}
    </StartupAnimation>
  );
}
