import { type RefObject } from "react";

export interface LockGraceToastProps {
  lockGraceCountdown: number;
}

export function LockGraceToast({ lockGraceCountdown }: LockGraceToastProps) {
  return (
    <div
      style={{
        position: "fixed",
        top: "24px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: "var(--modal-z-base)",
        width: "100%",
        maxWidth: "460px",
        padding: "16px 20px",
        borderRadius: "12px",
        background: "rgba(30, 9, 9, 0.95)",
        backdropFilter: "blur(12px)",
        border: "1px solid rgba(239, 68, 68, 0.4)",
        boxShadow: "0 10px 40px rgba(239, 68, 68, 0.15)",
        display: "flex",
        alignItems: "center",
        gap: "14px",
        animation: "fadeIn 250ms var(--ease-cinematic) forwards",
      }}
    >
      <div
        style={{
          width: "36px",
          height: "36px",
          borderRadius: "50%",
          background: "rgba(239, 68, 68, 0.15)",
          border: "1px solid rgba(239, 68, 68, 0.3)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#fca5a5"
          strokeWidth="1.8"
        >
          <path
            d="M12 9v4m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div style={{ flex: 1 }}>
        <h4 style={{ fontSize: "13px", fontWeight: 600, color: "#fca5a5", marginBottom: "2px" }}>
          Restricted Application Detected
        </h4>
        <p style={{ fontSize: "11px", color: "#fca5a5", opacity: 0.8, lineHeight: 1.4 }}>
          Workspace locking in{" "}
          <span style={{ fontWeight: 700, fontFamily: "monospace", fontSize: "12px" }}>
            {lockGraceCountdown}s
          </span>
          . Please save your work immediately.
        </p>
      </div>
    </div>
  );
}

export interface BlockedAppsOverlayProps {
  lockViolationDialogRef: RefObject<HTMLDivElement | null>;
  blockedApps: string[];
}

export function BlockedAppsOverlay({
  lockViolationDialogRef,
  blockedApps,
}: BlockedAppsOverlayProps) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-live="assertive"
      aria-labelledby="blocked-app-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: "var(--modal-z-critical)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(2,4,10,0.9)",
        backdropFilter: "blur(16px)",
      }}
    >
      <div
        ref={lockViolationDialogRef}
        tabIndex={-1}
        style={{
          maxWidth: "440px",
          width: "100%",
          borderRadius: "20px",
          padding: "36px 32px",
          background: "rgba(30,9,9,0.4)",
          border: "1px solid rgba(239, 68, 68, 0.25)",
          boxShadow: "0 0 60px rgba(239, 68, 68, 0.12)",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: "56px",
            height: "56px",
            borderRadius: "50%",
            background: "rgba(239, 68, 68, 0.1)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 20px",
          }}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#f87171"
            strokeWidth="1.8"
          >
            <path
              d="M12 9v4m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <p
          id="blocked-app-title"
          style={{
            fontSize: "17px",
            fontWeight: 600,
            color: "#fca5a5",
            marginBottom: "8px",
            letterSpacing: "-0.01em",
          }}
        >
          Restricted Application Detected
        </p>
        <p style={{ fontSize: "13px", color: "#94a3b8", marginBottom: "24px", lineHeight: 1.6 }}>
          To maintain exam security, please close the applications listed below.
        </p>
        <div style={{ marginBottom: "24px" }}>
          {blockedApps.map((app) => (
            <div
              key={app}
              style={{
                padding: "10px 16px",
                marginBottom: "8px",
                borderRadius: "10px",
                background: "rgba(239, 68, 68, 0.06)",
                border: "1px solid rgba(239, 68, 68, 0.15)",
                fontSize: "14px",
                color: "#f87171",
                fontWeight: 500,
              }}
            >
              {app}
            </div>
          ))}
        </div>
        <p style={{ fontSize: "12px", color: "#475569" }}>
          This dialog will dismiss automatically once the app is closed.
        </p>
      </div>
    </div>
  );
}
