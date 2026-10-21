export type CameraDevicesState = {
  status: "loading" | "available" | "empty" | "unavailable";
  devices: MediaDeviceInfo[];
  error: string | null;
};

/** Read-only device listing has its own deadline and owner, independent of capture. */
export function createCameraDeviceListing(
  enumerate: () => Promise<MediaDeviceInfo[]>,
  publish: (state: CameraDevicesState) => void,
  timeoutMs = 4000
) {
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    generation += 1;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return {
    cancel,
    refresh() {
      cancel();
      const request = generation;
      publish({ status: "loading", devices: [], error: null });
      timer = setTimeout(() => {
        if (generation !== request) return;
        cancel();
        publish({
          status: "unavailable",
          devices: [],
          error: "Camera listing timed out. Refresh cameras to try again.",
        });
      }, timeoutMs);
      void Promise.resolve()
        .then(enumerate)
        .then(
          (devices) => {
            if (generation !== request) return;
            cancel();
            const cameras = devices.filter((device) => device.kind === "videoinput");
            publish({
              status: cameras.length ? "available" : "empty",
              devices: cameras,
              error: null,
            });
          },
          () => {
            if (generation !== request) return;
            cancel();
            publish({
              status: "unavailable",
              devices: [],
              error: "Camera listing is unavailable. Check permission and refresh cameras.",
            });
          }
        );
    },
  };
}
