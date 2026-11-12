import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// tauri dev uses the host media runtime, unlike a bundled AppImage.
if (process.platform === "linux") {
  const check = fileURLToPath(
    new URL("../../../../scripts/check-linux-rtc-media.sh", import.meta.url)
  );
  try {
    execFileSync("sh", [check], { stdio: "inherit" });
  } catch {
    process.exit(1);
  }
}
