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
  /** Injectable so tests do not need a real MediaStream constructor. */
  createStream: (tracks: MediaStreamTrack[]) => MediaStream;
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
  /** Notified on loss and on recovery. Returns an unsubscribe function. */
  subscribe(listener: CameraListener): () => void;
  /**
   * Stop every track and forget them. This is the *end of the exam*, not a
   * route change — releasing on unmount is exactly the bug this module fixes.
   */
  release(): void;
};

/** A track that can still produce frames. `ended` tracks never recover. */
export function isTrackUsable(track: Pick<MediaStreamTrack, "readyState"> | undefined): boolean {
  return track !== undefined && track.readyState === "live";
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
    const live = isTrackUsable(videoTrack ?? undefined);
    if (!live && videoTrack !== null) {
      announce("lost");
    } else if (live) {
      announce("live");
    }
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
      // `ended` is terminal for a track: the device went away and this handle
      // will never produce another frame, whatever the UI is still showing.
      track.addEventListener("ended", () => {
        if (videoTrack === track) announce("lost");
      });
    } else {
      audioTrack = track;
    }
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
      attachDeviceListener();

      if (!isTrackUsable(videoTrack ?? undefined)) {
        videoTrack?.stop();
        videoTrack = null;
        const stream = await md.getUserMedia({ video: VIDEO_CONSTRAINTS });
        const track = stream.getVideoTracks()[0];
        if (!track) throw new Error("Camera opened without a video track");
        adopt(track, "video");
      }

      // Audio is a separate open on purpose: onboarding asks for the camera
      // several stages before it asks for the microphone, and merging them
      // would move the microphone permission prompt to the camera stage.
      if (options.audio && !isTrackUsable(audioTrack ?? undefined)) {
        audioTrack?.stop();
        audioTrack = null;
        try {
          const stream = await md.getUserMedia({ audio: true });
          const track = stream.getAudioTracks()[0];
          if (track) adopt(track, "audio");
        } catch {
          // The microphone is advisory (its own stage warns rather than
          // blocks), so a refusal here must not cost the candidate the camera.
        }
      }

      announce("live");
      return assemble(Boolean(options.audio));
    },

    current() {
      if (!isTrackUsable(videoTrack ?? undefined)) return null;
      return assemble(isTrackUsable(audioTrack ?? undefined));
    },

    status() {
      return status;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    release() {
      videoTrack?.stop();
      audioTrack?.stop();
      videoTrack = null;
      audioTrack = null;
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
});
