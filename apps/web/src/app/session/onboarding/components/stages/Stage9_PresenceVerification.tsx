import { useEffect, useRef, useState } from "react";
import { loadPresenceDetector, samplePresence, type PresenceSample } from "@/lib/presence-monitor";
import {
  SAMPLE_COUNT,
  SAMPLE_INTERVAL_MS,
  decidePresence,
  isPresencePass,
  presenceMessage,
  type PresenceVerdict,
} from "../../presence-check";
import { StageHeader, StatusBadge } from "../ui";

/**
 * Presence check.
 *
 * This used to be two `setTimeout`s: `confirmed` at 1200 ms, advance at 2000,
 * and the words "Presence confirmed" / "Identity verified" underneath. It said
 * that with `stream` null. `presence-monitor.ts` — the BlazeFace pipeline that
 * does this for real, every 30 s, once the contest is running — was already in
 * the codebase and had exactly one consumer, the contest room. So the check
 * the candidate is told they passed on the way in was the only place not
 * performing it.
 *
 * The verdict rules live in `presence-check.ts` so they can be tested.
 */
export function Stage9_PresenceVerification({
  stream,
  onPass,
  onWarn,
}: {
  stream: MediaStream | null;
  onPass(): void;
  onWarn(): void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [taken, setTaken] = useState(0);
  const [verdict, setVerdict] = useState<PresenceVerdict | null>(null);

  useEffect(() => {
    if (!stream || !videoRef.current) return;
    videoRef.current.srcObject = stream;
    videoRef.current.play().catch(() => {});
  }, [stream]);

  useEffect(() => {
    let cancelled = false;
    // The advance callbacks are read through a ref-free closure captured once;
    // `settle` is called exactly once and the effect is keyed on `stream`
    // alone, so a re-render cannot double-advance the stage.
    let settled = false;
    const settle = (result: PresenceVerdict) => {
      if (cancelled || settled) return;
      settled = true;
      setVerdict(result);
      setTimeout(() => {
        if (!cancelled) (isPresencePass(result) ? onPass : onWarn)();
      }, 900);
    };

    async function run() {
      // No camera at all is a measurement we could not take, not an absence.
      if (!stream) {
        settle("unknown");
        return;
      }

      let detector;
      try {
        detector = await loadPresenceDetector();
      } catch {
        // Model or backend unavailable. Say so rather than inventing a pass.
        settle("unknown");
        return;
      }
      if (cancelled) return;

      const canvas = (canvasRef.current ??= document.createElement("canvas"));
      const samples: (PresenceSample | null)[] = [];

      for (let i = 0; i < SAMPLE_COUNT; i++) {
        if (cancelled) return;
        const video = videoRef.current;
        let sample: PresenceSample | null = null;
        if (video) {
          try {
            sample = await samplePresence(video, detector, canvas);
          } catch {
            sample = null;
          }
        }
        samples.push(sample);
        if (!cancelled) setTaken(i + 1);
        if (i < SAMPLE_COUNT - 1) {
          await new Promise((r) => setTimeout(r, SAMPLE_INTERVAL_MS));
        }
      }

      settle(decidePresence(samples));
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [stream, onPass, onWarn]);

  const settled = verdict !== null;
  const passing = settled && isPresencePass(verdict);
  const borderColor = !settled
    ? "rgba(255,255,255,0.06)"
    : passing
      ? "rgba(34,197,94,0.4)"
      : "rgba(245,158,11,0.4)";

  return (
    <div className="flex flex-col items-center">
      <StageHeader label="Presence Check" />

      <div
        className="relative mb-6 overflow-hidden"
        style={{
          width: 240,
          height: 160,
          borderRadius: "var(--radius-sm)",
          border: `1px solid ${borderColor}`,
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
          color: !settled ? "rgba(255,255,255,0.58)" : passing ? "#22c55e" : "#f59e0b",
          fontWeight: 400,
          transition: "color var(--transition-standard)",
          marginBottom: "18px",
          maxWidth: 380,
          textAlign: "center",
          lineHeight: 1.6,
        }}
      >
        {settled
          ? presenceMessage(verdict)
          : `Looking for you — check ${Math.min(taken + 1, SAMPLE_COUNT)} of ${SAMPLE_COUNT}`}
      </p>

      <StatusBadge
        status={!settled ? "checking" : passing ? "pass" : "warn"}
        label={
          !settled
            ? "Checking live presence"
            : passing
              ? "Presence confirmed"
              : "Recorded for your proctor"
        }
      />
    </div>
  );
}
