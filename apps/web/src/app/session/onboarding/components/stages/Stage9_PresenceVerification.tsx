import { useEffect, useRef, useState } from "react";
import { CameraTimeoutError } from "@/lib/camera-readiness";
import {
  loadPresenceDetector,
  samplePresence,
  type PresenceDetector,
  type PresenceSample,
} from "@/lib/presence-monitor";
import {
  SAMPLE_COUNT,
  SAMPLE_INTERVAL_MS,
  decidePresence,
  isPresencePass,
  presenceMessage,
  type PresenceVerdict,
} from "../../presence-check";
import { StageHeader, StatusBadge } from "../ui";
import { VStack } from "@astryxdesign/core/VStack";
import { Text } from "@astryxdesign/core/Text";

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
  onReferencePhoto,
  onPhotoFailure,
}: {
  stream: MediaStream | null;
  onPass(): void;
  onWarn(): void;
  onReferencePhoto?: (video: HTMLVideoElement | null) => Promise<boolean>;
  onPhotoFailure?: () => void;
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
    let detector: PresenceDetector | null = null;
    let advanceTimer: ReturnType<typeof setTimeout> | null = null;
    // Each effect visit settles once; cleanup discards late photo results.
    let settled = false;
    const settle = async (result: PresenceVerdict) => {
      if (cancelled || settled) return;
      settled = true;
      if (onReferencePhoto) {
        let saved = false;
        try {
          saved = isPresencePass(result) && (await onReferencePhoto(videoRef.current));
        } catch {
          // Any capture or upload failure must run the full face scan.
        }
        if (cancelled) return;
        if (!saved) {
          onPhotoFailure?.();
          return;
        }
      }
      setVerdict(result);
      advanceTimer = setTimeout(() => {
        if (!cancelled) (isPresencePass(result) ? onPass : onWarn)();
      }, 900);
    };

    async function run() {
      // No camera at all is a measurement we could not take, not an absence.
      if (!stream) {
        await settle("unknown");
        return;
      }

      try {
        detector = await loadPresenceDetector();
      } catch {
        // Model or backend unavailable. Say so rather than inventing a pass.
        await settle("unknown");
        return;
      }
      if (cancelled) {
        detector.dispose?.();
        detector = null;
        return;
      }

      const canvas = (canvasRef.current ??= document.createElement("canvas"));
      const samples: (PresenceSample | null)[] = [];

      for (let i = 0; i < SAMPLE_COUNT; i++) {
        if (cancelled) return;
        const video = videoRef.current;
        let sample: PresenceSample | null = null;
        if (video) {
          try {
            sample = await samplePresence(video, detector, canvas);
          } catch (error) {
            if (error instanceof CameraTimeoutError) {
              // Do not overlap a second inference with an uncancellable one.
              await settle("unknown");
              return;
            }
            sample = null;
          }
        }
        samples.push(sample);
        if (!cancelled) setTaken(i + 1);
        if (i < SAMPLE_COUNT - 1) {
          await new Promise((r) => setTimeout(r, SAMPLE_INTERVAL_MS));
        }
      }

      // A majority presence verdict alone could photograph an empty final frame.
      await settle(
        onReferencePhoto && samples[samples.length - 1]?.status !== "presence_ok"
          ? "unknown"
          : decidePresence(samples)
      );
    }

    void run().finally(() => {
      detector?.dispose?.();
      detector = null;
    });
    return () => {
      cancelled = true;
      if (advanceTimer) clearTimeout(advanceTimer);
    };
  }, [stream, onPass, onWarn, onReferencePhoto, onPhotoFailure]);

  const settled = verdict !== null;
  const passing = settled && isPresencePass(verdict);
  const borderColor = !settled
    ? "var(--color-border)"
    : passing
      ? "var(--color-border-green)"
      : "var(--color-border-yellow)";

  return (
    <VStack gap={5} width="100%">
      <VStack gap={2}>
        <StageHeader label="Check your presence" />
        <Text color="secondary">
          Stay in view while we take a few brief samples. Keep your face visible and look toward the
          camera.
        </Text>
      </VStack>

      <VStack
        width="100%"
        maxWidth="calc(var(--spacing-10) * 12)"
        style={{
          position: "relative",
          aspectRatio: "3 / 2",
          overflow: "hidden",
          alignSelf: "center",
          background: "var(--color-background-surface)",
          borderRadius: "var(--radius-sm)",
          border: `var(--border-width) solid ${borderColor}`,
          transition: "border-color var(--transition-slow)",
        }}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }}
        />
      </VStack>

      <Text color="secondary">
        {settled
          ? presenceMessage(verdict)
          : `Looking for you — check ${Math.min(taken + 1, SAMPLE_COUNT)} of ${SAMPLE_COUNT}`}
      </Text>

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
    </VStack>
  );
}
