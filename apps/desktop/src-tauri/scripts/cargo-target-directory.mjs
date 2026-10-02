import { execFileSync } from "node:child_process";
import path from "node:path";

/** Respect Cargo's configured target directory, including CARGO_TARGET_DIR. */
export function cargoTargetDirectory(repoRoot, runCargo = execFileSync) {
  const metadata = JSON.parse(
    runCargo("cargo", ["metadata", "--no-deps", "--format-version", "1", "--locked"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    })
  );
  if (
    typeof metadata.target_directory !== "string" ||
    !path.isAbsolute(metadata.target_directory)
  ) {
    throw new Error("Cargo metadata did not return an absolute target_directory");
  }
  return metadata.target_directory;
}
