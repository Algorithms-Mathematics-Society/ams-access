# Installing AMS Access on Windows

**AMS Access is not code-signed.** Windows will say it protected your PC, and
the installer will ask for an administrator. Both are expected. This page is
the reason why, and what to do about it.

Read the whole page before contest day. Two of these steps are things you want
to have done in advance, not in front of a queue.

---

## Why the warning appears

Windows SmartScreen warns about any installer it has not seen signed by a
publisher it recognises. A code-signing certificate is what removes the
warning, and we do not have one yet.

The uncomfortable part, said plainly: **the warning you are about to click
through is the same warning malware produces.** An unsigned installer asking
for administrator rights is, from Windows' point of view, indistinguishable
from something hostile. That is precisely why the checksum step below is not
optional ceremony — it is the only thing standing in for the signature.

---

## Before contest day (organisers)

Do this once, on your own machine, and ideally more than a day ahead.

### 1. Download the installer

From the release page, take **one** of:

| File                             | When                               |
| -------------------------------- | ---------------------------------- |
| `AMS.Access_2.0.0_x64-setup.exe` | Normal choice                      |
| `AMS.Access_2.0.0_x64_en-US.msi` | Deploying by Group Policy / Intune |

Also download `SHA256SUMS-x86_64-pc-windows-msvc.txt`.

### 2. Verify the checksum — do not skip this

Put the sums file in the same folder as the installer, open PowerShell there,
and run:

```powershell
Get-FileHash .\AMS.Access_2.0.0_x64-setup.exe -Algorithm SHA256
```

Compare the hash against the line for your file in
`SHA256SUMS-x86_64-pc-windows-msvc.txt`. They must match **exactly**,
character for character. Case does not matter; anything else does.

If you have WSL or Git Bash, this compares them for you:

```bash
sha256sum -c SHA256SUMS-x86_64-pc-windows-msvc.txt
```

You want to see `OK` on the line for the file you downloaded.

> Where the sums file comes from matters. A checksum served from the same
> place as the installer only proves the download was not corrupted in
> transit — if that page were compromised, both would be. Where you can, get
> the sums file through a different channel from the installer: read it out
> over the phone, send it in a signed email, put it in a document your
> candidates already trust.

**If the hash does not match, stop.** Do not install it, and do not distribute
it. Tell whoever is running the contest.

### 3. Install it on one machine and open it once

Confirm it launches and reaches the sign-in screen before you touch the
contest-hall machines. This is also when you find out whether your antivirus
quarantines it, which is much better to discover now.

### 4. If you manage the hall's machines, pre-install

Every step below that a candidate does not have to do on the morning is a
step that cannot go wrong at 9am. The `.msi` can be deployed by Group Policy
or Intune and installs without any of the prompts described here.

---

## Getting past the warning (the desk script)

If candidates are installing it themselves, this is the script. It is written
to be read aloud.

> Windows will show a blue box saying **"Windows protected your PC"**.
> This is expected — our installer isn't signed yet.
>
> Click **More info**.
>
> Then click **Run anyway**.
>
> Windows will then ask if you want to allow the app to make changes to your
> device. Click **Yes**.

That is the whole thing. The two clicks are `More info` → `Run anyway`, and
the reason candidates get stuck is that **`Run anyway` is not visible until
`More info` is clicked** — the first screen looks like a dead end with only
an OK button.

### If there is no "Run anyway"

The machine is locked down harder than default. In order:

- **A managed/school device.** SmartScreen may be enforced by policy with no
  override. You need the machine's administrator; a candidate cannot fix
  this. Fall back to a spare machine.
- **Antivirus quarantined the file.** Check the AV's quarantine list. Restore
  it only after you have verified the checksum.
- **The file is "blocked" because it came from the internet.** Right-click
  the installer → Properties → tick **Unblock** at the bottom → OK. Then run
  it again.

### If it still will not install

Use a spare machine. Do not spend a contest's opening minutes debugging one
laptop while a hall waits — that is what the spares are for.

---

## What we are doing about it

Signing is a purchase and a validation process, not a code change. The
release pipeline is already wired for it: adding the certificate as two
repository secrets is the whole change, and the next tagged release comes out
signed with no edit to any workflow.

Until then this page is the honest version of what candidates will see.
