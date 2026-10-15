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
  const [windows, desktop, manifest, hookLifecycle] = await Promise.all([
    read("packages/platform-rs/src/windows/mod.rs"),
    read("apps/desktop/src-tauri/src/lib.rs"),
    read("apps/desktop/msix/AppxManifest.xml"),
    read("packages/platform-rs/src/windows/hook_lifecycle.rs"),
  ]);

  assert.match(
    windows,
    /let registry = if is_packaged\(\) \{\s*RegistryLockdownStatus::NotApplicablePackaged\s*\} else \{\s*match registry_recovery::engage\(is_elevated\(\)\)/s
  );
  const recovery = windows.slice(
    windows.indexOf("pub fn recover_registry_if_crashed()"),
    windows.indexOf("pub fn desktop_recovery_pending()")
  );
  assert.match(recovery, /if is_packaged\(\) \{\s*return Ok\(\(\)\);/s);
  assert.match(recovery, /registry_recovery::restore\(\)/);
  assert.doesNotMatch(
    windows,
    /reg_delete_value|apply_registry_policies|set_game_bar_enabled|set_touchpad_gestures_enabled/
  );
  assert.match(windows, /SetWindowsHookExW/);
  assert.match(windows, /let installed = session\.ready\(\) && spawn_hook_watchdog/);
  assert.match(
    hookLifecycle,
    /pub fn ready\(&self\) -> bool \{\s*self\.active\.load\(Ordering::SeqCst\)\s*&& self\.alive\.load\(Ordering::SeqCst\)\s*&& self\.installed\.load\(Ordering::SeqCst\)/
  );
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

test("Windows owns startup and teardown before recovering shared settings", async () => {
  const desktop = await read("apps/desktop/src-tauri/src/lib.rs");
  const startup = desktop.slice(desktop.indexOf("pub fn run()"));
  const owner = startup.indexOf("let _windows_instance");
  const recover = startup.indexOf("platform_rs::windows::recover_registry_if_crashed()");
  const builder = startup.indexOf("tauri::Builder::default()");
  assert.ok(startup.indexOf("platform_rs::windows::relaunch_as_admin()") < owner);
  assert.ok(owner > 0 && recover > owner && builder > recover);
  const ownedStartup = startup.slice(owner, builder);
  assert.match(ownedStartup, /instance::acquire\(wait\)/);
  assert.match(ownedStartup, /show_startup_error\(&error\);\s*return;/);
  const recovery = ownedStartup.slice(
    ownedStartup.indexOf("recover_registry_if_crashed"),
    ownedStartup.indexOf('#[cfg(target_os = "macos")]')
  );
  assert.match(recovery, /disable_network_lockdown\(\)/);
  assert.doesNotMatch(recovery, /thread::spawn/);
});

test("Windows restore failure stays visible and retry uses the journal", async () => {
  const desktop = await read("apps/desktop/src-tauri/src/lib.rs");
  const status = desktop.slice(
    desktop.indexOf("fn lockdown_restore_status()"),
    desktop.indexOf("fn get_lockdown_restore_status()")
  );
  assert.match(status, /cfg\(target_os = "windows"\)[\s\S]*?desktop_recovery_pending\(\)/);
  const retry = desktop.slice(
    desktop.indexOf("async fn retry_lockdown_restore("),
    desktop.indexOf("async fn check_network_stability(")
  );
  assert.match(
    retry,
    /cfg\(target_os = "windows"\)[\s\S]*?!LOCKDOWN_ENGAGED[\s\S]*?owner\.stop\(&mut DesktopOperations::new\(app, false\)\)\?/
  );
  assert.match(
    desktop,
    /cfg\(target_os = "windows"\)\]\s*let protected = \{\s*let status = platform_rs::windows::lock_desktop_with_status\(\)\?/
  );
  const release = desktop.slice(
    desktop.indexOf("fn release_native_desktop()"),
    desktop.indexOf("async fn engage_desktop(")
  );
  assert.match(release, /windows::desktop_recovery_pending\(\)[\s\S]*?return Err/);
});

test("unelevated Windows entry records skipped registry controls without waiving keyboard protection", async () => {
  const [windows, desktop, registry] = await Promise.all([
    read("packages/platform-rs/src/windows/mod.rs"),
    read("apps/desktop/src-tauri/src/lib.rs"),
    read("packages/platform-rs/src/windows/registry_recovery.rs"),
  ]);
  const engage = desktop.slice(
    desktop.indexOf("impl lockdown_lifecycle::Operations for DesktopOperations"),
    desktop.indexOf("async fn lock_desktop(")
  );
  assert.match(engage, /lock_desktop_with_status\(\)\?/);
  assert.match(
    engage,
    /SkippedUnelevated[\s\S]*?record_proctoring_event\([\s\S]*?"registry_lockdown_advisory"/
  );
  assert.match(engage, /"registry_status": status\.registry/);
  assert.match(engage, /if !protected \{\s*if self\.require_keyboard \{\s*return Err/);
  assert.match(windows, /keyboard_active: enable_keyboard_intercept\(\)\.active/);
  const privilege = registry.slice(
    registry.indexOf("fn engage_for_privilege_with("),
    registry.indexOf("fn engage_with(")
  );
  assert.match(privilege, /if elevated \{\s*engage_with\(registry, storage\)\?/);
  assert.match(
    privilege,
    /else \{[\s\S]*?restore_with\(registry, storage\)\?;\s*Ok\(RegistryLockdownStatus::SkippedUnelevated\)/
  );
});

test("Windows capture affinity outcomes are recorded and remain advisory", async () => {
  const [engine, desktop, stage] = await Promise.all([
    read("packages/platform-rs/src/windows/capture_protection.rs"),
    read("apps/desktop/src-tauri/src/lib.rs"),
    read("apps/web/src/app/session/onboarding/components/stages/Stage4_EnvironmentValidation.tsx"),
  ]);
  assert.match(engine, /fn exclusion_accepted_does_not_try_monitor/);
  assert.match(engine, /fn exclusion_failure_uses_monitor_fallback/);
  assert.match(engine, /fn both_requests_fail_with_both_reasons/);
  assert.match(engine, /Windows 10 before 2004 may use monitor behavior/);
  const monitors = desktop.slice(
    desktop.indexOf("fn start_windows_monitors("),
    desktop.indexOf("async fn unlock_desktop(")
  );
  assert.match(monitors, /request_windows_capture_protection\(app, "monitor_start"\)/);
  assert.doesNotMatch(monitors, /platform_rs::windows::apply_capture_protection/);
  const request = desktop.slice(
    desktop.indexOf("fn request_windows_capture_protection("),
    desktop.indexOf("fn set_escape_blocked(")
  );
  assert.match(
    request,
    /record_proctoring_event\([\s\S]*?"capture_advisory"[\s\S]*?"source": "capture_advisory"/
  );
  assert.match(request, /Exam window unavailable/);
  assert.match(request, /Exam window handle unavailable/);
  assert.match(stage, /status === "monitor_fallback"/);
  assert.match(stage, /capture\?\.status === "exclusion" \? "pass" : "warn"/);
});

test("Windows firewall installation is scoped, validated and serialized with cleanup", async () => {
  const [windows, desktop] = await Promise.all([
    read("packages/platform-rs/src/windows/mod.rs"),
    read("apps/desktop/src-tauri/src/lib.rs"),
  ]);
  const enable = windows.slice(
    windows.indexOf("pub fn enable_network_lockdown("),
    windows.indexOf("mod firewall_policy;")
  );
  const install = enable.indexOf("firewall_policy::install_programs_with(");
  assert.ok(install >= 0);
  for (const preflight of ["firewall_policy::plan(allowed_ips)?", "runtime.revalidate_layout()?"]) {
    const position = enable.indexOf(preflight);
    assert.ok(position >= 0 && position < install);
  }
  assert.match(enable, /\&\[\(native, ""\), \(browser, "_WEBVIEW2"\)\]/);
  assert.match(enable, /NETWORK_POLICY_LOCK\s*\.lock\(\)/);
  assert.match(enable, /remoteip=\{addresses\}/);
  assert.match(enable, /std::thread::spawn\(disable_network_lockdown_unlocked\)/);
  assert.match(enable, /program=/);
  const disable = windows.slice(
    windows.indexOf("pub fn disable_network_lockdown()"),
    windows.indexOf("fn disable_network_lockdown_unlocked()")
  );
  assert.match(disable, /NETWORK_POLICY_LOCK\s*\.lock\(\)/);
  assert.doesNotMatch(enable, /set.*firewallpolicy|outbound.*block/i);
  assert.match(
    desktop,
    /cfg\(target_os = "windows"\)\]\s*if !WANTS_FIREWALL \{\s*return Ok\(false\);/
  );
});

test("Windows hook diagnostics only read evidence and stay unavailable elsewhere", async () => {
  const desktop = await read("apps/desktop/src-tauri/src/lib.rs");
  const command = desktop.slice(
    desktop.indexOf("fn get_windows_hook_diagnostics()"),
    desktop.indexOf("fn apply_capture_protection(")
  );
  assert.match(command, /keyboard_hook_delivery_diagnostics\(\)/);
  assert.match(command, /cfg\(not\(target_os = "windows"\)\)[\s\S]*?None/);
  assert.doesNotMatch(command, /enable_keyboard_intercept|SendInput|SetWindowsHookExW/);
  assert.match(desktop, /get_windows_hook_diagnostics,\s*set_escape_blocked/);
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
