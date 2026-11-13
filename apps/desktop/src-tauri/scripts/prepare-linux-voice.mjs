import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDir, "../../../..");

/** Build from the sidecar's independent lockfile and stage its fixed resource path. */
export function prepareLinuxVoice({
  repoRoot = defaultRepoRoot,
  platform = process.platform,
  runCargo = execFileSync,
} = {}) {
  if (platform !== "linux") return null;

  const manifest = path.join(repoRoot, "packages/linux-voice-worker/Cargo.toml");
  const targetDirectory = JSON.parse(
    runCargo("cargo", ["metadata", "--manifest-path", manifest, "--no-deps", "--format-version", "1", "--locked"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    })
  ).target_directory;
  if (typeof targetDirectory !== "string" || !path.isAbsolute(targetDirectory)) {
    throw new Error("Linux voice Cargo metadata did not return an absolute target_directory");
  }

  runCargo("cargo", ["build", "--manifest-path", manifest, "--locked", "--release"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  const binary = path.join(targetDirectory, "release/ams-linux-voice-worker");
  if (!existsSync(binary)) throw new Error(`Linux voice worker build did not produce ${binary}`);

  const staged = path.join(repoRoot, "apps/desktop/src-tauri/helpers/ams-linux-voice-worker");
  mkdirSync(path.dirname(staged), { recursive: true });
  copyFileSync(binary, staged);
  chmodSync(staged, 0o755);
  console.log(`Prepared Linux voice worker: ${staged}`);
  return staged;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareLinuxVoice();
}
