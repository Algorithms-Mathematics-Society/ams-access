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
 * The version check runs first on purpose. An out-of-date client should not
 * be quietly signed in to sit a contest; it should be told to update.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import WelcomeScreen from "./WelcomeScreen";
import { StartupAnimation } from "@/components/StartupAnimation";
import { UpdateRequiredDialog } from "./login/UpdateRequiredDialog";
import { fetchClientVersion, minorUpgradeAvailable } from "@/lib/client-update";
import { resolveApiBase } from "@/lib/api-base";
import { currentToken, listContests } from "@/lib/proctor-api";
import { openExternal } from "@/lib/open-external";

type Gate = "checking" | "update" | "signed-in" | "welcome";

export default function RootPage() {
  const router = useRouter();
  const [gate, setGate] = useState<Gate>("checking");
  const [update, setUpdate] = useState<{ latest: string; url: string } | null>(null);
  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "";

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // 1. Is this build still the one to be running?
      if (appVersion) {
        const info = await fetchClientVersion(resolveApiBase());
        if (cancelled) return;
        if (info?.latest && minorUpgradeAvailable(appVersion, info.latest)) {
          setUpdate({ latest: info.latest, url: info.download_url });
          setGate("update");
          return;
        }
      }

      // 2. Is there still a session to resume? A stored token can be
      //    expired, revoked, or from a rotated credential, and only the
      //    server knows which -- so ask it, with the cheapest authenticated
      //    call there is. A failure is not an error here: it just means
      //    signing in, which is what would have happened anyway.
      if (currentToken()) {
        try {
          await listContests();
          if (cancelled) return;
          router.replace("/home");
          setGate("signed-in");
          return;
        } catch {
          if (cancelled) return;
        }
      }

      setGate("welcome");
    })();

    return () => {
      cancelled = true;
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

  // "checking" and "signed-in" both render the animation rather than a flash
  // of the welcome screen: one is still deciding, the other is on its way to
  // /home and showing "Enter" would invite a click that undoes it.
  return (
    <StartupAnimation>
      {gate === "welcome" ? <WelcomeScreen onEnter={() => router.push("/login")} /> : null}
    </StartupAnimation>
  );
}
