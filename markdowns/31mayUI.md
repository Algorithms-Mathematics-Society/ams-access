# AMS Access UI Documentation (May 31)

This document serves as a backup reference for the current UI state of the AMS Access application. It describes the layout, themes, and key components across the main screens.

## 1. Login Page (`/`)

- **Theme/Aesthetics:** Uses `Obsidian Dark` and `Cream Alabaster` themes. Background has an ambient grid pattern (`56px` by `56px`) with a central radial gradient spotlight.
- **Components:**
  - **Theme Toggle:** Top right absolute button to switch between dark and light modes.
  - **Login Card (Center):** Glassmorphism effect (`backdropFilter: blur(12px)`), absolute corner decals (L-shapes), and a top glow radial.
  - **Logo:** `AMS_ACCESS.svg` centered.
  - **Form Fields:** Email Address and Password with blinking cursor animations (`▎`) on focus. Inputs have mono fonts (`JetBrains Mono`, `IBM Plex Mono`).
  - **Continue Button:** Gradient background (`#7c3aed` to `#c084fc`) with a sweeping shine animation on hover.
  - **Divider:** "SECURITY GATE" text between lines.
  - **SSO Button:** Triggers an "Institution SSO Portal" modal stating it's currently unavailable.
  - **Secure Auto-Fill Keycard:** Floating action button below the main card to inject test credentials (`tester@ams.local`). Simulates a typing effect character by character.
  - **Error Toast:** Floating alert at top center (`rgba(220, 38, 38, 0.95)`) for invalid credentials.

## 2. Home Dashboard (`/home`)

- **Layout:** Flexbox layout with a fixed left sidebar (240px) and a main content area.
- **Sidebar:**
  - **Logo Area:** Custom SVG logo with gradient (`#7C3AED` to `#A78BFA`) and "ACCESS" text (letter spacing `0.4em`).
  - **Navigation:** Home, Settings, Diagnostics, Security Logs. Active items have a glowing accent pill on the left.
  - **Profile:** Bottom area showing user email ("Contestant Profile") with a generated avatar gradient. Sign-out button.
- **Main Content Area Views:**
  - **Home (Contestant Command Hub):**
    - Left Column: `SessionActionsPanel` (Invite code input, Active session resume) and `ContestsPanel` (List of invited contests).
    - Right Column (360px): `ReadinessWidget` (HUD for integrity scans like Camera, Mic, Network, Virtualization).
  - **Settings (Control Room Diagnostics):**
    - Sub-tabs (Hardware Diagnostics, Permissions Check, Security Environment, About / Legal) on the left.
    - Theme switcher (Obsidian Dark / Cream Alabaster) at the bottom of the sub-tab list.
    - **Hardware Tab:** Contains the "Camera Validation Capture" section. Features a 1.6 aspect ratio viewfinder, corner alignment HUD overlays, real-time camera stats (Resolution, FPS, Aspect Ratio), and streaming badges. Includes a Microphone Audio Analyzer and Speaker Frequency Tone Oscillator.
  - **Diagnostics (Integrity Telemetry Registry):** Network jitter, host reachability, hardware registers.
  - **Security Logs:** Real-time client telemetry scan and display configurations.

## 3. Onboarding / Readiness Checks (`/session/onboarding`)

- **Layout:** Stepper-based wizard UI for pre-contest lockdown and hardware validation.
- **Stages (15 Total):** Grouped into Workspace Lockdown, System Checks, Media Setup, Identity Scan, Finalizing.
- **UI Elements:**
  - **Stage Header:** Shows current step (e.g., "Step 1 of 15") and title.
  - **Animations:** Extensive use of CSS animations (pulse rings, fades).
  - **CheckLines:** Individual check items with status icons (Spinner, Pass ✓, Warn ⚠, Fail ✗).
  - **Status Badge:** Pill-shaped badge showing overall stage status.
  - **Specific Screens:**
    - _Monitor Detection:_ Visual representation of connected displays (MAIN, SCREEN 2) warning if multiple are found.
    - _Keyboard Setup:_ Grid showing locked shortcuts (Alt+Tab, Super, Alt+F4, PrintScreen).
    - _Application Check:_ Scans for restricted apps (OBS, Discord, Cheat Engine).

## 4. Contest Environment (`/session/contest`)

- **Layout:** Three-pane code editor structure (HTML, CSS, JS) mimicking a live web playground.
- **Top Bar:**
  - **Countdown Badge:** Tabular-nums countdown timer. Turns red with a pulsing animation when under 5 minutes ("urgent" state).
  - **Face Status / Proctoring:** Real-time indicator ("Face Status: ok/away").
  - **Actions:** Submit button, End Session.
- **Editor Area:**
  - Tabs for HTML, CSS, JS with distinct colors (`#f97316`, `#38bdf8`, `#facc15`).
  - Integrated live preview iframe/panel that updates on code change (debounced).
- **Overlays / Modals:**
  - **Restricted App Overlay:** Floating top toast warning of background apps. If the grace period expires, a full-screen blur modal locks the workspace until the app is closed.
  - **Face Grace Period:** Warning if the camera detects the user looking away for too long.
  - **Support Enclave:** Modal to report issues (e.g., camera not detected) with telemetry snapshot.
- **Security:** Full-screen lock, keyboard shortcut intercepts, continuous heartbeat, and process scanning.
