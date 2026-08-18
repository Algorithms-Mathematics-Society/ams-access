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
//
// **AMS_MSIX=1 switches the execution level to `asInvoker`.** MSIX has no
// equivalent of `requireAdministrator` — packaged processes always run as the
// invoking user — and an embedded `requireAdministrator` manifest stops a
// packaged app launching at all. So the Store build must ask for less, and
// the cost is exact and known: `netsh advfirewall` fails, and there is no
// network lockdown on a Store install. Everything else (keyboard interception,
// capture protection, process scanning, presence) works unelevated and is
// unchanged. The running app reports itself as `windows_msix` so an
// invigilator can see which client they are looking at.
//
// The two manifests differ in exactly one element. Keeping them as one string
// with a substitution, rather than two literals, is deliberate: a
// Common-Controls dependency that drifted between them would produce a build
// where Tauri's dialogs work in one packaging and not the other.
const EXECUTION_LEVEL_PLACEHOLDER: &str = "@EXECUTION_LEVEL@";

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
        <requestedExecutionLevel level="@EXECUTION_LEVEL@" uiAccess="false" />
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

    // Rebuild when the packaging switches, or a `cargo build` after flipping
    // AMS_MSIX would reuse an executable manifested for the other one — an
    // installer build that cannot elevate, or a Store build that cannot start.
    println!("cargo:rerun-if-env-changed=AMS_MSIX");
    let msix = std::env::var("AMS_MSIX").as_deref() == Ok("1");
    let execution_level = if msix {
        "asInvoker"
    } else {
        "requireAdministrator"
    };
    if msix {
        println!(
            "cargo:warning=AMS_MSIX=1 — building with asInvoker. This client CANNOT \
             raise a network firewall; keyboard, capture and process proctoring are \
             unaffected."
        );
    }
    let manifest = WINDOWS_APP_MANIFEST.replace(EXECUTION_LEVEL_PLACEHOLDER, execution_level);

    let attributes = tauri_build::Attributes::new()
        .windows_attributes(tauri_build::WindowsAttributes::new().app_manifest(&manifest));
    tauri_build::try_build(attributes).expect("failed to run tauri build script");
}
