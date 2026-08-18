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
process scanning, presence monitoring, always-on-top.

The app knows which it is. A Store build reports its platform as
`windows_msix` rather than `windows` or `windows_no_admin`, so the
invigilation console can distinguish *"Store build, no firewall by design"*
from *"this candidate could not elevate on their own machine"* — those look
identical otherwise and need completely different responses.

**Neither Windows client is code-signed by us, and that is a settled
decision** — no certificate is being bought. So the choice between them is not
signed-versus-unsigned; it is *firewall* versus *friction*:

| | NSIS/MSI installer | Store build (this) |
|---|---|---|
| SmartScreen warning | yes, every machine | none — Microsoft signs it |
| Administrator prompt | yes | none |
| Network locked down | **yes** | no |
| Keyboard, camera, capture guard, process scan | yes | yes |

Use the installer when a candidate opening a browser would matter, and wear
the two clicks (they are scripted in `WINDOWS-INSTALL.md`). Use this build for
practice, rehearsal, and pre-installing on hall machines, where painless
deployment is worth more than a firewall you were not relying on.

---

## Getting a Partner Center account

1. Register at <https://partner.microsoft.com/dashboard>. There is a small
   one-time registration fee (individual accounts are cheaper than company
   accounts, and are free in some markets — the dashboard quotes the current
   figure for yours).
2. Reserve the app name under **Apps and games → New product → MSIX or PWA**.
3. Open **Product identity**. It gives you three values you cannot guess:

   | Partner Center field | Used as |
   |---|---|
   | Package/Identity/Name | `MSIX_PACKAGE_NAME` |
   | Package/Identity/Publisher | `MSIX_PUBLISHER` |
   | Package/Properties/PublisherDisplayName | `MSIX_PUBLISHER_DISPLAY_NAME` |

   `Publisher` must match the certificate the Store signs with **byte for
   byte**, including the `CN=` prefix. Copy it, do not retype it.

---

## Building

Two steps, and the first one matters:

```powershell
# 1. Build with the asInvoker manifest. Without AMS_MSIX=1 you get a binary
#    manifested requireAdministrator, which an MSIX cannot launch at all.
$env:AMS_MSIX = "1"
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

The bundle resources that are *not* embedded are the macOS and Linux
privileged helpers, which Windows never uses.

## Still unverified

Two things need a real Windows machine and have not been checked:

- **Registry virtualisation.** MSIX redirects HKCU writes into the package's
  private hive. `DisableTaskMgr` may therefore write somewhere that does not
  affect the actual system, which would mean Task Manager stays available on a
  Store build. Test it before relying on it.
- **Store certification.** An app that disables Task Manager and intercepts
  Alt+Tab runs into the Store policies about interfering with OS
  functionality. Expect questions about `runFullTrust`; the honest answer is
  proctoring. Do not schedule a contest around winning that review.
