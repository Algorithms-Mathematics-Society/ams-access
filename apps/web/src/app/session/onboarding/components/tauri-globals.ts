import { type MonitorInfo } from "../support";

// Tauri global typing for the direct window.__TAURI__ uses in this file.
export type TauriGlobals = {
  __TAURI__?: {
    core: { invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T> };
    window: {
      availableMonitors: () => Promise<MonitorInfo[]>;
      getCurrentWindow: () => {
        setFullscreen: (v: boolean) => Promise<void>;
        isFullscreen: () => Promise<boolean>;
        setAlwaysOnTop: (v: boolean) => Promise<void>;
        setDecorations: (v: boolean) => Promise<void>;
        setResizable: (v: boolean) => Promise<void>;
      };
    };
  };
};
