import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../../..");
const helperDir = path.join(repoRoot, "apps/desktop/src-tauri/helpers");
const helperName = "com.ams.access.networkhelper";
const cargoBinName = "ams-access-networkhelper";
const bundledHelper = path.join(helperDir, helperName);

mkdirSync(helperDir, { recursive: true });

// On non-macOS CI (Linux runners building the web bundle only), skip the
// macOS-specific lipo step entirely.
const isMacOS = process.platform === "darwin";

if (!isMacOS) {
  // Build for the current host only — used on Linux/Windows CI for web-only builds.
  execFileSync("cargo", ["build", "-p", "network-helper", "--release"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  const builtHelper = path.join(repoRoot, "target/release", cargoBinName);
  execFileSync("cp", [builtHelper, bundledHelper]);
  chmodSync(bundledHelper, 0o755);
  console.log(`Prepared network helper (host arch): ${bundledHelper}`);
} else {
  // macOS distribution build: produce a universal binary so a single .dmg
  // works on both Apple Silicon and Intel Macs.
  const targets = ["aarch64-apple-darwin", "x86_64-apple-darwin"];

  for (const target of targets) {
    // Install the target if missing (no-op when already present).
    spawnSync("rustup", ["target", "add", target], {
      cwd: repoRoot,
      stdio: "inherit",
    });

    execFileSync("cargo", ["build", "-p", "network-helper", "--release", "--target", target], {
      cwd: repoRoot,
      stdio: "inherit",
    });
  }

  const arches = targets.map((t) => path.join(repoRoot, "target", t, "release", cargoBinName));

  execFileSync("lipo", ["-create", "-output", bundledHelper, ...arches]);
  chmodSync(bundledHelper, 0o755);

  // Verify the fat binary contains both slices.
  const lipoCheck = spawnSync("lipo", ["-info", bundledHelper], {
    encoding: "utf8",
  });
  console.log(`lipo -info: ${lipoCheck.stdout.trim()}`);
  console.log(`Prepared universal network helper: ${bundledHelper}`);
}
