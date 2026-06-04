"use client";

import { getThemeColors } from "./utils";
import { useFocusTrap } from "./hooks";

interface ResolveModalProps {
  isOpen: boolean;
  onClose: () => void;
  checkKey: string | null;
  theme: "dark" | "light";
}

export function ResolveModal({ isOpen, onClose, checkKey, theme }: ResolveModalProps) {
  if (!isOpen || !checkKey) return null;

  const c = getThemeColors(theme);

  const getDetails = () => {
    switch (checkKey) {
      case "restrictedApps":
        return {
          title: "Close Conflicting Applications",
          desc: "Security protocol requires all screen recording, sharing, or development side-applications (e.g., Discord, Zoom, OBS Studio, Teams) to be closed completely. Please terminate these background processes using Task Manager / System Monitor to resume system readiness.",
        };
      case "camera":
        return {
          title: "Webcam Access Requirement",
          desc: "The system cannot detect a live video source. Please confirm your webcam is plugged in securely, verify that other applications (like Skype or Zoom) are not locking the feed, and check browser camera permissions in your operating system settings.",
        };
      case "mic":
        return {
          title: "Audio Device Connection",
          desc: "The audio hardware check failed. Please ensure your microphone is plugged in, is not muted at the physical hardware level, and is allowed inside your system privacy preferences.",
        };
      case "network":
        return {
          title: "Stabilize Network Connectivity",
          desc: "High network latency, packet loss, or host blocking was detected. Please switch to a wired Ethernet connection if possible, disable running VPN clients, and ensure your router allows standard HTTPS websockets.",
        };
      case "keyboard":
        return {
          title: "Configure OS Keyboard Shortcuts",
          desc: "Standard browser window shortcuts are restricted during this session. If you are using custom window managers or keys (like i3, AutoHotkey, or keyboard remappers), please temporarily disable them.",
        };
      default:
        return {
          title: "Environment Verification Error",
          desc: "The sandbox system detected a virtualized environment or unauthorized platform. Please close any hypervisors (e.g., VirtualBox, VMware) and boot into your native desktop environment.",
        };
    }
  };

  const info = getDetails();
  const dialogRef = useFocusTrap<HTMLDivElement>(isOpen, onClose);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="resolve-modal-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(3,8,22,0.6)",
        backdropFilter: "blur(16px)",
        animation: "fadeIn 280ms var(--ease-cinematic) forwards",
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        style={{
          maxWidth: "460px",
          width: "100%",
          borderRadius: "16px",
          padding: "36px 32px",
          background: theme === "light" ? "#ffffff" : "rgba(15, 23, 42, 0.95)",
          border: `1px solid ${c.border}`,
          boxShadow: "0 24px 64px rgba(0, 0, 0, 0.35)",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: "48px",
            height: "48px",
            borderRadius: "50%",
            background: "rgba(245, 158, 11, 0.1)",
            border: "1px solid rgba(245, 158, 11, 0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 20px",
          }}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#f59e0b"
            strokeWidth="1.8"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" strokeLinecap="round" strokeWidth="2.5" />
          </svg>
        </div>
        <h3
          id="resolve-modal-title"
          className="text-subsection-title"
          style={{ color: c.text, marginBottom: "12px" }}
        >
          {info.title}
        </h3>
        <p
          className="text-body-copy"
          style={{ color: c.textMutedStrong, lineHeight: 1.6, marginBottom: "28px" }}
        >
          {info.desc}
        </p>
        <button
          type="button"
          onClick={onClose}
          style={{
            width: "100%",
            padding: "12px",
            background: theme === "light" ? "#302a3b" : "#ffffff",
            color: theme === "light" ? "#ffffff" : "#0f172a",
            border: "none",
            borderRadius: "6px",
            fontWeight: 600,
            fontSize: "12px",
            cursor: "pointer",
            transition: "opacity 200ms",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
        >
          Close Resolution Guide
        </button>
      </div>
    </div>
  );
}
