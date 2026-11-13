"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { invoke } from "@ams/api-client";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { clearBoostCache } from "@/app/session/contest/boostref";
import { resolveApiBase } from "@/lib/api-base";

type Status = {
  available: boolean;
  installed: boolean;
  release: string | null;
  title: string | null;
};
let checkedThisWindow = false;

/** The offer is shown only for a real published pack, once per app window. */
export function BoostReferenceOffer() {
  const path = usePathname();
  const [pack, setPack] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLElement>(null);
  const safeRoute = path === "/" || path === "/login" || path === "/home";

  useEffect(() => {
    if (!safeRoute || checkedThisWindow || !window.__TAURI__) return;
    // The startup animation and account gate settle before an optional offer.
    const timer = window.setTimeout(() => {
      checkedThisWindow = true;
      void invoke<Status>("boost_reference_status", { apiUrl: resolveApiBase() })
        .then((status) => {
          if (status.available && !status.installed) setPack(status);
        })
        .catch(() => {
          /* Offline startup keeps the cached book available in contest. */
        });
    }, 2300);
    return () => window.clearTimeout(timer);
  }, [safeRoute]);

  useEffect(() => {
    if (!pack || !safeRoute) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.querySelector<HTMLElement>("button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        setPack(null);
        return;
      }
      if (event.key !== "Tab") return;
      const buttons = Array.from(
        dialog.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? []
      );
      if (!buttons.length) return;
      const first = buttons[0],
        last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [pack, safeRoute, busy]);

  if (!pack || !safeRoute) return null;
  const download = async () => {
    setBusy(true);
    setError("");
    try {
      await invoke("install_boost_reference", { apiUrl: resolveApiBase() });
      clearBoostCache();
      setPack(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };
  const cancel = () => {
    if (busy) void invoke("cancel_boost_reference_download").catch(() => {});
    else setPack(null);
  };
  return (
    <VStack
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby="boost-reference-title"
      align="center"
      justify="center"
      gap={0}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 900,
        padding: "var(--spacing-5)",
        background: "color-mix(in srgb, var(--color-background-body) 88%, transparent)",
      }}
    >
      <Card
        padding={5}
        style={{ width: "100%", maxWidth: "30rem", maxHeight: "100%", overflowY: "auto" }}
      >
        <VStack gap={4}>
          <Heading level={2} id="boost-reference-title">
            Download the Boost reference?
          </Heading>
          <Text>A Boost reference pack is available for offline reading during contests.</Text>
          <Text type="supporting" color="secondary">
            {pack.title} · {pack.release}
          </Text>
          <Text type="supporting">
            The download is saved on this device. You can continue without it and download it on a
            later launch.
          </Text>
          {busy && <Text role="status">Downloading and verifying the reference pack…</Text>}
          {error && <Text role="alert">{error}</Text>}
          <HStack gap={3} wrap="wrap">
            <Button
              label={busy ? "Downloading…" : error ? "Retry download" : "Download"}
              variant="primary"
              isDisabled={busy}
              onClick={() => void download()}
            />
            <Button label={busy ? "Cancel download" : "Not now"} variant="ghost" onClick={cancel} />
          </HStack>
        </VStack>
      </Card>
    </VStack>
  );
}
