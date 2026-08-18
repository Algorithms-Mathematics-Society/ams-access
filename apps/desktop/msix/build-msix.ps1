<#
.SYNOPSIS
  Package the built Tauri app as MSIX for the Microsoft Store.

.DESCRIPTION
  Tauri has no MSIX bundle target, so this stages the build output and calls
  `makeappx` from the Windows SDK directly.

  Two things to understand before using this:

  1. **The app must have been built with AMS_MSIX=1.** That switches the
     embedded manifest from `requireAdministrator` to `asInvoker`. An MSIX
     containing a `requireAdministrator` executable will not launch at all —
     packaged processes always run as the invoking user, and MSIX has no
     equivalent of that manifest. This script refuses to run if it can see the
     wrong one.

  2. **The resulting package is deliberately unsigned.** The Store re-signs on
     submission, which is the entire reason for going this route — no
     certificate to buy, and no SmartScreen prompt for candidates. Pass
     -SelfSign only to sideload it for local testing; such a package is not
     what you submit.

.PARAMETER Target
  Rust target triple. Defaults to x86_64-pc-windows-msvc.

.PARAMETER PackageName
  Partner Center "Package/Identity/Name". Store submissions reject anything
  else, so this has no useful default for real use.

.PARAMETER Publisher
  Partner Center "Package/Identity/Publisher" — the full `CN=...` string,
  which must match byte for byte what the Store signs with.

.PARAMETER PublisherDisplayName
  The human-readable publisher shown in the Store listing.

.PARAMETER SelfSign
  Create a throwaway certificate and sign, so the package can be sideloaded
  for testing. Never use this for a submission.
#>
[CmdletBinding()]
param(
  [string]$Target = "x86_64-pc-windows-msvc",
  [string]$PackageName = $env:MSIX_PACKAGE_NAME,
  [string]$Publisher = $env:MSIX_PUBLISHER,
  [string]$PublisherDisplayName = $env:MSIX_PUBLISHER_DISPLAY_NAME,
  [switch]$SelfSign
)

$ErrorActionPreference = "Stop"

# Placeholders that let the package build and sideload without Partner Center
# details. They are obviously fake so a real submission cannot be made with
# them by accident.
if (-not $PackageName)          { $PackageName = "AMSAccess.Development" }
if (-not $Publisher)            { $Publisher = "CN=AMS Access Development" }
if (-not $PublisherDisplayName) { $PublisherDisplayName = "AMS Access (development build)" }

$repoRoot  = (Resolve-Path "$PSScriptRoot\..\..\..").Path
$msixDir   = $PSScriptRoot
$releaseDir = Join-Path $repoRoot "target\$Target\release"
$stage     = Join-Path $repoRoot "target\msix-stage"
$outDir    = Join-Path $repoRoot "target\msix"

# ── version ────────────────────────────────────────────────────────────────
# MSIX versions are four-part and the Store requires the revision to be 0, so
# a semver of 2.0.0 becomes 2.0.0.0. A pre-release suffix has nowhere to go in
# an MSIX version, so it is dropped rather than silently mangled.
$pkgJson = Get-Content (Join-Path $repoRoot "apps\desktop\package.json") -Raw | ConvertFrom-Json
$semver  = $pkgJson.version
$core    = ($semver -split "-")[0]
$parts   = $core -split "\."
if ($parts.Count -ne 3) { throw "cannot read a three-part version from '$semver'" }
$version = "$($parts[0]).$($parts[1]).$($parts[2]).0"
Write-Host "version: $semver -> $version"

# ── locate the executable ──────────────────────────────────────────────────
# Cargo names it after the crate; Tauri renames it to productName only when it
# bundles. Staging from target/release means we get the crate name.
$exe = Get-ChildItem -Path $releaseDir -Filter "ams-access.exe" -ErrorAction SilentlyContinue |
       Select-Object -First 1
if (-not $exe) {
  throw "no ams-access.exe in $releaseDir — build first with: AMS_MSIX=1 pnpm tauri build --target $Target"
}

# ── refuse a build that cannot launch ──────────────────────────────────────
# The failure this prevents is nasty: the package builds, installs, appears in
# the Start menu, and then does nothing at all when clicked, with no error the
# candidate can act on.
# The embedded manifest is UTF-8 XML sitting in the binary's resource section,
# so looking for the string is enough and needs no SDK tool.
$exeBytes = [IO.File]::ReadAllBytes($exe.FullName)
$exeText  = [Text.Encoding]::UTF8.GetString($exeBytes)
if ($exeText -match "requireAdministrator") {
  throw @"
This executable is manifested requireAdministrator, which an MSIX package
cannot launch. Rebuild with AMS_MSIX=1 set, which switches it to asInvoker:

  `$env:AMS_MSIX = '1'; pnpm tauri build --target $Target

Be aware of what that costs: the resulting client cannot raise a network
firewall. Keyboard, capture protection, process scanning and presence are
unaffected.
"@
}

# ── stage ──────────────────────────────────────────────────────────────────
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stage "Assets") -Force | Out-Null

Copy-Item $exe.FullName (Join-Path $stage $exe.Name)

# Resources Tauri would have placed beside the executable in an installer.
# Without these the blazeface model and the platform helpers are missing and
# the identity checks fail at runtime rather than at package time.
$resourceSrc = Join-Path $releaseDir "resources"
if (Test-Path $resourceSrc) {
  Copy-Item $resourceSrc (Join-Path $stage "resources") -Recurse
  Write-Host "staged resources/"
} else {
  Write-Warning "no resources/ in $releaseDir — face scan and presence will fail at runtime"
}

# WebView2 loader, when the build produced one beside the exe.
Get-ChildItem -Path $releaseDir -Filter "*.dll" -ErrorAction SilentlyContinue |
  ForEach-Object { Copy-Item $_.FullName (Join-Path $stage $_.Name) }

# Store logos. Tauri's icon generator already produces the Square*/StoreLogo
# set, so there is nothing to draw here.
$icons = Join-Path $repoRoot "apps\desktop\src-tauri\icons"
# Exactly the set the manifest names. Shipping more is dead weight; shipping
# fewer fails packaging.
foreach ($logo in @("StoreLogo.png","Square44x44Logo.png",
                    "Square71x71Logo.png","Square150x150Logo.png")) {
  $src = Join-Path $icons $logo
  if (-not (Test-Path $src)) { throw "missing icon $logo — makeappx fails on a manifest naming an absent asset" }
  Copy-Item $src (Join-Path $stage "Assets\$logo")
}

Write-Host "── staged ──"
Get-ChildItem $stage -Recurse -File |
  ForEach-Object { Write-Host ("  {0,10:N0}  {1}" -f $_.Length, $_.FullName.Substring($stage.Length + 1)) }
$staged = (Get-ChildItem $stage -Recurse -File).Count
Write-Host "$staged file(s) staged"

# ── manifest ───────────────────────────────────────────────────────────────
$manifest = Get-Content (Join-Path $msixDir "AppxManifest.xml") -Raw
$manifest = $manifest.Replace("@PACKAGE_NAME@",          $PackageName)
$manifest = $manifest.Replace("@PACKAGE_PUBLISHER@",     $Publisher)
$manifest = $manifest.Replace("@PACKAGE_VERSION@",       $version)
$manifest = $manifest.Replace("@PUBLISHER_DISPLAY_NAME@",$PublisherDisplayName)
$manifest = $manifest.Replace("@EXECUTABLE@",            $exe.Name)
if ($manifest -match "@[A-Z_]+@") {
  throw "unsubstituted placeholder left in AppxManifest: $($Matches[0])"
}
Set-Content -Path (Join-Path $stage "AppxManifest.xml") -Value $manifest -Encoding UTF8

# ── pack ───────────────────────────────────────────────────────────────────
$makeappx = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Recurse -Filter makeappx.exe -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match "x64" } |
            Sort-Object FullName -Descending | Select-Object -First 1
if (-not $makeappx) { throw "makeappx.exe not found — install the Windows 10/11 SDK" }

New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$msix = Join-Path $outDir "AMSAccess_${version}_x64.msix"
if (Test-Path $msix) { Remove-Item $msix -Force }

& $makeappx.FullName pack /d $stage /p $msix /o
if ($LASTEXITCODE -ne 0) { throw "makeappx failed with $LASTEXITCODE" }
Write-Host "packed: $msix"

# ── optional self-signature, for sideload testing only ─────────────────────
if ($SelfSign) {
  Write-Host "self-signing for local sideload (NOT for submission)"
  $cert = New-SelfSignedCertificate -Type Custom -Subject $Publisher `
            -KeyUsage DigitalSignature -FriendlyName "AMS Access MSIX test" `
            -CertStoreLocation "Cert:\CurrentUser\My" `
            -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3","2.5.29.19={text}")
  $signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
              Where-Object { $_.FullName -match "x64" } |
              Sort-Object FullName -Descending | Select-Object -First 1
  if (-not $signtool) { throw "signtool.exe not found" }
  & $signtool.FullName sign /fd SHA256 /sha1 $cert.Thumbprint $msix
  if ($LASTEXITCODE -ne 0) { throw "signtool failed with $LASTEXITCODE" }
  Write-Host "signed with a throwaway certificate; the machine must trust it to sideload"
}
