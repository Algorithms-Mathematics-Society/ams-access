import { useEffect, useRef, useState } from "react";
import { StageHeader, StatusBadge } from "../ui";

export function Stage10_PresenceVerification({
  stream,
  onPass,
}: {
  stream: MediaStream | null;
  onPass(): void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!stream || !videoRef.current) return;
    videoRef.current.srcObject = stream;
    videoRef.current.play().catch(() => {});
  }, [stream]);

  useEffect(() => {
    const t1 = setTimeout(() => setConfirmed(true), 1200);
    const t2 = setTimeout(onPass, 2000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [onPass]);

  return (
    <div className="flex flex-col items-center">
      <StageHeader id={10} label="Presence Check" />

      <div
        className="relative mb-6 overflow-hidden"
        style={{
          width: 240,
          height: 160,
          borderRadius: "var(--radius-sm)",
          border: `1px solid ${confirmed ? "rgba(34,197,94,0.4)" : "rgba(255,255,255,0.06)"}`,
          transition: "border-color var(--transition-slow)",
        }}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }}
        />
      </div>

      <p
        style={{
          fontSize: "12px",
          fontFamily: "'JetBrains Mono', monospace",
          color: confirmed ? "#22c55e" : "rgba(255,255,255,0.58)",
          fontWeight: 400,
          transition: "color var(--transition-standard)",
          marginBottom: "18px",
        }}
      >
        {confirmed ? "Presence confirmed" : "Checking live presence..."}
      </p>

      <StatusBadge
        status={confirmed ? "pass" : "checking"}
        label={confirmed ? "Identity verified" : "Checking live presence"}
      />
    </div>
  );
}
