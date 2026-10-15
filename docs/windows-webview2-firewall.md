# Windows supervised firewall coverage

The optional supervised NSIS build packages an app-private Microsoft Fixed
Version WebView2 runtime. It verifies the active browser and every process in
WebView2's Environment8 inventory against that runtime before changing rules.
A successful installation covers the native AMS executable and the private
`msedgewebview2.exe` image using the existing IPv4/IPv6 address-complement policy.
Normal Windows builds remain unelevated and return `false` for network lockdown;
MSIX continues using that normal build. No host-wide outbound default or shared
Evergreen executable rule is installed.

## Build

Obtain and extract a matching-architecture **Fixed Version** runtime from
[Microsoft's official WebView2 distribution page](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).
Supply the directory containing `msedgewebview2.exe` and `icudtl.dat`:

```powershell
pnpm --filter @ams/desktop build:windows-supervised 'C:\Runtimes\Microsoft.WebView2.FixedVersionRuntime.VERSION.x64'
```

The wrapper sets `AMS_FIREWALL=1`, temporarily stages a junction named
`ams-supervised-webview2` in `src-tauri`, and selects Tauri's `fixedRuntime` mode
with that relative path. Tauri copies the runtime into the application directory;
the junction is removed after build success or failure without deleting the
supplied runtime. Pre-existing staging paths are refused. This avoids embedding
the builder's absolute runtime path in the installed application.

This build produces a per-machine NSIS installer and requests administrator
permission on every launch. The installer grants only sandbox read/execute
permissions on the private runtime using both application-package SIDs required
for Windows 10 Fixed Version 120+. MSI and MSIX are not supervised package
outputs. The ordinary build configuration is unchanged.

Fixed Version runtimes do not update automatically. The release owner must
replace the supplied official runtime, rebuild, test, and ship security updates.
Microsoft documents the distribution and ACL requirements in
[Distribute your app and the WebView2 Runtime](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution).
Expect more than 250 MB of additional unpacked runtime files; compressed installer
size depends on the selected runtime and has not been measured here.

## Identity, policy, and recovery

- The private runtime must resolve to a direct directory beside the canonical
  AMS executable on a local drive. Directory/image reparse escapes, shared
  Evergreen paths, missing browser PIDs, incomplete inventories and mismatched
  OS process images fail before policy mutation. Runtime selection configuration
  alone is insufficient: environment or registry overrides are caught by actual
  process-image verification.
- Open read handles deny image writes/replacement and directory renames for the
  policy lifetime. The OS process-image check is repeated immediately before
  installation, after installation, and every two seconds while active. A fresh
  inventory retry tolerates a child exiting between enumeration and image lookup.
  The periodic guard detects drift; it does not establish that a mismatched
  runtime was ever restricted. It records degraded/restored health transitions
  without ending the contest or discarding candidate work.
  The desktop admission probe returns false while a previously installed
  supervised policy has degraded identity verification; verified recovery or
  explicit successful disable clears that state.
- Replacement renderer/network-service processes running the same private image
  remain covered by executable-path rules. This is an application-installation
  boundary, not a per-PID, per-user, or hostile-administrator boundary. Another
  process deliberately launching this private image shares its restrictions.
- Both target policies share one cleanup and rollback boundary. Recovery deletes
  and verifies exactly `AMS_PROCTOR_BLOCK_ALL`, `AMS_PROCTOR_ALLOW`,
  `AMS_PROCTOR_BLOCK_ALL_WEBVIEW2`, and `AMS_PROCTOR_ALLOW_WEBVIEW2`. Similar names
  and unrelated rules are ignored. Failure to verify cleanup remains an error;
  retained identity handles are released only after verified normal recovery.
- Allowed domains resolve to IPs at engagement time. The rules constrain direct
  traffic for the two executable paths; they do not isolate a whole machine,
  constrain unrelated processes/system DNS, or promise DRM. No implicit DNS,
  loopback or proxy exception is added. The address-based policy allows every
  service at an allowed IP, and endpoint/CDN changes require re-engagement.

## Automated proof and remaining qualification

Local verification on 2026-10-15 used combined code revision `a0b9375`:
775 tests passed across the Rust workspace, web, desktop scripts, and API client.
The physical-host diagnostic and Linux-only helper staging check were not run
on this Windows host. The unsigned supervised installer was installed successfully
on Windows build 26200; installed app/runtime hashes, Microsoft runtime signature,
administrator manifest, and sandbox ACLs matched the verified build. Seven private
WebView2 processes were observed, and the operator confirmed the app opened normally.

Tauri reported a Windows sharing violation after producing the installer. Its
archive integrity, embedded image hashes, and actual installation passed independent
checks; the source of that post-output file lock remains unconfirmed. This startup
smoke test does not establish live hook-timeout recovery or firewall traffic coverage.

Focused tests use fake rule installers, synthetic inventories, detached COM
rules, and disposable local fixture files. They verify second-target rollback,
exact rule ownership, address complements, private/shared image rejection,
replacement-denying handles, stale guard invalidation, health recovery, and
safe package staging. No host firewall or registry mutation is required.
A tiny never-executed runtime fixture proves supervised compilation and Tauri's
resource destination; a tiny never-run NSIS fixture compiles the generated hook.
These checks are not a packaged traffic test.

Before shipping, install the real supervised package and test it interactively
on Windows 10 and 11 with effective firewall profiles enabled:

1. Verify both executable paths in the four exact-owned rules. Keep another
   unrelated Evergreen WebView2 application running and confirm its network
   access is unchanged.
2. Exercise allowed and denied IPv4 and IPv6 endpoints through both native HTTP
   and renderer fetch/navigation, including redirects and WebSocket connections.
   Check allowed API/judge/media flows, DNS behavior and proxy/VPN configurations.
3. Restart renderer/network-service processes, change WebView2 override selection,
   and confirm new private processes retain coverage while mismatched images
   produce explicit degraded health. A verification failure must not claim full
   renderer coverage.
4. Exercise normal disable, failed second-target installation, repeated enable,
   cleanup failure/retry, application crash and next-launch recovery. Confirm all
   exact-owned rules are absent after verified recovery and the host's default
   outbound policy has not changed.
5. Confirm normal unelevated and MSIX builds still launch without supervised
   runtime packaging or a UAC prompt. Complete the signed final-build smoke test.
