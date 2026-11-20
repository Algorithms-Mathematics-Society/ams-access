"use client";

import { useCallback, useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import { invoke } from "@ams/api-client";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { AccessDialog } from "@/components/AccessDialog";
import { boostPackSize, clearBoostCache } from "@/app/session/contest/boostref";
import { resolveApiBase } from "@/lib/api-base";

type Status = {
  available: boolean;
  installed: boolean;
  release: string | null;
  title: string | null;
  bytes: number | null;
};

/** Home-bar control to download, update or delete the optional Boost pack.
 *  Nothing is bundled: the pack lives in app data only after a download. */
export function BoostReferenceManager({ iconOnly }: { iconOnly: boolean }) {
  const [native, setNative] = useState(false);
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState<Status | null>(null);
  // null while offline or before the first check.
  const [published, setPublished] = useState<Status | null>(null);
  const [busy, setBusy] = useState<"download" | "delete" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => setNative(Boolean(window.__TAURI__)), []);

  const refresh = useCallback(async () => {
    const [installed, remote] = await Promise.all([
      invoke<Status>("boost_reference_local_status").catch(() => null),
      invoke<Status>("boost_reference_status", { apiUrl: resolveApiBase() }).catch(() => null),
    ]);
    setLocal(installed);
    setPublished(remote);
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  if (!native) return null;

  const run = async (kind: "download" | "delete") => {
    setBusy(kind);
    setError("");
    try {
      if (kind === "download")
        await invoke("install_boost_reference", { apiUrl: resolveApiBase() });
      else await invoke("delete_boost_reference");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      clearBoostCache();
      await refresh();
      setBusy(null);
    }
  };

  const installed = local?.installed === true;
  const canDownload = published?.available === true && !published.installed;
  const size = published?.bytes ? ` (${boostPackSize(published.bytes)})` : "";
  const summary = busy
    ? busy === "download"
      ? "Downloading and verifying the Boost documentation…"
      : "Deleting…"
    : installed
      ? `Downloaded: ${local.title ?? "Boost"} · ${local.release}${
          local.bytes ? ` · ${boostPackSize(local.bytes)}` : ""
        }`
      : published?.available
        ? `${published.title ?? "Boost"} · ${published.release}${size}`
        : published
          ? "No Boost documentation is published yet."
          : "Connect to the internet to download the Boost documentation.";

  return (
    <>
      <Button
        label="References"
        variant="secondary"
        icon={<Icon icon={BookOpen} size="sm" />}
        isIconOnly={iconOnly}
        tooltip={iconOnly ? "References" : undefined}
        onClick={() => setOpen(true)}
      />
      <AccessDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Offline references"
        subtitle="Download documentation to read in the contest reference panel."
        labelId="boost-reference-title"
        width="calc(var(--spacing-10) * 14)"
      >
        <VStack gap={4}>
          <Text type="supporting" color="secondary">
            The C++ standard library reference is built in.
          </Text>
          <VStack gap={1}>
            <Text type="label">Boost libraries</Text>
            <Text role="status">{summary}</Text>
          </VStack>
          {error && <Text role="alert">{error}</Text>}
          <HStack gap={3} wrap="wrap">
            {canDownload && (
              <Button
                label={installed ? `Update${size}` : `Download${size}`}
                variant="primary"
                isDisabled={busy !== null}
                onClick={() => void run("download")}
              />
            )}
            {busy === "download" && (
              <Button
                label="Cancel download"
                variant="secondary"
                onClick={() => void invoke("cancel_boost_reference_download").catch(() => {})}
              />
            )}
            {installed && (
              <Button
                label="Delete"
                variant="secondary"
                isDisabled={busy !== null}
                onClick={() => void run("delete")}
              />
            )}
          </HStack>
        </VStack>
      </AccessDialog>
    </>
  );
}
