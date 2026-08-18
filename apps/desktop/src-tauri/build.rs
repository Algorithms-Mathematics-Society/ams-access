// Custom Windows application manifest.
//
// **The default is `asInvoker`, and that is a deliberate product decision.**
// The only thing on Windows that needs elevation is `netsh advfirewall` — the
// network lockdown. Everything else in the proctoring surface works as a
// normal user: keyboard interception, capture protection, restricted-app
// scanning, presence, and the Task Manager / Explorer policies, which are
// written under HKCU.
//
// The cost of asking for elevation was not one prompt. `requireAdministrator`
// prompts on *every launch*, on a contestant's own laptop, at home, forever.
// A code-signing certificate would not have changed that — a signed
// requireAdministrator app prompts exactly the same — so dropping it buys
// more than signing would have.
//
// **AMS_FIREWALL=1 asks for elevation back**, for a contest where blocking
// internet access at the OS level is worth a UAC prompt every launch. Nothing
// else in the build changes; the app simply becomes able to run netsh.
//
// An MSIX/Store build must never set it: packaged processes cannot be
// elevated at all, and a requireAdministrator binary inside an MSIX will not
// launch. `msix/build-msix.ps1` refuses one rather than shipping it.
//
// This replaces tauri-build's default manifest, so it must keep the
// Common-Controls v6 dependency the default provides (required by Tauri's
// dialog APIs). The two manifests differ in exactly one element and come from
// one template with a substitution, rather than two literals: a
// Common-Controls dependency that drifted between them would give dialogs
// that work in one build and not the other.
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

    // Rebuild when the choice changes, or a `cargo build` after flipping the
    // flag would reuse an executable manifested for the other one — a firewall
    // build that cannot elevate, or a normal build that prompts anyway.
    println!("cargo:rerun-if-env-changed=AMS_FIREWALL");
    let firewall = std::env::var("AMS_FIREWALL").as_deref() == Ok("1");
    let execution_level = if firewall {
        "requireAdministrator"
    } else {
        "asInvoker"
    };
    // Read back at runtime. Startup auto-elevation and the network-lockdown
    // commands both consult this: without it an asInvoker build would still
    // try to elevate on launch, raising the exact UAC prompt this exists to
    // remove, and would then call netsh only to be refused.
    println!(
        "cargo:rustc-env=AMS_FIREWALL_BUILD={}",
        if firewall { "1" } else { "0" }
    );
    if firewall {
        println!(
            "cargo:warning=AMS_FIREWALL=1 — requireAdministrator. This build prompts for \
             elevation on EVERY launch, and cannot be packaged as MSIX."
        );
    }
    let manifest = WINDOWS_APP_MANIFEST.replace(EXECUTION_LEVEL_PLACEHOLDER, execution_level);

    let attributes = tauri_build::Attributes::new()
        .windows_attributes(tauri_build::WindowsAttributes::new().app_manifest(&manifest));
    tauri_build::try_build(attributes).expect("failed to run tauri build script");
}
