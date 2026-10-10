import { useEffect, useRef, useState } from "react";
import { CheckLine, StageHeader } from "../ui";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/Stack";
import { SetupPermissionInfo } from "../SetupPermissionInfo";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { invoke, stopMediaStream } from "../../support";

export function Stage10_AudioVerification({
  onPass,
  onWarn,
}: {
  onPass(): void;
  onWarn?(detail: string): void;
}) {
  // macOS only: a missing microphone blocks entry. Other platforms keep the
  // advisory "continue with warning" behavior.
  const [isMac, setIsMac] = useState(false);
  const [missing, setMissing] = useState(false);
  const [level, setLevel] = useState(0);
  const [phase, setPhase] = useState<"checking" | "pass" | "fail">("checking");
  const [retryKey, setRetryKey] = useState(0);
  const warning =
    "Microphone access is unavailable. Allow microphone access in your system or browser settings, close other apps using it, then try again. If access remains unavailable, ask an invigilator. Continuing keeps this warning; contest entry requirements still apply.";
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    invoke<{ os: string }>("get_platform")
      .then((p) => setIsMac(p?.os?.toLowerCase().startsWith("mac") ?? false))
      .catch(() => {});
  }, []);

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
      } catch (err) {
        if (cancelled) return;
        setMissing(err instanceof DOMException && err.name === "NotFoundError");
        // A failed analyser must not keep the microphone open while the
        // candidate reads a persistent warning or decides whether to retry.
        cancelAnimationFrame(rafRef.current);
        stopMediaStream(streamRef.current);
        streamRef.current = null;
        audioCtxRef.current?.close().catch(() => {});
        audioCtxRef.current = null;
        analyserRef.current = null;
        setLevel(0);
        setPhase("fail");
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
  }, [onPass, retryKey]);

  return (
    <VStack gap={5} style={{ width: "100%", minWidth: 0 }}>
      <StageHeader label="Microphone check" />
      <Text color="secondary">
        We’re checking access to your microphone. Speak briefly to see input activity.
      </Text>
      <SetupPermissionInfo kind="microphone" />
      <Text type="supporting" color="secondary">
        Microphone input activity
      </Text>
      <ProgressBar
        label="Microphone input activity"
        isLabelHidden
        value={level}
        max={100}
        variant="accent"
        isDisabled={phase !== "pass"}
      />
      <Text type="supporting" color="secondary">
        The meter shows live input activity, not a sound-quality score.
      </Text>
      {phase === "checking" && (
        <CheckLine label="Requesting microphone access…" status="checking" />
      )}
      {phase === "pass" && <CheckLine label="Microphone access granted" status="pass" />}
      {phase === "fail" && (
        <VStack gap={3}>
          <CheckLine label="Microphone access unavailable" status="warn" />
          <Text color="secondary">
            {isMac
              ? missing
                ? "No microphone was found. Connect a microphone, then try again. A microphone is required to enter the contest."
                : "Microphone access is unavailable. Allow microphone access in System Settings, then try again. A microphone is required to enter the contest."
              : warning}
          </Text>
          {isMac && !missing && (
            <Text color="secondary">
              After allowing microphone access, macOS requires AMS Access to be quit and reopened
              before the change takes effect. Relaunch the app, then continue setup.
            </Text>
          )}
          <HStack gap={3} wrap="wrap">
            <Button
              label="Try microphone again"
              variant="secondary"
              onClick={() => {
                setPhase("checking");
                setLevel(0);
                setRetryKey((key) => key + 1);
              }}
            />
            {isMac && !missing && (
              <Button
                label="Open System Settings"
                variant="primary"
                onClick={() =>
                  void invoke("open_privacy_settings", { section: "microphone" }).catch(() => {})
                }
              />
            )}
            {!isMac && (
              <Button
                label="Continue with warning"
                variant="primary"
                onClick={() => (onWarn ? onWarn(warning) : onPass())}
              />
            )}
          </HStack>
        </VStack>
      )}
    </VStack>
  );
}
