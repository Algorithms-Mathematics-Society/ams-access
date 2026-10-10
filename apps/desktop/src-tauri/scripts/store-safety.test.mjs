import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../../..");

const read = (relative) => readFile(path.join(repoRoot, relative), "utf8");

test("Windows restricted-process handling is detection-only", async () => {
  const [windows, desktop, resolveModal] = await Promise.all([
    read("packages/platform-rs/src/windows/mod.rs"),
    read("apps/desktop/src-tauri/src/lib.rs"),
    read("apps/web/src/app/home/components/ResolveModal.tsx"),
  ]);

  assert.doesNotMatch(windows, /hidden_command\("taskkill"\)/);
  assert.doesNotMatch(windows, /Command::new\("taskkill"\)/);
  assert.doesNotMatch(desktop, /close_restricted_apps/);
  assert.doesNotMatch(resolveModal, /Close all restricted apps automatically/);
  assert.match(resolveModal, /close each app completely/i);
});

test("MSIX keeps proctor lockdown but does not write virtualized Windows policies", async () => {
  const [windows, desktop, manifest] = await Promise.all([
    read("packages/platform-rs/src/windows/mod.rs"),
    read("apps/desktop/src-tauri/src/lib.rs"),
    read("apps/desktop/msix/AppxManifest.xml"),
  ]);

  assert.match(
    windows,
    /if !is_packaged\(\) \{\s*apply_registry_policies\(true\);\s*set_game_bar_enabled\(false\);\s*set_touchpad_gestures_enabled\(false\);/s
  );
  assert.match(windows, /SetWindowsHookExW/);
  assert.match(windows, /HOOK_INSTALLED\.load/);
  assert.match(windows, /Alt\+Tab/);
  assert.match(windows, /Any Win\+ combo/);
  assert.match(desktop, /set_always_on_top\(true\)/);
  assert.match(desktop, /set_fullscreen\(true\)/);
  assert.match(desktop, /apply_capture_protection/);
  assert.match(desktop, /spawn_virtual_desktop_guard/);
  assert.match(desktop, /is_lockdown_engaged/);

  assert.match(manifest, /<rescap:Capability Name="runFullTrust"\s*\/>/);
  assert.match(manifest, /<DeviceCapability Name="webcam"\s*\/>/);
  assert.match(manifest, /<DeviceCapability Name="microphone"\s*\/>/);
  assert.doesNotMatch(manifest, /unvirtualizedResources/);
  assert.doesNotMatch(manifest, /RegistryWriteVirtualization/);
});

test("CI installs, launches, and certification-checks the MSIX", async () => {
  const ci = await read(".github/workflows/ci.yml");
  assert.match(ci, /build-msix\.ps1 -SelfSign/);
  assert.match(
    ci,
    /Import-Certificate -FilePath \$cer -CertStoreLocation Cert:\\LocalMachine\\TrustedPeople[\s\S]*?Add-AppxPackage/
  );
  assert.doesNotMatch(ci, /Import-Certificate[^\n]*Cert:\\CurrentUser\\TrustedPeople/);
  assert.match(ci, /Add-AppxPackage/);
  assert.match(ci, /Start-Process "shell:AppsFolder/);
  assert.match(ci, /appcert test -appxpackagepath/);
});
