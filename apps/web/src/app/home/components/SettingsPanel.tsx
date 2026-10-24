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
import { describeMediaError, getUserMediaWithTimeout, CAMERA_START_TIMEOUT_MS } from "./utils";
import { SettingsAbout, SettingsPermissions, SettingsSecurity } from "./SettingsDetails";
import type { ReadinessState, SecurityLogLevel, TelemetryQueryState } from "./types";
import { createMediaRequestOwner } from "./media-availability";
import { cameraSession, isTrackDelivering } from "@/lib/camera-session";
import { startCameraPreview } from "@/lib/camera-readiness";
import { useCameraDevices } from "@/lib/use-camera-devices";
import { useAppVersion } from "@/lib/use-app-version";
import { watchCameraFrameProgress } from "@/lib/camera-frame-progress";

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
  const { version } = useAppVersion();
  const [activeTab, setActiveTab] = useState<"hardware" | "permissions" | "security" | "about">(
    "hardware"
  );
  const [camStream, setCamStream] = useState<MediaStream | null>(null);
  const { state: cameraListing, refresh: refreshCameras } = useCameraDevices();
  const cameras = cameraListing.devices;
  const [selectedCam, setSelectedCam] = useState("");
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [framesStalled, setFramesStalled] = useState(false);
  const cameraRequestOwner = useRef(createMediaRequestOwner());
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraOpeningRef = useRef(false);
  const cameraStartedAt = useRef(0);

  const [micLevel, setMicLevel] = useState(0);
  const [micActive, setMicActive] = useState(false);
  const [micPending, setMicPending] = useState(false);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const micResources = useRef(createMediaRequestOwner());

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
  useEffect(() => {
    camStreamRef.current = camStream;
  }, [camStream]);

  useEffect(() => {
    return () => {
      cameraRequestOwner.current.cancel();
      micResources.current.cancel(cancelAnimationFrame);
      if (cameraOpeningRef.current) cameraSession.releaseVideo();
      else if (camStreamRef.current) cameraSession.releaseVideo(camStreamRef.current);
      camStreamRef.current = null;
    };
  }, []);

  useEffect(() => {
    setSelectedCam(cameraSession.preferredVideoDevice() ?? "");
  }, []);

  useEffect(() => {
    if (!camStream || !videoRef.current) return;
    let cancelled = false;
    const stream = camStream;
    const video = videoRef.current;
    setFramesStalled(false);
    const stopWatchingFrames = watchCameraFrameProgress(video, (stalled) => {
      if (cancelled || camStreamRef.current !== stream) return;
      setFramesStalled(stalled);
      onSecurityEvent(
        `HARDWARE: Camera frame progress ${stalled ? "stalled" : "resumed"}`,
        stalled ? "warn" : "info"
      );
    });
    void startCameraPreview(video, stream)
      .then(() => {
        if (cancelled || camStreamRef.current !== stream) return;
        if (!stream.getVideoTracks().some(isTrackDelivering))
          throw new Error("Camera is not delivering frames");
        setCameraBusy(false);
        setReadiness((r) => ({ ...r, camera: "ok" }));
        onSecurityEvent(
          `HARDWARE: Camera preview verified (${Math.round(performance.now() - cameraStartedAt.current)} ms)`
        );
      })
      .catch((error) => {
        if (cancelled || camStreamRef.current !== stream) return;
        setCameraBusy(false);
        setCameraError(
          "Camera opened, but usable frames did not arrive. Check the shutter or choose another camera."
        );
        setReadiness((r) => ({ ...r, camera: "fail" }));
        onSecurityEvent("HARDWARE: Camera preview unavailable", "error");
      });
    const lost = () => {
      if (cancelled || camStreamRef.current !== stream) return;
      setCameraError(
        "The camera stopped delivering frames. Reconnect it or choose another camera."
      );
      setCameraBusy(false);
      setReadiness((r) => ({ ...r, camera: "fail" }));
    };
    const track = stream.getVideoTracks()[0];
    track?.addEventListener("ended", lost);
    track?.addEventListener("mute", lost);
    return () => {
      cancelled = true;
      stopWatchingFrames();
      track?.removeEventListener("ended", lost);
      track?.removeEventListener("mute", lost);
      if (video.srcObject === stream) video.srcObject = null;
    };
  }, [camStream, onSecurityEvent, setReadiness]);

  useEffect(() => {
    if (activeTab !== "hardware") {
      cameraRequestOwner.current.cancel();
      micResources.current.cancel(cancelAnimationFrame);
      if (cameraOpeningRef.current) cameraSession.releaseVideo();
      else if (camStreamRef.current) cameraSession.releaseVideo(camStreamRef.current);
      cameraOpeningRef.current = false;
      camStreamRef.current = null;
      setCamStream(null);
      setMicStream(null);
      setMicActive(false);
      setMicPending(false);
      setMicLevel(0);
      setCameraBusy(false);
    }
  }, [activeTab]);

  useEffect(() => {
    void refreshTelemetry(false, "SETTINGS");
  }, [refreshTelemetry]);

  useEffect(() => {
    onSecurityEvent(
      `HARDWARE: Camera listing ${cameraListing.status}`,
      cameraListing.status === "unavailable" ? "warn" : "info"
    );
  }, [cameraListing.status, onSecurityEvent]);

  async function runSecurityScan(force = false) {
    await refreshTelemetry(force, "SETTINGS");
  }

  async function startCameraTest(deviceId = selectedCam) {
    const request = cameraRequestOwner.current.begin();
    cameraStartedAt.current = performance.now();
    cameraOpeningRef.current = true;
    setCameraBusy(true);
    setCameraError(null);
    setFramesStalled(false);
    const previousStream = camStreamRef.current;
    setCamStream(null);
    camStreamRef.current = null;
    onSecurityEvent("HARDWARE: Camera acquisition started");
    try {
      const stream = await cameraSession.setPreferredVideoDevice(deviceId || null);
      if (!cameraRequestOwner.current.owns(request)) return;
      cameraOpeningRef.current = false;
      camStreamRef.current = stream;
      setCamStream(stream);
      refreshCameras();
      onSecurityEvent(
        `HARDWARE: Camera acquired; checking preview (${Math.round(performance.now() - cameraStartedAt.current)} ms)`
      );
    } catch (err) {
      if (!cameraRequestOwner.current.owns(request)) return;
      cameraOpeningRef.current = false;
      setCameraBusy(false);
      if (previousStream?.getVideoTracks().some(isTrackDelivering)) {
        camStreamRef.current = previousStream;
        setCamStream(previousStream);
      }
      setSelectedCam(cameraSession.preferredVideoDevice() ?? "");
      setCameraError(
        err instanceof Error && /storage|quota/i.test(`${err.name} ${err.message}`)
          ? "Camera choice could not be saved. Check app storage and try again."
          : err instanceof Error && /timed out/i.test(err.message)
            ? "Camera did not respond in time. Reconnect it or choose another camera."
            : describeMediaError(err, "camera")
      );
      setReadiness((r) => ({ ...r, camera: "fail" }));
      onSecurityEvent("HARDWARE: Camera acquisition failed", "error");
    }
  }

  function getAspectRatioLabel(w: number, h: number) {
    if (w / h === 16 / 9) return "16:9 Widescreen";
    if (w / h === 4 / 3) return "4:3 Standard";
    return `${(w / h).toFixed(2)}:1`;
  }

  async function toggleMicMonitor() {
    if (micActive || micPending) {
      micResources.current.cancel(cancelAnimationFrame);
      setMicStream(null);
      setMicLevel(0);
      setMicActive(false);
      setMicPending(false);
      onSecurityEvent("HARDWARE: Microphone monitor stopped");
    } else {
      const request = micResources.current.begin(cancelAnimationFrame);
      setMicPending(true);
      try {
        setMicError(null);
        onSecurityEvent("HARDWARE: Microphone acquisition started");
        const stream = await getUserMediaWithTimeout({ audio: true }, CAMERA_START_TIMEOUT_MS);
        if (!micResources.current.owns(request)) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        micResources.current.setStream(stream);
        setMicStream(stream);

        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtx();
        micResources.current.setContext(ctx);

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        micResources.current.setAnalyser(analyser);

        const source = ctx.createMediaStreamSource(stream);
        source.connect(analyser);

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        let lastMeterUpdate = -Infinity;
        const drawMicStats = (timestamp: number) => {
          if (!micResources.current.owns(request)) return;
          const currentAnalyser = micResources.current.getAnalyser();
          if (!currentAnalyser) return;
          micResources.current.setFrame(requestAnimationFrame(drawMicStats));
          if (timestamp - lastMeterUpdate < 125) return;
          lastMeterUpdate = timestamp;
          currentAnalyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
          }
          const average = sum / bufferLength;
          const scaledVal = Math.min(Math.round((average / 90) * 100), 100);
          setMicLevel(scaledVal);
        };
        micResources.current.setFrame(requestAnimationFrame(drawMicStats));
        setMicPending(false);
        setMicActive(true);
        setReadiness((r) => ({ ...r, mic: "ok" }));
        onSecurityEvent("HARDWARE: Microphone stream verified");
      } catch (err) {
        if (!micResources.current.owns(request)) return;
        micResources.current.cancel(cancelAnimationFrame);
        setMicPending(false);
        setMicStream(null);
        setMicActive(false);
        console.error("Microphone capture failed", err);
        setMicError(
          err instanceof Error && /timed out/i.test(err.message)
            ? "Microphone did not respond in time. Check permission and try again."
            : describeMediaError(err, "microphone")
        );
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
      <Text type="supporting">
        AMS Access · {version ? `Version ${version}` : "Version unavailable"}
      </Text>
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
                          : cameraError || framesStalled
                            ? "Needs attention"
                            : camStream
                              ? "Preview live"
                              : "Preview off"
                      }
                      color={
                        cameraError ? "red" : cameraBusy ? "gray" : camStream ? "green" : "gray"
                      }
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
                        onChange={(deviceId) => {
                          setSelectedCam(deviceId);
                          void startCameraTest(deviceId);
                        }}
                        isDisabled={cameraBusy}
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
                          ...(selectedCam &&
                          !cameras.some((camera) => camera.deviceId === selectedCam)
                            ? [
                                {
                                  value: selectedCam,
                                  label: "Saved camera (not currently listed)",
                                  disabled: true,
                                },
                              ]
                            : []),
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
                          onClick={refreshCameras}
                          isDisabled={cameraListing.status === "loading"}
                        />
                      </HStack>
                      <Text type="supporting">
                        Choosing a camera saves it for device setup and contests and starts its
                        preview. Choose the camera that shows your face clearly; an infrared camera
                        may not provide a usable image.
                      </Text>
                      <Text type="supporting" role="status">
                        {cameraListing.status === "loading"
                          ? "Listing cameras…"
                          : cameraListing.status === "empty"
                            ? "No cameras were listed. Connect a camera or allow access, then refresh."
                            : cameraListing.status === "unavailable"
                              ? cameraListing.error
                              : cameras.every((camera) => !camera.deviceId)
                                ? "Camera identities are hidden. Start the camera to allow access, then refresh."
                                : "Camera list refreshed. Unnamed cameras appear as Camera 1, Camera 2, and so on."}
                      </Text>
                      {selectedCam &&
                        (cameraListing.status === "available" ||
                          cameraListing.status === "empty") &&
                        !cameras.some((camera) => camera.deviceId === selectedCam) && (
                          <Banner
                            status="warning"
                            title="Saved camera is not listed"
                            description="Reconnect the saved camera and refresh, or explicitly choose another camera. The app will not switch to a different camera automatically."
                          />
                        )}
                      {framesStalled && (
                        <Banner
                          status="warning"
                          title="Camera frames are not advancing"
                          description="The preview has not advanced for five seconds. Check the privacy shutter and connection, then restart or choose another camera. This is a capture diagnostic, not a face-check result."
                        />
                      )}
                      {camStream && (
                        <Text type="supporting">
                          If the image stays blank, check the privacy shutter and lighting, then
                          restart or choose another camera.
                        </Text>
                      )}
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
                        label={
                          micActive
                            ? "Listening"
                            : micPending
                              ? "Starting"
                              : micError
                                ? "Needs attention"
                                : "Off"
                        }
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
                        label={
                          micActive
                            ? "Stop microphone"
                            : micPending
                              ? "Cancel microphone"
                              : "Start microphone"
                        }
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
