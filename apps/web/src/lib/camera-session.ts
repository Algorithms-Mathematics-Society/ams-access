import { withCameraTimeout } from "./camera-readiness.ts";
import { browserCameraPreferenceStore, type CameraPreferenceStore } from "./camera-selection.ts";

// One camera for the whole exam.
//
// The camera was opened in onboarding stage 8, stopped when the orchestrator
// unmounted on the way to /session/contest, and opened again by the contest
// room a moment later. That is two device opens across a route change the
// candidate did not ask for, and it is where the flow is most fragile:
// several USB webcams take seconds to reopen, some refuse entirely while the
// previous handle is still closing, and on Windows a second open can surface
// as NotReadableError — at which point the candidate is sitting in front of a
// contest with a dead camera and a "check your camera settings" message about
// a camera that worked ninety seconds ago.
//
// So the stream lives here, at module scope, and survives the SPA navigation.
// A hard reload drops it, which is correct: there is no track to reuse.
//
// Two events nothing handled before:
//
//   - `track.onended` fires when the device disappears — unplugged, claimed by
//     another application, or a laptop lid closing. Without it, a candidate
//     whose webcam is pulled out during the face scan waits forever on a
//     preview that will never produce another frame.
//   - `ondevicechange` fires when the device *list* changes. A track can stay
//     nominally "live" while its device is gone, so the list is the more
//     reliable signal, and it is also how we notice a camera coming back.
//
// The video track is reused across acquisitions; audio is acquired separately
// and grafted on, because onboarding opens video-only (the microphone has its
// own stage, with its own permission prompt, later in the flow) while the
// contest room wants both. Reusing the video track is the entire point — it
// is the one the operating system is slow to hand back.

export type CameraStatus = "idle" | "live" | "lost";

export type CameraListener = (status: CameraStatus) => void;

type MediaDevicesLike = Pick<MediaDevices, "getUserMedia"> & {
  addEventListener?: MediaDevices["addEventListener"];
  removeEventListener?: MediaDevices["removeEventListener"];
};

export type CameraSessionDeps = {
  mediaDevices: MediaDevicesLike | null;
  /** Bounds permission/device opens; injectable for regression tests. */
  requestTimeoutMs?: number;
  /** Injectable so tests do not need a real MediaStream constructor. */
  createStream: (tracks: MediaStreamTrack[]) => MediaStream;
  preferenceStore?: CameraPreferenceStore;
};

export type CameraSession = {
  /**
   * A stream with a live video track, and an audio track when `audio` is set.
   * Reuses whatever is already open. Throws the underlying getUserMedia error
   * so callers keep their existing NotAllowed / NotFound messaging.
   */
  ensure(options?: { audio?: boolean }): Promise<MediaStream>;
  /** The current stream, or null. Never triggers a permission prompt. */
  current(): MediaStream | null;
  status(): CameraStatus;
  preferredVideoDevice(): string | null;
  setPreferredVideoDevice(deviceId: string | null): Promise<MediaStream>;
  /** Release only the owned video. A stale stream cannot release a replacement. */
  releaseVideo(expectedStream?: MediaStream): void;
  /** Notified on loss and on recovery. Returns an unsubscribe function. */
  subscribe(listener: CameraListener): () => void;
  /**
   * Stop every track and forget them. This is the *end of the exam*, not a
   * route change — releasing on unmount is exactly the bug this module fixes.
   */
  release(): void;
};

/** A handle that may yet produce frames. `ended` tracks never recover.
 *
 * Deliberately permissive, because this decides whether to *reuse* a track.
 * A track is briefly `muted` at acquisition on several browsers, and
 * rejecting it here would fail the open it was granted by. */
export function isTrackUsable(track: Pick<MediaStreamTrack, "readyState"> | undefined): boolean {
  return track !== undefined && track.readyState === "live";
}

/** A track that is producing frames *now*.
 *
 * `readyState` alone said yes to a camera that had stopped delivering: a
 * `muted` track — the device claimed by another application, a laptop lid
 * closed, a privacy shutter — stays `live`, and `<video>` goes on showing its
 * last decoded frame, so every check agreed the camera was fine while the
 * picture had been frozen for ten minutes. That is the failure mode
 * proctoring can least afford, because it looks exactly like a candidate
 * sitting still. */
export function isTrackDelivering(
  track: Pick<MediaStreamTrack, "readyState" | "muted"> | undefined
): boolean {
  return isTrackUsable(track) && track!.muted !== true;
}

export const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 640 },
  height: { ideal: 480 },
  facingMode: "user",
};

export function createCameraSession(deps: CameraSessionDeps): CameraSession {
  let videoTrack: MediaStreamTrack | null = null;
  let audioTrack: MediaStreamTrack | null = null;
  let status: CameraStatus = "idle";
  const listeners = new Set<CameraListener>();
  let deviceListenerAttached = false;
  // Bumped by release(). An open still in flight when the exam ends must not
  // turn the camera back on afterwards: it stops what it got and fails.
  let generation = 0;
  let videoGeneration = 0;
  let preferredDeviceId: string | null | undefined;
  let pendingVideo: Promise<void> | null = null;
  // Whether a camera has ever been opened in this session. Guards the replug
  // recovery so it can never raise a permission prompt by itself.
  let everOpened = false;
  let pendingAudio: Promise<void> | null = null;

  function announce(next: CameraStatus) {
    if (next === status) return;
    status = next;
    // A throwing listener must not stop the others from hearing that the
    // camera died — that is the one message they all need.
    for (const listener of [...listeners]) {
      try {
        listener(next);
      } catch {
        /* a subscriber's failure is not this module's problem */
      }
    }
  }

  function reassess() {
    if (isTrackDelivering(videoTrack ?? undefined)) {
      announce("live");
      return;
    }
    if (videoTrack !== null) announce("lost");

    // This is the replug. An `ended` handle will never produce another frame
    // however many times it is inspected, so a change in the *device list* is
    // the only hint that a replacement exists — and the old check returned
    // early on exactly this case, which is why the camera stayed dead until
    // the page was reloaded, behind a soft block with no button.
    //
    // A merely muted track is left alone: it is still a valid handle and the
    // `unmute` event will bring it back on its own.
    //
    // `everOpened` keeps this from prompting. Without it a `devicechange`
    // before the first `ensure` would call getUserMedia and put a permission
    // dialog in front of a candidate who had not asked for one.
    if (everOpened && !isTrackUsable(videoTrack ?? undefined)) {
      videoTrack?.stop();
      videoTrack = null;
      void recover();
    }
  }

  /** Try to reopen the explicitly owned camera after a device-list change. */
  function recover(): Promise<void> {
    if (pendingVideo || !deps.mediaDevices) return Promise.resolve();
    const opened = generation;
    const pending = openTrack("video", opened);
    pendingVideo = pending;
    return pending.then(
      () => {
        if (pendingVideo === pending) pendingVideo = null;
        if (opened === generation && isTrackDelivering(videoTrack ?? undefined)) {
          announce("live");
        }
      },
      () => {
        if (pendingVideo === pending) pendingVideo = null;
      }
    );
  }

  function attachDeviceListener() {
    if (deviceListenerAttached) return;
    const md = deps.mediaDevices;
    if (!md?.addEventListener) return;
    md.addEventListener("devicechange", reassess);
    deviceListenerAttached = true;
  }

  function adopt(track: MediaStreamTrack, kind: "video" | "audio") {
    if (kind === "video") {
      videoTrack = track;
      everOpened = true;
      // `ended` is terminal for a track: the device went away and this handle
      // will never produce another frame, whatever the UI is still showing.
      track.addEventListener("ended", () => {
        if (videoTrack === track) announce("lost");
      });
      // A muted track is still `live`. Nothing watched for this, so a camera
      // claimed by another application reported healthy indefinitely.
      track.addEventListener?.("mute", () => {
        if (videoTrack === track) announce("lost");
      });
      track.addEventListener?.("unmute", () => {
        if (videoTrack === track) announce("live");
      });
    } else {
      audioTrack = track;
    }
  }

  function preferred(): string | null {
    if (preferredDeviceId === undefined) preferredDeviceId = deps.preferenceStore?.read() ?? null;
    return preferredDeviceId;
  }

  function videoConstraints(): MediaTrackConstraints {
    const deviceId = preferred();
    return deviceId ? { ...VIDEO_CONSTRAINTS, deviceId: { exact: deviceId } } : VIDEO_CONSTRAINTS;
  }

  function openTrack(
    kind: "video" | "audio",
    opened: number,
    openedVideo = videoGeneration
  ): Promise<void> {
    const md = deps.mediaDevices!;
    const request =
      kind === "video"
        ? md.getUserMedia({ video: videoConstraints() })
        : md.getUserMedia({ audio: true });
    return withCameraTimeout(
      request,
      deps.requestTimeoutMs ?? 8000,
      kind === "video" ? "Camera request timed out" : "Microphone request timed out",
      (late) => late.getTracks().forEach((track) => track.stop())
    ).then((stream) => {
      const track = kind === "video" ? stream.getVideoTracks()[0] : stream.getAudioTracks()[0];
      // A grant can arrive after release, or contain tracks we did not ask for.
      for (const granted of stream.getTracks()) {
        if (opened !== generation || granted !== track) granted.stop();
      }
      if (opened !== generation || (kind === "video" && openedVideo !== videoGeneration)) {
        track?.stop();
        throw new Error("Camera selection changed");
      }
      if (!track || !isTrackUsable(track)) {
        track?.stop();
        if (kind === "video") throw new Error("Camera opened without a video track");
        return;
      }
      adopt(track, kind);
    });
  }

  function assemble(wantAudio: boolean): MediaStream {
    const tracks: MediaStreamTrack[] = [];
    if (videoTrack) tracks.push(videoTrack);
    if (wantAudio && audioTrack) tracks.push(audioTrack);
    return deps.createStream(tracks);
  }

  return {
    async ensure(options = {}) {
      const md = deps.mediaDevices;
      if (!md) throw new Error("Camera not available on this device");
      const opened = generation;
      const openedVideo = videoGeneration;
      attachDeviceListener();

      if (!isTrackUsable(videoTrack ?? undefined)) {
        if (!pendingVideo) {
          videoTrack?.stop();
          videoTrack = null;
          const pending = openTrack("video", opened);
          pendingVideo = pending;
          pending.then(
            () => {
              if (pendingVideo === pending) pendingVideo = null;
            },
            () => {
              if (pendingVideo === pending) pendingVideo = null;
            }
          );
        }
        try {
          await pendingVideo;
        } catch (error) {
          if (opened !== generation) throw new Error("Camera released");
          throw error;
        }
        if (opened !== generation) throw new Error("Camera released");
        if (openedVideo !== videoGeneration) throw new Error("Camera selection changed");
      }

      // Audio is a separate open on purpose: onboarding asks for the camera
      // several stages before it asks for the microphone, and merging them
      // would move the microphone permission prompt to the camera stage.
      if (options.audio && !isTrackUsable(audioTrack ?? undefined)) {
        if (!pendingAudio) {
          audioTrack?.stop();
          audioTrack = null;
          const pending = openTrack("audio", opened);
          pendingAudio = pending;
          pending.then(
            () => {
              if (pendingAudio === pending) pendingAudio = null;
            },
            () => {
              if (pendingAudio === pending) pendingAudio = null;
            }
          );
        }
        try {
          await pendingAudio;
          if (opened !== generation) throw new Error("Camera released");
          if (openedVideo !== videoGeneration) throw new Error("Camera selection changed");
        } catch (error) {
          if (opened !== generation) throw new Error("Camera released");
          if (openedVideo !== videoGeneration) throw new Error("Camera selection changed");
          // The microphone is advisory (its own stage warns rather than
          // blocks), so a refusal here must not cost the candidate the camera.
        }
      }

      announce(isTrackDelivering(videoTrack ?? undefined) ? "live" : "lost");
      return assemble(Boolean(options.audio));
    },

    current() {
      if (!isTrackDelivering(videoTrack ?? undefined)) return null;
      return assemble(isTrackUsable(audioTrack ?? undefined));
    },

    status() {
      return status;
    },

    preferredVideoDevice() {
      return preferred();
    },

    async setPreferredVideoDevice(deviceId) {
      if (!deps.mediaDevices) throw new Error("Camera not available on this device");
      attachDeviceListener();
      const next = deviceId?.trim() || null;
      // Persist first: a storage failure must not switch to a preference the
      // next launch cannot reproduce.
      deps.preferenceStore?.write(next);
      preferredDeviceId = next;
      videoGeneration += 1;
      const opened = generation;
      const openedVideo = videoGeneration;
      pendingVideo = null;
      videoTrack?.stop();
      videoTrack = null;
      announce("lost");
      const pending = openTrack("video", opened, openedVideo);
      pendingVideo = pending;
      try {
        await pending;
      } finally {
        if (pendingVideo === pending) pendingVideo = null;
      }
      if (opened !== generation || openedVideo !== videoGeneration) {
        throw new Error("Camera selection changed");
      }
      announce(isTrackDelivering(videoTrack ?? undefined) ? "live" : "lost");
      return assemble(isTrackUsable(audioTrack ?? undefined));
    },

    releaseVideo(expectedStream) {
      const expectedTrack = expectedStream?.getVideoTracks()[0];
      if (expectedStream && expectedTrack !== videoTrack) return;
      videoGeneration += 1;
      pendingVideo = null;
      videoTrack?.stop();
      videoTrack = null;
      everOpened = false;
      announce("lost");
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    release() {
      generation += 1;
      videoGeneration += 1;
      pendingVideo = null;
      pendingAudio = null;
      videoTrack?.stop();
      audioTrack?.stop();
      videoTrack = null;
      audioTrack = null;
      everOpened = false;
      const md = deps.mediaDevices;
      if (deviceListenerAttached && md?.removeEventListener) {
        md.removeEventListener("devicechange", reassess);
        deviceListenerAttached = false;
      }
      announce("idle");
    },
  };
}

/**
 * The session the app uses. Module scope is what makes it survive the
 * onboarding → contest navigation; Next.js keeps the JS context across a
 * client-side route change, and a hard reload correctly starts over.
 */
export const cameraSession: CameraSession = createCameraSession({
  mediaDevices: typeof navigator !== "undefined" ? (navigator.mediaDevices ?? null) : null,
  createStream: (tracks) => new MediaStream(tracks),
  preferenceStore: browserCameraPreferenceStore(),
});
