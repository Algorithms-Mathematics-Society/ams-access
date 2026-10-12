# WIN-009: Windows WebView2 egress qualification

**Result: not yet enforceable per owned instance with the current `netsh`/COM
backend.** Do not describe a supervised Windows session as having full renderer
lockdown. The native `program=` rules in `packages/platform-rs/src/windows/mod.rs`
select the AMS executable, not the separate WebView2 runtime executable. Applying
the same rules to `msedgewebview2.exe` would also affect unrelated applications;
changing the host-wide outbound default would have the same problem. The
opt-in Windows firewall still installs the native address-complement rules,
with rollback and instance ownership as before. A successful native install
can return `true` even though renderer egress remains unrestricted; treat that
result as **native-executable coverage only**, not full lockdown. The ordinary
no-firewall build continues returning `false` without attempting installation.
Neither CSP nor Chromium browser proxy flags are an OS enforcement boundary.

## Evidence and scope

- The pinned `Cargo.lock` uses `tauri` 2.11.2, `wry` 0.55.1 and
  `webview2-com-sys` 0.38.2. Installed `wry` source
  (`src/webview2/mod.rs`, `create_environment`) creates a WebView2 environment
  with a user-data directory and browser arguments; neither is an OS network
  policy. Installed Tauri source (`src/webview/mod.rs`, `with_webview`) exposes
  native WebView access, but access alone does not enforce egress for its process
  group.
- [Microsoft's WebView2 process model](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-model)
  describes one browser plus changing renderer/helper processes per user-data
  folder; different WebViews using the folder can share renderer processes.
  The pinned `webview2-com-sys` bindings expose environment
  `ICoreWebView2Environment8::GetProcessInfos`, which can enumerate processes,
  but enumeration is not an atomic, persistent network enforcement boundary.
- [Microsoft's WFP condition list](https://learn.microsoft.com/en-us/windows/win32/fwp/filtering-condition-identifiers-)
  documents `FWPM_CONDITION_ALE_APP_ID` as an executable path,
  `FWPM_CONDITION_ALE_PACKAGE_ID` as an AppContainer SID and
  `FWPM_CONDITION_ALE_USER_ID` as a user security descriptor. An executable-path
  rule for the shared runtime is not per AMS instance. No documented,
  verified per-WebView PID selector has been established here; a package/token
  approach needs proof that **every** renderer/network-service flow carries
  an AMS-only identity, including unpackaged and MSIX builds. A dedicated
  user-data directory by itself does not establish that identity at WFP.

## Unresolved design decision and next gate

The owner must decide how to establish an AMS-only OS identity for **all**
WebView2 egress processes and which Windows-supported WFP backend can enforce
that identity, or review another per-instance boundary. The current netsh/COM
program-path backend cannot safely apply its native rules to the shared
WebView2 executable. Browser proxy flags and CSP alone cannot close that gap.
Do not add a shared global runtime block as a workaround.

Before proposing a new dependency or changing the security policy, prototype
and verify identity and WFP classification across runtime process
creation/restarts, native HTTP, IPv4/IPv6, DNS, redirects, unpackaged and MSIX
installs, and another unrelated WebView2 app on the same host. Review
privilege, lifecycle, cleanup/rollback and failure reporting before connecting
that prototype to the existing native address-complement rules. This is a
design gate, **not** a passing hardware traffic test; no host firewall or
registry was changed for this feasibility review.
