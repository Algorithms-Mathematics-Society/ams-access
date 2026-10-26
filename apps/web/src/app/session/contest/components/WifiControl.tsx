import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Eye, EyeOff, Lock, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
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
 * Network names and connection state come exclusively from the native layer.
 * Browsers and unsupported devices show guidance to use system settings,
 * rather than an empty or simulated network list.
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
  connected: boolean;
  supported: boolean;
};

const REFRESH_MS = 20_000;

const UNSUPPORTED_SCAN: WifiScan = {
  supported: false,
  current: null,
  connected: false,
  networks: [],
};

type JoinStatus = {
  phase: "idle" | "joining" | "connected" | "error";
  busy: boolean;
  error: string;
  note: string;
  network: WifiNetwork | null;
};
const EMPTY_JOIN_STATUS: JoinStatus = {
  phase: "idle",
  busy: false,
  error: "",
  note: "",
  network: null,
};
let joinStatus = EMPTY_JOIN_STATUS;
const joinListeners = new Set<() => void>();
const clearUnusedJoin = () => {
  void Promise.resolve().then(() => {
    if (!joinListeners.size && !joinStatus.busy) joinStatus = EMPTY_JOIN_STATUS;
  });
};
const subscribeJoin = (listener: () => void) => {
  joinListeners.add(listener);
  return () => {
    joinListeners.delete(listener);
    if (!joinListeners.size) clearUnusedJoin();
  };
};
const getJoinStatus = () => joinStatus;
const setJoinStatus = (next: JoinStatus) => {
  joinStatus = next;
  joinListeners.forEach((listener) => listener());
  if (!joinListeners.size) clearUnusedJoin();
};

export function WifiControl({ online, inline = false }: { online: boolean; inline?: boolean }) {
  const [scan, setScan] = useState<WifiScan | null>(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<WifiNetwork | null>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const {
    phase,
    busy,
    error,
    note,
    network: joiningNetwork,
  } = useSyncExternalStore(subscribeJoin, getJoinStatus, () => EMPTY_JOIN_STATUS);
  const joiningSsid = joiningNetwork?.ssid;
  const [scanError, setScanError] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);
  const scanRef = useRef<Promise<WifiScan | null> | null>(null);
  const rescanRef = useRef<Promise<WifiScan | null> | null>(null);
  const [rescanning, setRescanning] = useState(false);
  const refreshTimerRef = useRef<number | null>(null);
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

  const refresh = useCallback((force = false): Promise<WifiScan | null> => {
    if (scanRef.current) return scanRef.current;
    if (!window.__TAURI__) {
      if (mountedRef.current) setScan(UNSUPPORTED_SCAN);
      return Promise.resolve(null);
    }
    const statusAtStart = joinStatus;
    const request = window.__TAURI__.core
      .invoke<WifiScan>("scan_wifi", { refresh: force })
      .then((next) => {
        if (mountedRef.current) {
          setScan(next ?? UNSUPPORTED_SCAN);
          setScanError("");
          if (
            joinStatus === statusAtStart &&
            next?.current === joinStatus.network?.ssid &&
            joinStatus.phase === "joining" &&
            !joinStatus.busy
          ) {
            setJoinStatus({
              phase: "connected",
              busy: false,
              error: "",
              note: `Connected to ${next.current}.`,
              network: joinStatus.network,
            });
          } else if (
            joinStatus === statusAtStart &&
            joinStatus.phase === "connected" &&
            next?.supported &&
            (!next.connected || (next.current && next.current !== joinStatus.network?.ssid))
          ) {
            setJoinStatus(EMPTY_JOIN_STATUS);
          }
        }
        return next ?? null;
      })
      .catch((error: unknown) => {
        if (mountedRef.current) {
          setScan((previous) => previous ?? UNSUPPORTED_SCAN);
          setScanError(
            typeof error === "string"
              ? error
              : "Could not load Wi-Fi networks. Rescan to try again."
          );
        }
        return null;
      })
      .finally(() => {
        scanRef.current = null;
      });
    scanRef.current = request;
    return request;
  }, []);

  const rescan = useCallback(() => {
    if (rescanRef.current) return rescanRef.current;
    setRescanning(true);
    // A manual request must follow an in-flight cached read, not reuse its stale result.
    const request = (scanRef.current ?? Promise.resolve(null))
      .then(() => (mountedRef.current ? refresh(true) : null))
      .finally(() => {
        rescanRef.current = null;
        if (mountedRef.current) setRescanning(false);
      });
    rescanRef.current = request;
    return request;
  }, [refresh]);

  useEffect(() => {
    mountedRef.current = true;
    // One scan on mount, to learn whether this machine can list networks at
    // all, so an unsupported environment never displays invented networks.
    void refresh();
    return () => {
      mountedRef.current = false;
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
    };
  }, [refresh]);

  useEffect(() => {
    if ((inline && (busy || note)) || error) setOpen(true);
  }, [inline, busy, error, note]);

  useEffect(() => {
    if (phase === "connected" && joiningSsid && (!selected || selected.ssid === joiningSsid)) {
      setSelected(null);
      setPassword("");
      setShowPassword(false);
    }
  }, [phase, joiningSsid, selected]);

  useEffect(() => {
    // Read status only while visible or offline. Only manual Rescan requests
    // a Windows radio scan, which can temporarily increase network latency.
    if (!window.__TAURI__ || (!open && online)) return;
    const id = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [open, online, refresh]);

  useEffect(() => {
    if (!open || inline) return;
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
  }, [open, inline]);

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

  if (!scan) return null;
  const nativeAvailable = Boolean(window.__TAURI__);

  const join = async (network: WifiNetwork, secret: string) => {
    if (joinStatus.busy) return;
    setJoinStatus({
      phase: "joining",
      busy: true,
      error: "",
      note: `Joining ${network.ssid}…`,
      network,
    });
    try {
      if (!window.__TAURI__ || !scan.supported) {
        throw new Error("Changing network is not supported here.");
      }
      const confirmed = await window.__TAURI__.core.invoke<boolean>("connect_wifi", {
        ssid: network.ssid,
        password: secret || null,
      });
      setJoinStatus({
        phase: confirmed === true ? "connected" : "joining",
        busy: false,
        error: "",
        note: confirmed === true ? `Connected to ${network.ssid}.` : `Joining ${network.ssid}…`,
        network,
      });
      // Other platforms may accept a join before association finishes.
      if (mountedRef.current) {
        if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = window.setTimeout(() => {
          refreshTimerRef.current = null;
          void refresh();
        }, 2500);
      }
    } catch (caught) {
      setJoinStatus({
        phase: "error",
        busy: false,
        note: "",
        network,
        error:
          typeof caught === "string"
            ? caught
            : caught instanceof Error
              ? caught.message
              : "Could not join that network.",
      });
    } finally {
      if (joinStatus.busy) setJoinStatus({ ...joinStatus, busy: false });
    }
  };

  const passwordNetwork =
    selected ??
    (inline && phase !== "connected" && joiningNetwork?.secured ? joiningNetwork : null);
  const Icon = online ? Wifi : WifiOff;
  const label = scan.supported
    ? scan.current
      ? `Network: ${scan.current}`
      : scan.connected
        ? "Connected to Wi-Fi (name unavailable)"
        : "Not connected to Wi-Fi"
    : `Network connection: ${online ? "online" : "offline"}`;

  return (
    <VStack
      ref={rootRef}
      gap={2}
      style={{
        position: "relative",
        flexShrink: 0,
        minWidth: 0,
        width: inline ? "100%" : undefined,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={inline && scan.supported ? `Change network. ${label}` : label}
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
        {inline && (
          <Text type="supporting" color="secondary">
            {scan.supported ? "Change network" : "Network connection"}
          </Text>
        )}
      </button>

      {open && (
        <VStack
          gap={3}
          style={{
            ...(inline
              ? {
                  position: "relative" as const,
                  width: "100%",
                  maxHeight: "calc(var(--spacing-10) * 8)",
                }
              : {
                  position: "absolute" as const,
                  ...(menu.up
                    ? { bottom: "calc(100% + var(--spacing-2))" }
                    : { top: "calc(100% + var(--spacing-2))" }),
                  right: 0,
                  zIndex: 1200,
                  width: "calc(var(--spacing-10) * 7)",
                  maxWidth: "calc(100vw - var(--spacing-8))",
                  maxHeight: `${menu.maxHeight}px`,
                }),
            minWidth: 0,
            flexShrink: 0,
            boxSizing: "border-box",
            overflowY: "auto",
            padding: "var(--spacing-3)",
            background: "var(--color-background-card)",
            border: "var(--border-width) solid var(--color-border)",
            borderRadius: "var(--radius-container)",
            boxShadow: "var(--shadow-high)",
          }}
        >
          <HStack justify="between" align="center">
            <Text type="supporting" color="secondary">
              Wi-Fi
            </Text>
            {nativeAvailable && (
              <button
                type="button"
                onClick={() => void rescan()}
                aria-label="Rescan networks"
                aria-busy={rescanning}
                disabled={rescanning || busy}
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
            )}
          </HStack>

          {error && (
            <Text role="alert" color="inherit" style={{ color: "var(--color-text-error)" }}>
              {error}
            </Text>
          )}
          {note && !error && (
            <Text role="status" type="supporting" color="secondary">
              {note}
            </Text>
          )}

          {scan.supported && scan.connected && !scan.current && (
            <Text type="supporting" color="secondary">
              Connected to Wi-Fi (name unavailable)
            </Text>
          )}
          {!scan.supported && !scanError && (
            <Text type="supporting" color="secondary">
              {nativeAvailable
                ? "Wi-Fi controls are unavailable on this device. Use your device’s Wi-Fi settings to view or change networks."
                : "Your browser cannot list Wi-Fi networks or identify the connected network. Use your device’s Wi-Fi settings to view or change networks."}
            </Text>
          )}
          {scanError && (
            <Text role="alert" type="supporting" color="secondary">
              {scanError}
            </Text>
          )}
          {scan.supported && scan.networks.length === 0 && (
            <Text type="supporting" color="secondary">
              No Wi-Fi networks reported by your device. Rescan to try again.
            </Text>
          )}

          {passwordNetwork && (
            <VStack gap={2}>
              <Text type="supporting">{passwordNetwork.ssid}</Text>
              <HStack
                align="center"
                gap={1}
                style={{
                  width: "100%",
                  borderRadius: "var(--radius-control)",
                  border: "var(--border-width) solid var(--color-border)",
                  background: "var(--color-background-page)",
                  paddingRight: "var(--spacing-1)",
                }}
              >
                <style>{".access-wifi-password::-ms-reveal { display: none; }"}</style>
                <input
                  className="access-wifi-password"
                  type={showPassword ? "text" : "password"}
                  aria-label={`Password for ${passwordNetwork.ssid}`}
                  autoFocus
                  disabled={busy}
                  value={password}
                  placeholder="Network password"
                  onChange={(event) => setPassword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void join(passwordNetwork, password);
                  }}
                  style={{
                    minWidth: 0,
                    flex: 1,
                    padding: "var(--spacing-2)",
                    borderRadius: "var(--radius-control)",
                    border: "none",
                    background: "transparent",
                    color: "var(--color-text-primary)",
                  }}
                />
                <IconButton
                  label={showPassword ? "Hide password" : "Show password"}
                  tooltip={showPassword ? "Hide password" : "Show password"}
                  icon={showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowPassword((shown) => !shown)}
                />
              </HStack>
              <HStack gap={2} justify="end">
                <Button
                  label="Cancel"
                  variant="secondary"
                  isDisabled={busy}
                  onClick={() => {
                    setSelected(null);
                    setPassword("");
                    setShowPassword(false);
                    setJoinStatus(EMPTY_JOIN_STATUS);
                  }}
                />
                <Button
                  label={busy ? "Joining…" : "Join"}
                  variant="primary"
                  isDisabled={busy}
                  onClick={() => void join(passwordNetwork, password)}
                />
              </HStack>
            </VStack>
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
                    setShowPassword(false);
                    setJoinStatus(EMPTY_JOIN_STATUS);
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
                <Text
                  color={network.current ? "primary" : "secondary"}
                  wordBreak="break-word"
                  style={{ minWidth: 0, overflowWrap: "anywhere", flex: 1 }}
                >
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
            </VStack>
          ))}
        </VStack>
      )}
    </VStack>
  );
}
