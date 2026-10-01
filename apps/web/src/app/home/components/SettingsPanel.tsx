"use client";

import { useState, useEffect, useRef, useMemo, memo } from "react";
import type { Dispatch, SetStateAction } from "react";
import { AspectRatio } from "@astryxdesign/core/AspectRatio";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Selector } from "@astryxdesign/core/Selector";
import { Slider } from "@astryxdesign/core/Slider";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import {
  describeMediaError,
  getUserMediaWithTimeout,
  isCameraReleaseRaceError,
  sleep,
  CAMERA_RETRY_DELAY_MS,
  CAMERA_START_TIMEOUT_MS,
} from "./utils";
import { SettingsAbout, SettingsPermissions, SettingsSecurity } from "./SettingsDetails";
import type { ReadinessState, SecurityLogLevel, TelemetryQueryState } from "./types";

const settingsTabs = [
  { value: "hardware", label: "Hardware" },
  { value: "permissions", label: "Permissions" },
  { value: "security", label: "Security" },
  { value: "about", label: "About" },
] as const;

const settingsCardStyle = { border: 0, borderRadius: "var(--radius-container)", minWidth: 0 };

export const SettingsPanel = memo(function SettingsPanel({
  readiness,
  setReadiness,
  theme,
  onSecurityEvent,
  telemetry,
  refreshTelemetry,
}: {
  readiness: ReadinessState;
  setReadiness: Dispatch<SetStateAction<ReadinessState>>;
  theme: "dark" | "light";
  onSecurityEvent: (event: string, level?: SecurityLogLevel) => void;
  telemetry: TelemetryQueryState;
  refreshTelemetry: (force?: boolean, source?: string) => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<"hardware" | "permissions" | "security" | "about">(
    "hardware"
  );
  const [camStream, setCamStream] = useState<MediaStream | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCam, setSelectedCam] = useState("");
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const cameraTestInFlightRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [micLevel, setMicLevel] = useState(0);
  const [micActive, setMicActive] = useState(false);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const [speakerActive, setSpeakerActive] = useState(false);
  const [speakerVolume, setSpeakerVolume] = useState(50);
  const [speakerSuccess, setSpeakerSuccess] = useState<boolean | null>(null);

  const platformInfo = telemetry.platform;
  const lastScannedLabel = useMemo(
    () =>
      telemetry.lastScannedAt
        ? new Date(telemetry.lastScannedAt).toLocaleTimeString([], { hour12: false })
        : "not scanned",
    [telemetry.lastScannedAt]
  );

  const camStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  useEffect(() => {
    camStreamRef.current = camStream;
  }, [camStream]);
  useEffect(() => {
    micStreamRef.current = micStream;
  }, [micStream]);

  useEffect(() => {
    return () => {
      camStreamRef.current?.getTracks().forEach((track) => track.stop());
      micStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    if (camStream && videoRef.current) {
      videoRef.current.srcObject = camStream;
      videoRef.current.play().catch(() => {});
    }
  }, [camStream]);

  useEffect(() => {
    if (!camStream) return;
    const videoTrack = camStream.getVideoTracks()[0];
    if (!videoTrack) return;

    function handleTrackEnded() {
      setCamStream(null);
      setCameraError("Camera stream ended unexpectedly. Click to restart.");
      setReadiness((r) => ({ ...r, camera: "fail" }));
    }

    videoTrack.addEventListener("ended", handleTrackEnded);
    return () => {
      videoTrack.removeEventListener("ended", handleTrackEnded);
    };
  }, [camStream, setReadiness]);

  useEffect(() => {
    if (activeTab !== "hardware" && camStream) {
      camStream.getTracks().forEach((track) => track.stop());
      setCamStream(null);
    }
  }, [activeTab, camStream]);

  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((devices) => {
        setCameras(devices.filter((d) => d.kind === "videoinput"));
      })
      .catch(() => {});
    void refreshTelemetry(false, "SETTINGS");
  }, [refreshTelemetry]);

  async function runSecurityScan(force = false) {
    await refreshTelemetry(force, "SETTINGS");
  }

  async function startCameraTest() {
    if (cameraTestInFlightRef.current) return;
    cameraTestInFlightRef.current = true;
    setCameraBusy(true);
    setCameraError(null);

    try {
      if (camStream) {
        camStream.getTracks().forEach((track) => track.stop());
        setCamStream(null);
        await sleep(0);
      }

      const constraints: MediaStreamConstraints = {
        video: selectedCam
          ? { deviceId: { exact: selectedCam }, width: { ideal: 640 }, height: { ideal: 480 } }
          : { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
      };

      let stream: MediaStream | null = null;
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          stream = await getUserMediaWithTimeout(constraints, CAMERA_START_TIMEOUT_MS);
          break;
        } catch (err) {
          lastError = err;
          if (attempt === 1 || !isCameraReleaseRaceError(err)) break;
          await sleep(CAMERA_RETRY_DELAY_MS);
        }
      }

      if (!stream) throw lastError ?? new Error("Camera unavailable");

      setCamStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play().catch(() => {});
      }

      void navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => setCameras(devices.filter((d) => d.kind === "videoinput")))
        .catch(() => {});
      setReadiness((r) => ({ ...r, camera: "ok" }));
      onSecurityEvent("HARDWARE: Camera stream verified");
    } catch (err) {
      console.error("Camera setup failed", err);
      setCameraError(describeMediaError(err, "camera"));
      setReadiness((r) => ({ ...r, camera: "fail" }));
      onSecurityEvent("HARDWARE: Camera stream verification failed", "error");
    } finally {
      cameraTestInFlightRef.current = false;
      setCameraBusy(false);
    }
  }

  function getAspectRatioLabel(w: number, h: number) {
    if (w / h === 16 / 9) return "16:9 Widescreen";
    if (w / h === 4 / 3) return "4:3 Standard";
    return `${(w / h).toFixed(2)}:1`;
  }

  async function toggleMicMonitor() {
    if (micActive) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (micStream) {
        micStream.getTracks().forEach((track) => track.stop());
      }
      if (audioContextRef.current) {
        await audioContextRef.current.close().catch(() => {});
      }
      setMicStream(null);
      setMicLevel(0);
      setMicActive(false);
      onSecurityEvent("HARDWARE: Microphone monitor stopped");
    } else {
      try {
        setMicError(null);
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setMicStream(stream);

        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtx();
        audioContextRef.current = ctx;

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyserRef.current = analyser;

        const source = ctx.createMediaStreamSource(stream);
        source.connect(analyser);

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const drawMicStats = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
          }
          const average = sum / bufferLength;
          const scaledVal = Math.min(Math.round((average / 90) * 100), 100);
          setMicLevel(scaledVal);
          animationFrameRef.current = requestAnimationFrame(drawMicStats);
        };
        drawMicStats();
        setMicActive(true);
        setReadiness((r) => ({ ...r, mic: "ok" }));
        onSecurityEvent("HARDWARE: Microphone stream verified");
      } catch (err) {
        console.error("Microphone capture failed", err);
        setMicError(describeMediaError(err, "microphone"));
        setReadiness((r) => ({ ...r, mic: "fail" }));
        onSecurityEvent("HARDWARE: Microphone stream verification failed", "error");
      }
    }
  }

  function testSpeakers() {
    setSpeakerActive(true);
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(440, audioCtx.currentTime);

      const volFraction = speakerVolume / 100;
      gainNode.gain.setValueAtTime(volFraction * 0.08, audioCtx.currentTime);

      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      osc.start();
      setTimeout(() => {
        osc.stop();
        audioCtx.close().catch(() => {});
        setSpeakerActive(false);
      }, 850);
    } catch (e) {
      console.error(e);
      setSpeakerActive(false);
    }
  }

  // Display only measurements supplied by the active track, without invented defaults.
  const previewSettings = useMemo(() => camStream?.getVideoTracks()[0]?.getSettings(), [camStream]);

  return (
    <VStack gap={6} data-testid="settings-panel" style={{ minWidth: 0 }}>
      <TabList
        role="tablist"
        aria-label="Settings sections"
        value={activeTab}
        onChange={(value) => setActiveTab(value as typeof activeTab)}
        size="lg"
        hasDivider
      >
        {settingsTabs.map((tab) => (
          <Tab
            key={tab.value}
            id={`settings-tab-${tab.value}`}
            role="tab"
            // Astryx 0.1.8 stamps aria-current after consumer props. These are
            // in-page tabs, so remove its navigation-only state after each commit.
            ref={(node) => {
              node?.removeAttribute("aria-current");
            }}
            aria-selected={activeTab === tab.value}
            aria-controls={`settings-panel-${tab.value}`}
            value={tab.value}
            label={tab.label}
            style={{ paddingInline: "clamp(var(--spacing-1), 1vw, var(--spacing-3))" }}
          />
        ))}
      </TabList>

      {micActive && activeTab !== "hardware" && (
        <HStack gap={3} wrap="wrap" justify="between" align="center">
          <HStack gap={2} align="center" role="status">
            <StatusDot variant="success" label="Microphone is running" />
            <Text type="supporting">Microphone is running</Text>
          </HStack>
          <Button
            label="Manage microphone"
            variant="ghost"
            onClick={() => {
              setActiveTab("hardware");
              requestAnimationFrame(() =>
                document.getElementById("settings-microphone-control")?.focus()
              );
            }}
          />
        </HStack>
      )}

      {settingsTabs.map((tab) => (
        <VStack
          key={tab.value}
          gap={6}
          role="tabpanel"
          id={`settings-panel-${tab.value}`}
          aria-labelledby={`settings-tab-${tab.value}`}
          tabIndex={0}
          hidden={activeTab !== tab.value}
          style={{ minWidth: 0, display: activeTab === tab.value ? undefined : "none" }}
        >
          {tab.value === "hardware" && activeTab === "hardware" && (
            <>
              <Card padding={6} aria-labelledby="settings-camera-heading" style={settingsCardStyle}>
                <VStack gap={5}>
                  <HStack gap={3} justify="between" align="start" wrap="wrap">
                    <VStack gap={2} style={{ flex: 1, minWidth: 0 }}>
                      <Heading level={4} accessibilityLevel={2} id="settings-camera-heading">
                        Camera
                      </Heading>
                      <Text type="supporting">Check your framing before entering a contest.</Text>
                    </VStack>
                    <Token
                      label={
                        cameraBusy
                          ? "Starting"
                          : camStream
                            ? "Preview live"
                            : cameraError
                              ? "Needs attention"
                              : "Preview off"
                      }
                      color={camStream ? "green" : cameraError ? "red" : "gray"}
                      size="sm"
                    />
                  </HStack>
                  <HStack gap={6} wrap="wrap" align="start">
                    <VStack
                      gap={2}
                      style={{ flex: "1.35 1 calc(var(--spacing-10) * 10)", minWidth: 0 }}
                    >
                      <AspectRatio
                        ratio={16 / 9}
                        fit={camStream ? "cover" : "center"}
                        aria-label="Camera preview"
                        style={{
                          width: "100%",
                          borderRadius: "var(--radius-container)",
                          background: "var(--color-background-body)",
                          overflow: "hidden",
                        }}
                      >
                        {camStream ? (
                          <video
                            ref={videoRef}
                            muted
                            playsInline
                            autoPlay
                            aria-label="Mirrored camera preview"
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                              transform: "scaleX(-1)",
                            }}
                          />
                        ) : (
                          <VStack gap={2} padding={4} align="center">
                            <Text weight="medium" justify="center">
                              {cameraBusy ? "Starting your camera…" : "Your camera preview"}
                            </Text>
                            <Text type="supporting" justify="center">
                              {cameraBusy
                                ? "Allow camera access if prompted."
                                : "Start the camera to check your framing."}
                            </Text>
                          </VStack>
                        )}
                      </AspectRatio>
                      <Text type="supporting">Your preview is mirrored.</Text>
                    </VStack>
                    <VStack
                      gap={4}
                      style={{ flex: "1 1 calc(var(--spacing-10) * 8)", minWidth: 0 }}
                    >
                      <Selector
                        label="Camera"
                        value={selectedCam}
                        onChange={setSelectedCam}
                        width="100%"
                        renderOption={(option) => (
                          <Text
                            maxLines={3}
                            style={{
                              minWidth: 0,
                              maxWidth:
                                "min(calc(var(--spacing-10) * 8), calc(100vw - var(--spacing-10) * 3))",
                              overflowWrap: "anywhere",
                              whiteSpace: "normal",
                            }}
                          >
                            {option.label ?? option.value}
                          </Text>
                        )}
                        options={[
                          { value: "", label: "System default" },
                          ...cameras
                            .filter((camera) => camera.deviceId)
                            .map((camera, index) => ({
                              value: camera.deviceId,
                              label: camera.label || `Camera ${index + 1}`,
                            })),
                        ]}
                      />
                      <HStack gap={2} wrap="wrap">
                        <Button
                          label={
                            cameraBusy ? "Starting…" : camStream ? "Restart camera" : "Start camera"
                          }
                          onClick={() => startCameraTest()}
                          isDisabled={cameraBusy}
                          variant="secondary"
                        />
                        <Button
                          label="Refresh cameras"
                          variant="ghost"
                          onClick={() =>
                            void navigator.mediaDevices
                              ?.enumerateDevices()
                              .then((ds) => setCameras(ds.filter((d) => d.kind === "videoinput")))
                              .catch(() => {})
                          }
                        />
                      </HStack>
                      <Text type="supporting">
                        Position your face in the frame with light in front of you. If you choose
                        another camera, restart the preview to use it.
                      </Text>
                      {cameraError && (
                        <Banner
                          status="error"
                          title="Camera needs attention"
                          description={`${cameraError}. Run the app as your normal desktop user and close other apps using the camera.`}
                        />
                      )}
                      {camStream && (
                        <MetadataList orientation="horizontal">
                          <MetadataListItem label="Resolution">
                            {previewSettings?.width && previewSettings?.height
                              ? `${previewSettings.width} × ${previewSettings.height}`
                              : "Not reported"}
                          </MetadataListItem>
                          <MetadataListItem label="Frame rate">
                            {previewSettings?.frameRate
                              ? `${Math.round(previewSettings.frameRate)} FPS`
                              : "Not reported"}
                          </MetadataListItem>
                          <MetadataListItem label="Aspect ratio">
                            {previewSettings?.width && previewSettings?.height
                              ? getAspectRatioLabel(previewSettings.width, previewSettings.height)
                              : "Not reported"}
                          </MetadataListItem>
                        </MetadataList>
                      )}
                    </VStack>
                  </HStack>
                </VStack>
              </Card>

              <HStack gap={6} wrap="wrap" align="stretch">
                <Card
                  padding={6}
                  aria-labelledby="settings-microphone-heading"
                  style={{ ...settingsCardStyle, flex: "1 1 calc(var(--spacing-10) * 8)" }}
                >
                  <VStack gap={5} height="100%">
                    <HStack gap={3} justify="between" align="start" wrap="wrap">
                      <VStack gap={2} style={{ flex: 1, minWidth: 0 }}>
                        <Heading level={4} accessibilityLevel={2} id="settings-microphone-heading">
                          Microphone
                        </Heading>
                        <Text type="supporting">
                          Speak normally and check that the input level moves.
                        </Text>
                      </VStack>
                      <Token
                        label={micActive ? "Listening" : "Off"}
                        color={micActive ? "green" : "gray"}
                        size="sm"
                      />
                    </HStack>
                    <ProgressBar
                      label="Input level"
                      value={micLevel}
                      max={100}
                      hasValueLabel
                      variant={micActive ? "success" : "neutral"}
                    />
                    {micError && (
                      <Banner
                        status="error"
                        title="Microphone needs attention"
                        description={micError}
                      />
                    )}
                    <HStack style={{ marginTop: "auto" }}>
                      <Button
                        id="settings-microphone-control"
                        label={micActive ? "Stop microphone" : "Start microphone"}
                        variant="secondary"
                        onClick={toggleMicMonitor}
                      />
                    </HStack>
                  </VStack>
                </Card>
                <Card
                  padding={6}
                  aria-labelledby="settings-speakers-heading"
                  style={{ ...settingsCardStyle, flex: "1 1 calc(var(--spacing-10) * 8)" }}
                >
                  <VStack gap={5} height="100%">
                    <HStack gap={3} justify="between" align="start" wrap="wrap">
                      <VStack gap={2} style={{ flex: 1, minWidth: 0 }}>
                        <Heading level={4} accessibilityLevel={2} id="settings-speakers-heading">
                          Speakers
                        </Heading>
                        <Text type="supporting">
                          Play a short tone, then confirm you can hear it.
                        </Text>
                      </VStack>
                      <Token
                        label={
                          speakerActive ? "Playing" : speakerSuccess ? "Confirmed" : "Not tested"
                        }
                        color={speakerSuccess ? "green" : "gray"}
                        size="sm"
                      />
                    </HStack>
                    <Slider
                      label="Test volume"
                      value={speakerVolume}
                      onChange={setSpeakerVolume}
                      min={0}
                      max={100}
                      valueDisplay="text"
                      formatValue={(value) => `${value}%`}
                    />
                    <HStack gap={2} wrap="wrap" style={{ marginTop: "auto" }}>
                      <Button
                        label={speakerActive ? "Playing…" : "Play test tone"}
                        variant="secondary"
                        onClick={testSpeakers}
                        isDisabled={speakerActive}
                      />
                      <Button
                        label="I heard the tone"
                        variant="ghost"
                        onClick={() => setSpeakerSuccess(true)}
                      />
                    </HStack>
                  </VStack>
                </Card>
              </HStack>
            </>
          )}
          {tab.value === "permissions" && activeTab === "permissions" && (
            <SettingsPermissions
              readiness={readiness}
              platform={platformInfo?.os ?? null}
              onSecurityEvent={onSecurityEvent}
            />
          )}
          {tab.value === "security" && activeTab === "security" && (
            <SettingsSecurity
              telemetry={telemetry}
              lastScannedLabel={lastScannedLabel}
              onScan={() => void runSecurityScan(true)}
            />
          )}
          {tab.value === "about" && activeTab === "about" && <SettingsAbout />}
        </VStack>
      ))}
    </VStack>
  );
});
