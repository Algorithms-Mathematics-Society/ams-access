// Custom Windows application manifest: brands the runtime exe as
// `requireAdministrator` so it cannot launch unelevated. Full exam lockdown
// (registry policy, per-process firewall rules) silently no-ops without
// elevation, so the OS must force a single UAC consent before the app starts —
// defense-in-depth alongside the readiness check that also blocks
// `windows_no_admin` (see remediation F2).
//
// This replaces tauri-build's default manifest, so it must keep the
// Common-Controls v6 dependency the default provides (required by Tauri's
// dialog APIs). The WindowsAttributes are ignored on non-Windows targets.
const WINDOWS_APP_MANIFEST: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency>
    <dependentAssembly>
      <assemblyIdentity
        type="win32"
        name="Microsoft.Windows.Common-Controls"
        version="6.0.0.0"
        processorArchitecture="*"
        publicKeyToken="6595b64144ccf1df"
        language="*"
      />
    </dependentAssembly>
  </dependency>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="requireAdministrator" uiAccess="false" />
      </requestedPrivileges>
    </security>
  </trustInfo>
</assembly>
"#;

fn main() {
    // Loader-level DLL-hijack hardening: set the default search for the exe's
    // statically-imported DLLs to DEFAULT_DIRS (app dir + System32 + user dirs),
    // dropping the insecure CWD/%PATH%. 0x1000 = LOAD_LIBRARY_SEARCH_DEFAULT_DIRS,
    // consistent with the runtime SetDefaultDllDirectories call. (0x800 would be
    // System32-only and could break app-local DLLs.) Windows+MSVC only.
    // NOTE: needs a real Windows smoke-test before release.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        println!("cargo:rustc-link-arg-bins=/DEPENDENTLOADFLAG:0x1000");
    }

    let attributes = tauri_build::Attributes::new().windows_attributes(
        tauri_build::WindowsAttributes::new().app_manifest(WINDOWS_APP_MANIFEST),
    );
    tauri_build::try_build(attributes).expect("failed to run tauri build script");
}
