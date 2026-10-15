import {
  existsSync,
  mkdtempSync,
  lstatSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

export const PRIVATE_RUNTIME_FOLDER = "ams-supervised-webview2";

export function privateRuntime(source) {
  if (!source || !path.isAbsolute(source))
    throw new Error(
      "Supply the absolute path to an extracted Microsoft Fixed Version WebView2 runtime"
    );
  const runtime = realpathSync(source);
  for (const file of ["msedgewebview2.exe", "icudtl.dat"]) {
    if (!existsSync(path.join(runtime, file)) || !statSync(path.join(runtime, file)).isFile())
      throw new Error(`Fixed Version runtime is missing ${file}`);
  }
  return { runtime };
}

export function installerHooks(folder) {
  if (!/^[A-Za-z0-9._ -]+$/.test(folder) || folder === "." || folder === "..")
    throw new Error("Invalid private runtime folder");
  // Fixed Version >=120 requires these sandbox read/execute ACLs on Windows 10.
  return `!macro NSIS_HOOK_POSTINSTALL
  nsExec::ExecToStack '"$SYSDIR\\icacls.exe" "$INSTDIR\\${folder}" /grant "*S-1-15-2-1:(OI)(CI)(RX)" /grant "*S-1-15-2-2:(OI)(CI)(RX)" /T'
  Pop $0
  Pop $1
  StrCmp $0 "0" +3
  MessageBox MB_OK|MB_ICONSTOP "Failed to grant private WebView2 sandbox access: $1"
  Abort
!macroend
`;
}

export function buildConfig(hooks) {
  return {
    bundle: {
      targets: ["nsis"],
      windows: {
        webviewInstallMode: { type: "fixedRuntime", path: PRIVATE_RUNTIME_FOLDER },
        nsis: { installMode: "perMachine", installerHooks: hooks },
      },
    },
  };
}

export function withStagedRuntime(runtime, staging, build) {
  try {
    lstatSync(staging);
    throw new Error(`Remove stale supervised runtime staging directory first: ${staging}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  symlinkSync(runtime, staging, "junction");
  try {
    return build();
  } finally {
    // Never recurse through a junction or remove somebody else's replacement.
    if (!lstatSync(staging).isSymbolicLink() || realpathSync(staging) !== runtime)
      throw new Error(`Supervised runtime staging identity changed: ${staging}`);
    rmSync(staging);
  }
}

export function main(args) {
  if (process.platform !== "win32")
    throw new Error("Supervised Windows packaging must run on Windows");
  if (args.length !== 1)
    throw new Error(
      "Usage: pnpm --filter @ams/desktop build:windows-supervised C:\\path\\to\\FixedVersionRuntime"
    );
  const { runtime } = privateRuntime(args[0]);
  const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const staging = path.join(desktop, "src-tauri", PRIVATE_RUNTIME_FOLDER);
  const temp = mkdtempSync(path.join(tmpdir(), "ams-supervised-"));
  try {
    const hooks = path.join(temp, "private-runtime.nsh");
    const config = path.join(temp, "tauri.supervised.json");
    writeFileSync(hooks, installerHooks(PRIVATE_RUNTIME_FOLDER));
    writeFileSync(config, JSON.stringify(buildConfig(hooks)));
    // Tauri embeds this relative path unchanged. Its resource walker follows a
    // root junction and copies the runtime beside the installed executable.
    withStagedRuntime(runtime, staging, () => {
      const require = createRequire(import.meta.url);
      const cli = path.join(
        path.dirname(require.resolve("@tauri-apps/cli/package.json")),
        "tauri.js"
      );
      const result = spawnSync(process.execPath, [cli, "build", "--config", config], {
        cwd: desktop,
        env: { ...process.env, AMS_FIREWALL: "1", AMS_FIXED_WEBVIEW2_PATH: runtime },
        stdio: "inherit",
        shell: false,
      });
      if (result.error) throw result.error;
      if (result.status !== 0)
        throw new Error(`Supervised package build failed (${result.status})`);
    });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
