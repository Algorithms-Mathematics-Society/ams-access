import { type RefObject } from "react";
import { Video, VideoOff, Mic, MicOff, AlertTriangle, Loader2 } from "lucide-react";

export interface CameraTileProps {
  cameraVideoRef: RefObject<HTMLVideoElement | null>;
  cameraStream: MediaStream | null;
  cameraError: string | null;
  sidebarCollapsed: boolean;
  cameraStatusLabel: string;
  cameraHealthy: boolean;
  cameraEnabled: boolean;
  micEnabled: boolean;
  handleToggleMedia: (type: "camera" | "mic", value: boolean) => void;
}

// ALWAYS MOUNTED — visibility is a display toggle (below), never a mount
// conditional. A webcam teardown mid-exam is a candidate-facing failure; the
// <video> element and its bound MediaStream must never unmount.
export function CameraTile({
  cameraVideoRef,
  cameraStream,
  cameraError,
  sidebarCollapsed,
  cameraStatusLabel,
  cameraHealthy,
  cameraEnabled,
  micEnabled,
  handleToggleMedia,
}: CameraTileProps) {
  return (
    <div
      title={cameraStatusLabel}
      style={{
        background: "#0F0F0F",
        position: "absolute",
        left: 0,
        bottom: 0,
        width: "220px",
        height: "150px",
        zIndex: 50,
        // Docked over the expanded rail's bottom; hidden (NOT unmounted) when the rail
        // collapses — <video> stays mounted, srcObject bound, tracks running (no teardown).
        display: (cameraStream ?? cameraError) && !sidebarCollapsed ? "flex" : "none",
        flexDirection: "column",
        border: "1px solid #1F1F1F",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "6px",
          right: "6px",
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          gap: "6px",
          // Scrim behind the toggles: the live feed behind them can be any
          // color (a bright wall, a light shirt), so the red/white icons
          // need guaranteed contrast independent of what's on camera.
          padding: "3px",
          borderRadius: "var(--radius-md)",
          background: "rgba(0,0,0,0.55)",
          backdropFilter: "blur(6px)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <button
          type="button"
          onClick={() => handleToggleMedia("camera", !cameraEnabled)}
          className={`ic-btn ${cameraEnabled ? "ic-btn-white" : "ic-btn-red"}`}
          title={cameraEnabled ? "Camera on — click to turn off" : "Camera off — click to turn on"}
          aria-label={cameraEnabled ? "Turn camera off" : "Turn camera on"}
        >
          {cameraEnabled ? (
            <Video size={15} strokeWidth={1.75} />
          ) : (
            <VideoOff size={15} strokeWidth={1.75} />
          )}
        </button>
        <button
          type="button"
          onClick={() => handleToggleMedia("mic", !micEnabled)}
          className={`ic-btn ${micEnabled ? "ic-btn-white" : "ic-btn-red"}`}
          title={
            micEnabled ? "Microphone on — click to turn off" : "Microphone off — click to turn on"
          }
          aria-label={micEnabled ? "Turn microphone off" : "Turn microphone on"}
        >
          {micEnabled ? (
            <Mic size={15} strokeWidth={1.75} />
          ) : (
            <MicOff size={15} strokeWidth={1.75} />
          )}
        </button>
      </div>
      <div
        style={{
          width: "100%",
          height: "100%",
          border: "none",
          boxSizing: "border-box",
          position: "relative",
        }}
      >
        <video
          ref={cameraVideoRef}
          muted
          playsInline
          autoPlay
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: "scaleX(-1)",
            display: "block",
            borderRadius: "0",
          }}
        />
      </div>
      {/* Camera health — announced via a content-based live region + a non-color visible
          cue. Healthy = silent/clean box (mockup look); a chip appears ONLY on a problem.
          ⚠ is reserved for a real fault — intentional-off gets a neutral icon, and the
          transient "Starting…" resolves to an announced "Camera active" so an SR user hears
          it clear rather than hearing "Starting…" stick. faceStatus/stream logic untouched. */}
      <div
        role="status"
        aria-live="polite"
        style={{
          position: "absolute",
          bottom: "6px",
          left: "6px",
          zIndex: 2,
          pointerEvents: "none",
        }}
      >
        {cameraHealthy ? (
          <span className="sr-only">Camera active</span>
        ) : (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              padding: "2px 6px",
              background: "#0F0F0F",
              border: "1px solid #1F1F1F",
              borderRadius: "4px",
              fontSize: "10px",
              fontWeight: 600,
              fontFamily: "Inter, system-ui, sans-serif",
              color: "#e2e8f0",
            }}
          >
            {!cameraEnabled ? (
              <VideoOff size={11} strokeWidth={2} aria-hidden="true" />
            ) : cameraError ? (
              <AlertTriangle size={11} strokeWidth={2} color="#f59e0b" aria-hidden="true" />
            ) : (
              <Loader2
                size={11}
                strokeWidth={2}
                aria-hidden="true"
                style={{ animation: "spin 1.2s linear infinite" }}
              />
            )}
            {!cameraEnabled ? "Off" : cameraError ? "Camera issue" : "Starting…"}
          </span>
        )}
      </div>
    </div>
  );
}
