/** Local-only level meter. This clone is never connected to a speaker or RTCPeerConnection. */
export function createVoiceInputMeter(stream: MediaStream) {
  const context = new AudioContext();
  let local: MediaStream | null = null;
  try {
    local = new MediaStream(stream.getAudioTracks().map((track) => track.clone()));
    local.getAudioTracks().forEach((track) => {
      track.enabled = true;
    });
    const source = context.createMediaStreamSource(local);
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    void context.resume().catch(() => {});
    const samples = new Float32Array(analyser.fftSize);
    return {
      read(): number | null {
        if (context.state !== "running") return null;
        analyser.getFloatTimeDomainData(samples);
        return Math.min(
          1,
          Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length)
        );
      },
      resume() {
        void context.resume().catch(() => {});
      },
      stop() {
        source.disconnect();
        analyser.disconnect();
        local?.getTracks().forEach((track) => track.stop());
        void context.close().catch(() => {});
      },
    };
  } catch (error) {
    local?.getTracks().forEach((track) => track.stop());
    void context.close().catch(() => {});
    throw error;
  }
}

/** One automatic attempt per open voice window; failures and deliberate leaves stay manual. */
export function createVoiceAutoJoinGate() {
  let attempted = false;
  return {
    reset() {
      attempted = false;
    },
    take(eligible: boolean) {
      if (!eligible || attempted) return false;
      attempted = true;
      return true;
    },
    attempted() {
      return attempted;
    },
  };
}
