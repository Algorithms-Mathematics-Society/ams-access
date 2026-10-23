import { useCallback, useEffect, useRef, useState } from "react";
import { Lock, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";

/**
 * Changing network without leaving the exam.
 *
 * A candidate whose wifi dies cannot reach the system picker: the kiosk hides
 * the menu bar and the exam window cannot be moved, minimised or closed. The
 * only way back onto a network was to leave the contest, and before that
 * existed, to hold the power button. So the picker comes inside.
 *
 * It renders nothing at all when the platform cannot list networks -- a
 * browser dev build, or a machine with no wireless interface. An empty
 * dropdown would read as "no networks in range", which is a different and
 * more alarming claim than "this app cannot ask".
 */

type WifiNetwork = {
  ssid: string;
  signal: number | null;
  secured: boolean;
  current: boolean;
};

type WifiScan = {
  networks: WifiNetwork[];
  current: string | null;
  supported: boolean;
};

const REFRESH_MS = 20_000;

/**
 * Stand-in networks for `pnpm dev:hosted`, where there is no native layer to
 * ask and the control would otherwise render nothing at all.
 *
 * `process.env.NODE_ENV` is substituted at build time, so this whole branch
 * is removed from a production bundle: a shipped installer cannot show these
 * even if the native call fails. It exists to review the dropdown's layout
 * and the password flow in a browser, and for nothing else.
 */
function devScan(): WifiScan | null {
  if (process.env.NODE_ENV === "production") return null;
  if (typeof window !== "undefined" && window.__TAURI__) return null;
  return {
    supported: true,
    current: "CampusWiFi",
    networks: [
      { ssid: "CampusWiFi", signal: 78, secured: true, current: true },
      { ssid: "Hostel_5G", signal: 64, secured: true, current: false },
      { ssid: "AMS-Guest", signal: 41, secured: false, current: false },
      { ssid: "iPhone Hotspot", signal: 92, secured: true, current: false },
    ],
  };
}

export function WifiControl({ online }: { online: boolean }) {
  const [scan, setScan] = useState<WifiScan | null>(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<WifiNetwork | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Which way the menu opens, and how tall it may be.
  //
  // It was always dropped downward at a fixed height, which is wrong in the
  // two places it actually gets used: in the offline dialog the trigger sits
  // near the bottom, so the list ran off the viewport and the networks could
  // not be reached at all. Measured from the trigger each time it opens.
  const [menu, setMenu] = useState<{ up: boolean; maxHeight: number }>({
    up: false,
    maxHeight: 320,
  });

  const refresh = useCallback(async () => {
    try {
      const next = await window.__TAURI__?.core.invoke<WifiScan>("scan_wifi");
      setScan(next ?? devScan());
    } catch {
      setScan(devScan());
    }
  }, []);

  useEffect(() => {
    // One scan on mount, to learn whether this machine can list networks at
    // all -- that decides whether the button appears.
    void refresh();
  }, [refresh]);

  useEffect(() => {
    // Rescan only while the menu is open or the connection is down. Every
    // scan spawns a subprocess, and polling one every twenty seconds for a
    // two-hour paper is several hundred of them per candidate for a list
    // nobody is looking at.
    if (!open && online) return;
    const id = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [open, online, refresh]);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const margin = 12;
      const below = window.innerHeight - rect.bottom - margin;
      const above = rect.top - margin;
      const up = below < 220 && above > below;
      setMenu({ up, maxHeight: Math.max(160, Math.min(360, up ? above : below)) });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  // Close on Escape and on a click outside, the same as the camera picker.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  if (!scan?.supported) return null;

  const join = async (network: WifiNetwork, secret: string) => {
    setBusy(true);
    setError("");
    setNote("");
    try {
      if (window.__TAURI__) {
        await window.__TAURI__.core.invoke("connect_wifi", {
          ssid: network.ssid,
          password: secret || null,
        });
      } else if (process.env.NODE_ENV === "production") {
        throw new Error("Changing network is not supported here.");
      }
      setNote(`Joining ${network.ssid}…`);
      setSelected(null);
      setPassword("");
      // The OS takes a moment to associate; the heartbeat notices on its own.
      window.setTimeout(() => void refresh(), 2500);
    } catch (caught) {
      setError(typeof caught === "string" ? caught : "Could not join that network.");
    } finally {
      setBusy(false);
    }
  };

  const Icon = online ? Wifi : WifiOff;
  const label = scan.current ? `Network: ${scan.current}` : "Not connected to wifi";

  return (
    <div ref={rootRef} style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-expanded={open}
        title={label}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--spacing-1)",
          background: "transparent",
          border: "none",
          padding: "var(--spacing-1)",
          cursor: "pointer",
          borderRadius: "var(--radius-control)",
          color: online ? "var(--color-text-secondary)" : "var(--color-text-error)",
        }}
      >
        <Icon size={16} aria-hidden="true" />
      </button>

      {open && (
        <VStack
          gap={3}
          style={{
            position: "absolute",
            ...(menu.up
              ? { bottom: "calc(100% + var(--spacing-2))" }
              : { top: "calc(100% + var(--spacing-2))" }),
            right: 0,
            zIndex: 1200,
            width: "calc(var(--spacing-10) * 7)",
            maxWidth: "calc(100vw - var(--spacing-8))",
            maxHeight: `${menu.maxHeight}px`,
            overflowY: "auto",
            padding: "var(--spacing-3)",
            background: "var(--color-background-card)",
            border: "1px solid var(--color-border-subtle)",
            borderRadius: "var(--radius-container)",
            boxShadow: "var(--shadow-high)",
          }}
        >
          <HStack justify="between" align="center">
            <Text type="supporting" color="secondary">
              Wi-Fi
            </Text>
            <button
              type="button"
              onClick={() => void refresh()}
              aria-label="Rescan networks"
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "var(--color-text-secondary)",
                display: "flex",
              }}
            >
              <RefreshCw size={14} aria-hidden="true" />
            </button>
          </HStack>

          {scan.networks.length === 0 && (
            <Text type="supporting" color="secondary">
              No saved networks found.
            </Text>
          )}

          {scan.networks.map((network) => (
            <VStack key={network.ssid} gap={2}>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (network.current) return;
                  if (network.secured) {
                    setSelected(network);
                    setPassword("");
                    setError("");
                  } else {
                    void join(network, "");
                  }
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "var(--spacing-2)",
                  width: "100%",
                  background: network.current ? "var(--color-background-subtle)" : "transparent",
                  border: "none",
                  padding: "var(--spacing-2)",
                  borderRadius: "var(--radius-control)",
                  cursor: network.current ? "default" : "pointer",
                  textAlign: "left",
                }}
              >
                <Text color={network.current ? "primary" : "secondary"}>
                  {network.ssid}
                  {network.current ? " · connected" : ""}
                </Text>
                <HStack gap={1} align="center" style={{ flexShrink: 0 }}>
                  {network.secured && (
                    <Lock size={12} aria-label="Secured" style={{ opacity: 0.6 }} />
                  )}
                  {network.signal !== null && (
                    <Text type="code" color="secondary">
                      {network.signal}
                    </Text>
                  )}
                </HStack>
              </button>

              {selected?.ssid === network.ssid && (
                <VStack gap={2}>
                  <input
                    type="password"
                    autoFocus
                    value={password}
                    placeholder="Network password"
                    onChange={(event) => setPassword(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !busy) void join(network, password);
                    }}
                    style={{
                      width: "100%",
                      padding: "var(--spacing-2)",
                      borderRadius: "var(--radius-control)",
                      border: "1px solid var(--color-border-subtle)",
                      background: "var(--color-background-page)",
                      color: "var(--color-text-primary)",
                    }}
                  />
                  <HStack gap={2} justify="end">
                    <Button
                      label="Cancel"
                      variant="secondary"
                      onClick={() => {
                        setSelected(null);
                        setPassword("");
                      }}
                    />
                    <Button
                      label={busy ? "Joining…" : "Join"}
                      variant="primary"
                      isDisabled={busy}
                      onClick={() => void join(network, password)}
                    />
                  </HStack>
                </VStack>
              )}
            </VStack>
          ))}

          {error && (
            <Text color="inherit" style={{ color: "var(--color-text-error)" }}>
              {error}
            </Text>
          )}
          {note && !error && (
            <Text type="supporting" color="secondary">
              {note}
            </Text>
          )}
        </VStack>
      )}
    </div>
  );
}
