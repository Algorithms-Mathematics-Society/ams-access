# Microsoft Store packaging

## Why this exists, and what it costs

The Store re-signs whatever you upload. That means a signed installer with no
certificate to buy, and no "Windows protected your PC" for candidates — which
is the entire reason for going this route.

The cost is exact and non-negotiable:

> **An MSIX process can never run elevated.** MSIX has no equivalent of the
> `requireAdministrator` manifest the installer build embeds. Packaged
> processes always run as the invoking user, and there is no capability that
> changes it.

So a Store build **cannot raise a network firewall.** `netsh advfirewall`
needs elevation and will fail. A candidate on a Store build can open a
browser.

Everything else is unaffected: keyboard interception, capture protection,
process scanning, presence monitoring, always-on-top. Process handling is
strictly detection-only: the candidate closes any flagged application and
runs the scan again; AMS Access never terminates another process.

The Store build also leaves Windows user settings untouched. MSIX virtualizes
HKCU writes into a private package hive, so attempting to set `DisableTaskMgr`,
Game Bar, or touchpad policy values would be both invasive and ineffective.
Those registry controls remain exclusive to the unpackaged client.

The app knows which it is. A Store build reports its platform as
`windows_msix` rather than `windows` or `windows_no_admin`, so the
invigilation console can distinguish _"Store build, no firewall by design"_
from _"this candidate could not elevate on their own machine"_ — those look
identical otherwise and need completely different responses.

**Neither Windows client is code-signed by us, and that is settled** — no
certificate is being bought. Since `asInvoker` became the default, the two
builds also behave identically: neither asks for administrator, and neither
raises a network firewall unless built with `AMS_FIREWALL=1`.

So the only difference left is the install experience:

|                                               | Direct download  | Store (this)              |
| --------------------------------------------- | ---------------- | ------------------------- |
| SmartScreen warning                           | once, at install | none — Microsoft signs it |
| Administrator prompt                          | none             | none                      |
| Lockdown, camera, capture guard, process scan | yes              | yes                       |
| Network firewall                              | no               | no, and cannot            |

The Store build is the nicer front door. Keep the direct download as the
fallback, and as the escape hatch for a fix you need live today when
certification would take three.

`AMS_FIREWALL=1` is the exception: it restores the OS-level firewall for a
contest that wants it, at the cost of a UAC prompt on every launch — and such
a build **cannot be packaged as MSIX at all**, because packaged processes can
never be elevated.

---

## Getting a Partner Center account

1. Register at <https://partner.microsoft.com/dashboard>. There is a small
   one-time registration fee (individual accounts are cheaper than company
   accounts, and are free in some markets — the dashboard quotes the current
   figure for yours).
2. Reserve the app name under **Apps and games → New product → MSIX or PWA**.
3. Open **Product identity**. It gives you three values you cannot guess:

   | Partner Center field                    | Used as                       |
   | --------------------------------------- | ----------------------------- |
   | Package/Identity/Name                   | `MSIX_PACKAGE_NAME`           |
   | Package/Identity/Publisher              | `MSIX_PUBLISHER`              |
   | Package/Properties/PublisherDisplayName | `MSIX_PUBLISHER_DISPLAY_NAME` |

   `Publisher` must match the certificate the Store signs with **byte for
   byte**, including the `CN=` prefix. Copy it, do not retype it.

---

## Building

Two steps, and the first one matters:

```powershell
# 1. Build. asInvoker is the default, so nothing special is needed — just make
#    sure AMS_FIREWALL is NOT set, since that produces a requireAdministrator
#    binary an MSIX cannot launch.
pnpm tauri build --target x86_64-pc-windows-msvc

# 2. Package it.
$env:MSIX_PACKAGE_NAME = "<from Partner Center>"
$env:MSIX_PUBLISHER = "CN=<from Partner Center>"
$env:MSIX_PUBLISHER_DISPLAY_NAME = "<from Partner Center>"
./apps/desktop/msix/build-msix.ps1
```

The result lands in `target/msix/`. It is **unsigned on purpose** — that is
what the Store signs. Upload it to your submission and let Microsoft do the
rest.

For a release artifact, configure the GitHub `microsoft-store` environment
with these three secrets and run the **Microsoft Store package** workflow:

- `MSIX_PACKAGE_NAME`
- `MSIX_PUBLISHER`
- `MSIX_PUBLISHER_DISPLAY_NAME`

That workflow refuses placeholder identity, builds the release on Windows,
unpacks the result, verifies the exact Partner Center identity and four-part
version, and uploads `microsoft-store-msix` for submission.

The script refuses to package a `requireAdministrator` binary. That guard is
there because the failure is silent and expensive: the package builds,
installs, appears in the Start menu, and does nothing at all when clicked.

### Testing it locally

Sideloading needs a signature, so for a local test only:

```powershell
./apps/desktop/msix/build-msix.ps1 -SelfSign
```

The machine has to trust the throwaway certificate before it will install.
Never submit a self-signed package.

---

## What is actually in the package

Seven entries, and that is correct:

```
AppxManifest.xml
ams-access.exe          ~16 MB
Assets/                 four logos
resources/icon.ico
```

The blazeface model and the tfjs WASM backends are **not** separate files.
They live in `apps/web/public`, so the static export carries them and
`frontendDist` compiles them into the executable — which is why the binary is
~16 MB rather than ~2 MB, and why `resources/` holds an icon and nothing else.
CI asserts the executable's size for exactly this reason: one that had lost
its embedded frontend would still package, still install, and then fail at the
face scan in front of a candidate.

The bundle resources that are _not_ embedded are the macOS and Linux
privileged helpers, which Windows never uses.

## Certification submission

CI self-signs the development package, installs it, launches the packaged app,
and runs the Windows App Certification Kit. This proves package activation in
an MSIX identity rather than only proving that `makeappx` accepted the files.

Partner Center certification is still the authority. The package declares the
restricted `runFullTrust` capability, so the submission must explain that it
is required for an explicitly started proctored contest session: foreground
keyboard interception, capture exclusion, restricted-process detection, and
focus monitoring. State clearly that the app does not elevate, install a
service or driver, alter the firewall, terminate other applications, or change
Windows registry policies in the Store build.

Provide a working certification account and exact steps to reach a test
contest. Also provide the public privacy-policy URL, support contact, and notes
explaining the camera and microphone readiness/proctoring flow. Without those
items Microsoft cannot exercise the primary functionality and may reject the
submission as untestable.
