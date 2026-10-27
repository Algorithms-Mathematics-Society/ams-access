import { useEffect, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { VStack } from "@astryxdesign/core/VStack";
import { Text } from "@astryxdesign/core/Text";
import { isGatingRelaxed } from "@/lib/gating";
import { invokeStrict } from "../support";
import { StatusBadge } from "./ui";

type LocationStatus = "not_determined" | "denied" | "restricted" | "authorized";

/** Mounted only on macOS, before the contest kiosk can hide permission prompts. */
export function LocationPermission({
  onReady,
  onQuitAndReopen,
}: {
  onReady(ready: boolean): void;
  onQuitAndReopen(): void;
}) {
  const skipped = process.env.NODE_ENV === "development" && isGatingRelaxed();
  const [status, setStatus] = useState<LocationStatus | null>(null);
  const [error, setError] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [pollRound, setPollRound] = useState(0);
  const requestPending = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    onReady(skipped || status === "authorized");
  }, [onReady, skipped, status]);

  useEffect(() => {
    if (skipped) return;
    let cancelled = false;
    let pending = false;
    const deadline = Date.now() + 60_000;
    let timer: ReturnType<typeof setInterval> | undefined;
    async function check() {
      if (pending) return;
      pending = true;
      try {
        const next = await invokeStrict<LocationStatus>("wifi_location_status");
        if (cancelled) return;
        if (!["not_determined", "denied", "restricted", "authorized"].includes(next ?? "")) {
          throw new Error("Location status unavailable");
        }
        setStatus(next);
        setError("");
        if (next === "authorized") clearInterval(timer);
      } catch {
        if (!cancelled) {
          setStatus(null);
          setError("Could not check Location access. Try again or open System Settings.");
        }
      } finally {
        pending = false;
      }
    }
    void check();
    if (pollRound > 0)
      timer = setInterval(() => {
        if (Date.now() >= deadline) clearInterval(timer);
        else void check();
      }, 1000);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [skipped, pollRound]);

  const allow = async () => {
    if (requestPending.current) return;
    requestPending.current = true;
    setRequesting(true);
    setError("");
    try {
      await invokeStrict("request_wifi_location");
    } catch {
      if (mounted.current) setError("Could not request Location access. Open System Settings.");
    } finally {
      requestPending.current = false;
      if (mounted.current) {
        setRequesting(false);
        setPollRound((round) => round + 1);
      }
    }
  };

  return (
    <VStack gap={2}>
      <Text weight="medium">Location access required</Text>
      <Text color="secondary">
        macOS shows nearby Wi-Fi networks only to apps with Location access, so you can reconnect if
        Wi-Fi drops. Your location is never recorded or sent.
      </Text>
      <StatusBadge
        status={skipped ? "warn" : status === "authorized" ? "pass" : "fail"}
        label={
          skipped
            ? "Location access skipped in dev build"
            : status === "authorized"
              ? "Location access allowed"
              : "Allow Location access to finish setup"
        }
      />
      {!skipped && status !== "authorized" && (
        <>
          {status === "restricted" ? (
            <Text color="secondary">
              Location Services is turned off on this Mac. Turn it on in System Settings &gt;
              Privacy &amp; Security &gt; Location Services, or ask an invigilator.
            </Text>
          ) : (
            <Text color="secondary">
              {status === "denied"
                ? "Location access was denied. Allow AMS Access in"
                : "If no prompt appeared, enable AMS Access in"}{" "}
              System Settings &gt; Privacy &amp; Security &gt; Location Services.
            </Text>
          )}
          {(status === null || status === "not_determined") && (
            <Button
              label="Allow Location access"
              onClick={() => void allow()}
              isLoading={requesting}
            />
          )}
          <Button
            label="Open System Settings"
            onClick={() => {
              void invokeStrict("open_privacy_settings", { section: "location" }).catch(() => {
                if (mounted.current)
                  setError("Could not open System Settings. Open Location Services manually.");
              });
            }}
          />
          <Text color="secondary">
            After allowing Location access, macOS may require quitting and reopening AMS Access.
          </Text>
          <Button label="Quit & reopen AMS Access" onClick={onQuitAndReopen} />
          {error && (
            <Text role="alert" color="secondary">
              {error}
            </Text>
          )}
        </>
      )}
    </VStack>
  );
}
