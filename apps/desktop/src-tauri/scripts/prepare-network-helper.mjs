import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../../..");
const helperDir = path.join(repoRoot, "apps/desktop/src-tauri/helpers");
const helperName = "com.ams.access.networkhelper";
const cargoBinName = "ams-access-networkhelper";
const bundledHelper = path.join(helperDir, helperName);
// Linux uses the cargo bin name verbatim (no reverse-DNS label like macOS).
// tauri.conf.json bundles this path as a resource on every platform, so it must
// always exist; on macOS/Windows it is just an unused copy of the same binary.
const bundledHelperLinux = path.join(helperDir, cargoBinName);

mkdirSync(helperDir, { recursive: true });

// On non-macOS CI (Linux runners building the web bundle only), skip the
// macOS-specific lipo step entirely.
const isMacOS = process.platform === "darwin";

if (!isMacOS) {
  // Build for the current host only. On Windows the crate produces a stub
  // (lockdown is enforced by the main app there), but the bundler still
  // expects the helper resource to exist, so build and copy it anyway.
  execFileSync("cargo", ["build", "-p", "network-helper", "--release"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  const binFileName = process.platform === "win32" ? `${cargoBinName}.exe` : cargoBinName;
  const builtHelper = path.join(repoRoot, "target", "release", binFileName);
  // Stage the Linux/host-named copy that tauri.conf.json bundles and that
  // platform_rs::linux::install_network_helper installs via systemd. This is the
  // only helper actually used at runtime on this (non-macOS) host.
  copyFileSync(builtHelper, bundledHelperLinux);
  chmodSync(bundledHelperLinux, 0o755);
  // The macOS-named resource (bundledHelper) is bundled on every platform per
  // tauri.conf.json, so it must EXIST — but on a non-macOS host it is never used
  // at runtime, and the correct universal Mach-O binary is built only by the
  // isMacOS branch (via lipo). It is already tracked in git, so we must NOT
  // overwrite it with this host (e.g. Linux ELF) build: doing so would ship a
  // host binary as the macOS root helper, silently breaking macOS network
  // lockdown if a .dmg were bundled without re-running the macOS branch.
  // Only create it if it is missing, leaving any checked-out binary intact.
  if (!existsSync(bundledHelper)) {
    copyFileSync(builtHelper, bundledHelper);
    chmodSync(bundledHelper, 0o755);
  }
  console.log(`Prepared network helper (host arch): ${bundledHelperLinux}`);
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
  // Stage the Linux-named copy too so the tauri.conf.json resource always
  // resolves when bundling a .dmg on macOS (it is unused on macOS).
  copyFileSync(bundledHelper, bundledHelperLinux);
  chmodSync(bundledHelperLinux, 0o755);

  // Verify the fat binary contains both slices.
  const lipoCheck = spawnSync("lipo", ["-info", bundledHelper], {
    encoding: "utf8",
  });
  console.log(`lipo -info: ${lipoCheck.stdout.trim()}`);
  console.log(`Prepared universal network helper: ${bundledHelper}`);

  // Sign with hardened runtime + secure timestamp so notarization accepts it.
  // APPLE_SIGNING_IDENTITY is set by CI before this script runs.
  const signingIdentity = process.env.APPLE_SIGNING_IDENTITY;
  if (signingIdentity) {
    execFileSync(
      "codesign",
      ["--force", "--sign", signingIdentity, "--options", "runtime", "--timestamp", bundledHelper],
      { stdio: "inherit" }
    );
    console.log(`Signed network helper with identity: ${signingIdentity}`);
  } else {
    console.log("APPLE_SIGNING_IDENTITY not set — skipping helper codesign (local build).");
  }
}
