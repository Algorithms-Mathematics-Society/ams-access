import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../../..");

export function prepareAppImageNss({
  platform = process.platform,
  root = "/",
  repoRoot: destinationRoot = repoRoot,
} = {}) {
  if (platform !== "linux") return;

  const helperDir = path.join(destinationRoot, "apps/desktop/src-tauri/helpers/appimage");
  mkdirSync(helperDir, { recursive: true });
  for (const name of ["libsoftokn3.so", "libfreeblpriv3.so"]) {
    const source = [
      `usr/lib/${name}`,
      `usr/lib/x86_64-linux-gnu/${name}`,
      `usr/lib/nss/${name}`,
      `usr/lib/x86_64-linux-gnu/nss/${name}`,
    ]
      .map((candidate) => path.join(root, candidate))
      .find(existsSync);
    if (!source) throw new Error(`Could not find Linux NSS module ${name}`);
    copyFileSync(source, path.join(helperDir, name));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareAppImageNss();
}
