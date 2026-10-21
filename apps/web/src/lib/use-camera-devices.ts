"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createCameraDeviceListing, type CameraDevicesState } from "./camera-devices";

export function useCameraDevices() {
  const [state, setState] = useState<CameraDevicesState>({
    status: "loading",
    devices: [],
    error: null,
  });
  const listing = useRef<ReturnType<typeof createCameraDeviceListing> | null>(null);
  const refresh = useCallback(() => listing.current?.refresh(), []);
  useEffect(() => {
    const devices = navigator.mediaDevices;
    const owner = createCameraDeviceListing(() => {
      if (!devices?.enumerateDevices)
        return Promise.reject(new Error("Device listing unavailable"));
      return devices.enumerateDevices();
    }, setState);
    listing.current = owner;
    owner.refresh();
    devices?.addEventListener?.("devicechange", refresh);
    return () => {
      devices?.removeEventListener?.("devicechange", refresh);
      owner.cancel();
      listing.current = null;
    };
  }, [refresh]);
  return { state, refresh };
}
