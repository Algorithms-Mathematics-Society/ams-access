"use client";

import { useEffect, useState } from "react";
import { invoke } from "@ams/api-client";

/** Read the same native app metadata command used by Tauri's getVersion().
 * Browser previews have no native version; never invent one from the web bundle.
 */
export function useAppVersion() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void invoke<unknown>("plugin:app|version")
      .then((value) => {
        if (active && typeof value === "string" && value.trim()) setVersion(value.trim());
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return { version, source: version ? ("desktop" as const) : ("unavailable" as const) };
}
