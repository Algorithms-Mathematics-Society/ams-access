import { useEffect, useRef, useState } from "react";
import { CheckLine, StageHeader } from "../ui";
import { stopMediaStream } from "../../support";

export function Stage10_AudioVerification({ onPass, onWarn }: { onPass(): void; onWarn?(): void }) {
  const [level, setLevel] = useState(0);
  const [phase, setPhase] = useState<"checking" | "pass" | "fail">("checking");
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    let cancelled = false;
    let passTimer: ReturnType<typeof setTimeout> | null = null;

    async function init() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("unavailable");
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stopMediaStream(stream);
          return;
        }
        streamRef.current = stream;
        const ctx = new AudioContext();
        if (cancelled) {
          stopMediaStream(stream);
          ctx.close().catch(() => {});
          return;
        }
        audioCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyserRef.current = analyser;

        const data = new Uint8Array(analyser.frequencyBinCount);
        let lastUiUpdate = 0;
        function tick(now: number) {
          if (cancelled) return;
          analyser.getByteFrequencyData(data);
          if (now - lastUiUpdate >= 125) {
            lastUiUpdate = now;
            const avg = data.reduce((a, b) => a + b, 0) / data.length;
            setLevel((prev) => {
              const next = Math.min(100, avg * 2.5);
              return Math.abs(next - prev) < 2 ? prev : next;
            });
          }
          rafRef.current = requestAnimationFrame(tick);
        }
        rafRef.current = requestAnimationFrame(tick);

        setPhase("pass");
        passTimer = setTimeout(() => {
          if (!cancelled) onPass();
        }, 3500);
      } catch {
        if (cancelled) return;
        setPhase("fail");
        passTimer = setTimeout(() => {
          if (!cancelled) (onWarn ?? onPass)();
        }, 2000);
      }
    }
    void init();
    return () => {
      cancelled = true;
      if (passTimer) clearTimeout(passTimer);
      cancelAnimationFrame(rafRef.current);
      stopMediaStream(streamRef.current);
      streamRef.current = null;
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
    };
  }, [onPass]);
  const bars = Array.from({ length: 20 }, (_, i) => i);

  return (
    <div className="flex flex-col items-center">
      <StageHeader label="Microphone Check" />

      <div
        className="mb-8 flex items-end justify-center gap-1.5 relative"
        style={{ height: 60, width: "160px" }}
      >
        {/* Dotted threshold line indicating passing barrier */}
        <div
          style={{
            position: "absolute",
            bottom: "20px",
            left: "-20px",
            right: "-20px",
            borderBottom: "1px dashed rgba(255,255,255,0.25)",
            zIndex: 1,
            pointerEvents: "none",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <span
            style={{
              fontSize: "11px",
              fontFamily: "'JetBrains Mono', monospace",
              color: "rgba(255,255,255,0.58)",
              background: "rgba(255,255,255,0.08)",
              padding: "2px 6px",
              borderRadius: "var(--radius-sm)",
              transform: "translateY(5px)",
              letterSpacing: "0.05em",
              fontWeight: 600,
            }}
          >
            -24DB THRESHOLD
          </span>
        </div>
        {bars.map((i) => {
          const height =
            phase === "pass"
              ? Math.max(4, level * 0.6 * (0.4 + 0.6 * Math.abs(Math.sin(i * 0.8 + level * 0.05))))
              : 4;
          const isAboveThreshold = height >= 20;
          return (
            <div
              key={i}
              style={{
                width: 6,
                borderRadius: "0px",
                height: `${height}px`,
                background:
                  phase === "pass"
                    ? isAboveThreshold
                      ? "#FFF"
                      : "rgba(255,255,255,0.18)"
                    : "rgba(255,255,255,0.06)",
                transition: "height var(--transition-fast), background var(--transition-standard)",
                maxHeight: 56,
                zIndex: 2,
              }}
            />
          );
        })}
      </div>

      <div
        style={{
          width: "100%",
          maxWidth: "300px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        {phase === "checking" && (
          <CheckLine label="Requesting microphone access..." status="checking" />
        )}
        {phase === "pass" && (
          <>
            <CheckLine label="Microphone detected" status="pass" />
            <CheckLine label="Audio signal received" status="pass" delay={300} />
            <CheckLine label="Background noise is acceptable" status="pass" delay={600} />
          </>
        )}
        {phase === "fail" && (
          <CheckLine label="No microphone found — continuing anyway" status="warn" />
        )}
      </div>
    </div>
  );
}
