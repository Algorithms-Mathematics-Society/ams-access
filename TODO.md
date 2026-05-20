Full lockdown surface for exam shell:

  Already in repo (partial)

  - Always-on-top window
  - Dock hide
  - Process scanning

  ---
  Process & Execution

  - Kill disallowed processes — blacklist browsers, IDEs, terminals, screen recorders; kill on detect
  - Block new process spawning — Linux: seccomp execve filter; Windows: Job Objects; macOS: sandbox
  profiles
  - Monitor process tree — watch for re-launches of killed apps

  Input

  - Keyboard grab — exclusive grab so key combos don't reach OS (Alt+Tab, Super, Cmd+Space, etc.)
  - Clipboard wipe — clear on exam start, block reads/writes during exam
  - Mouse confinement — lock cursor to exam window (prevents multi-monitor escape)

  Display & Screen

  - Screenshot/screen capture block — Linux: no clean API, but detect recording processes; Windows:
  SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE); macOS: CGWindowListCreate monitoring
  - Virtual display detection — detect if running on VNC/RDP/TeamViewer framebuffer
  - Multi-monitor policy — either block secondary displays or mirror/blank them

  Peripherals

  - USB block — block mass storage / new HID device enumeration during exam
  - Bluetooth disable — rfkill on Linux, WinAPI, IOBluetooth on macOS

  Environment Detection

  - VM detection — CPUID hypervisor bit, DMI strings (VirtualBox, VMware, QEMU), timing attacks on RDTSC
  - Debug/hook detection — ptrace self-check (Linux), IsDebuggerPresent (Windows)
  - Sandbox detection — check for analysis tool artifacts

  Filesystem

  - Block access to sensitive paths — /proc, other users' home dirs, IDE config dirs
  - Disable external drives — unmount or block mount of USB storage

  Webview-level (Tauri/WRY)

  - Disable devtools in release builds (Tauri config flag)
  - Block right-click context menu
  - Intercept navigation — prevent webview from loading non-whitelisted URLs
  - Disable text selection copy — CSS + JS in the web layer

  Integrity / Anti-Tamper

  - Binary hash self-check — verify own executable hasn't been patched
  - Time sync check — compare local clock to NTP; flag drift → possible manipulation
  - Secure session token binding — bind session to machine fingerprint (CPU ID, MAC addr)

  ---
  Priority ordering for exam context

  ┌──────────┬────────────────────────┬───────────────┐
  │ Priority │        Lockdown        │  Difficulty   │
  ├──────────┼────────────────────────┼───────────────┤
  │ High     │ Process kill + monitor │ Medium        │
  ├──────────┼────────────────────────┼───────────────┤
  │ High     │ Keyboard grab          │ Medium        │
  ├──────────┼────────────────────────┼───────────────┤
  │ High     │ Network firewall       │ Medium        │
  ├──────────┼────────────────────────┼───────────────┤
  │ High     │ VM detection           │ Low           │
  ├──────────┼────────────────────────┼───────────────┤
  │ Medium   │ Screenshot block       │ Hard on Linux │
  ├──────────┼────────────────────────┼───────────────┤
  │ Medium   │ Clipboard wipe         │ Low           │
  ├──────────┼────────────────────────┼───────────────┤
  │ Medium   │ USB block              │ Hard          │
  ├──────────┼────────────────────────┼───────────────┤
  │ Low      │ Filesystem restriction │ High          │
  └──────────┴────────────────────────┴───────────────┘

  ---
  All of these live in platform-rs with OS-specific impls. core-rs ExamSession state machine gates them —
   lockdown on → Active, revert on → Ended. Want to start implementing any specific one?

✻ Worked for 24s

─────────────────────────────────────────────────────────────────────────────────────────────────────────
❯ start with process kill and keyboard grab
─────────────────────────────────────────────────────────────────────────────────────────────────────────
  [CAVEMAN]


