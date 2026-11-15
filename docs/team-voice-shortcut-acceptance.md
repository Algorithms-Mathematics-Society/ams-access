# Team voice shortcut acceptance (#323)

Status: native acceptance is **not yet run**. Source/unit checks do not prove that
an OS or desktop compositor delivers a key combination to the packaged WebView.

Code evidence:

- Windows `keyboard_policy::should_block` permits Ctrl+Shift+M on press/release;
  the policy regression test covers this with lockdown Escape protection active.
- Linux lockdown disables configured GNOME/KDE shell shortcuts; it does not
  implement a blanket Ctrl+Shift letter filter. Custom desktop shortcuts can
  still intercept keys and require device testing.
- macOS lockdown's native keyboard tap passes Control-Shift with any letter, so
  ⌃⇧M (Control-Shift-M) reaches the WebView. Command-Shift-M is blocked by the
  native tap, `keyboard_policy.rs` and the contest's blocked Command shortcuts;
  the shortcut is Control on Mac, never Command. The Mac hint reads
  "⌃⇧M (Control-Shift-M)" and both Mute buttons carry
  `aria-keyshortcuts="Control+Shift+M"` (#369).
- The chord matches the typed letter M (`event.key`), so AZERTY and Dvorak use
  their own M key; the physical US M position is used only when the layout types
  no ASCII character there, e.g. Cyrillic (#365). While voice is still connecting
  the chord is consumed but does not unmute (#367).
- The WebView handles the chord during window capture, before editor target
  handlers, prevents its default action, and stops propagation. Held-key repeats
  are consumed without toggling again. Suspended/invalid/absent voice sessions do
  not consume the chord.

Run on packaged Windows 10 and 11, each supported Linux distribution/session
(GNOME/KDE, X11/Wayland as supported), and the macOS matrix below. Record app
version, OS, compositor, keyboard layout, and results for every case; leave #323 open until all required cases pass.

1. Join a real team contest with active lockdown and a connected teammate. Start
   muted. Confirm the visible mic button toggles correctly first.
2. Focus the code editor, place the cursor in a known line, press Ctrl+Shift+M
   once. Verify Live state and teammate audio reception. Confirm editor text,
   selection, and command UI did not change. Press again; verify muted locally
   and that the teammate no longer hears audio.
3. Hold the chord for two seconds. It must toggle once, with no repeat toggles or
   editor command. Release and press again; it must toggle once again.
4. Repeat with focus on a non-editor control and with the voice popover open.
5. While a blocking contest overlay suspends controls, confirm the shortcut does
   not alter mute state. After dismissing it, verify the shortcut works again.
6. Leave voice and press the chord; it must not reconnect or acquire a microphone.
7. Repeat after a transient team poll failure and voice reconnect. Confirm one
   key press causes one toggle, with no duplicate listeners.

## macOS matrix

Run on the packaged, notarised app installed in /Applications, under active
lockdown, with a connected teammate. Record app version, macOS version, Mac
model (Intel or Apple Silicon), input source and result for every row. The
WebView reports `MacIntel` on both architectures.

| macOS                                 | Hardware      | Input source    | Chord                                 | Expected                                                  |
| ------------------------------------- | ------------- | --------------- | ------------------------------------- | --------------------------------------------------------- |
| 12 Monterey (oldest WebKit available) | Intel         | U.S.            | ⌃⇧M                                   | Toggles once; hint and VoiceOver announce Control-Shift-M |
| 13 Ventura                            | Intel         | U.S.            | ⌃⇧M                                   | Toggles once                                              |
| 14 Sonoma                             | Apple Silicon | U.S.            | ⌃⇧M                                   | Toggles once                                              |
| 15 Sequoia                            | Apple Silicon | French (AZERTY) | ⌃⇧ + key labelled M                   | Toggles once                                              |
| 15 Sequoia                            | Apple Silicon | French (AZERTY) | ⌃⇧ + key labelled ,/? (US M position) | No toggle; editor unchanged                               |
| 26 Tahoe                              | Apple Silicon | Dvorak          | ⌃⇧ + key labelled M                   | Toggles once                                              |
| 26 Tahoe                              | Apple Silicon | Russian         | ⌃⇧ + US M position (Ь)                | Toggles once (physical fallback)                          |
| 27                                    | Apple Silicon | U.S.            | ⌃⇧M                                   | Toggles once                                              |
| Any                                   | Any           | U.S.            | ⌘⇧M (Command-Shift-M)                 | Blocked; no toggle, no editor or system action            |
| Any                                   | Any           | U.S.            | ⌃⇧M while "Connecting…"               | No unmute; mic stays muted on join                        |

For each row also run steps 2, 3 and 5 above (editor focus, held chord, blocking
overlay, including the camera/microphone toggle warning). On macOS 12 confirm
the voice controls cannot be clicked behind a blocking overlay.

If the native layer swallows the chord, record which environment and focus state
failed before selecting another chord. Update the displayed hint and rerun this
matrix for the replacement. No production request/load increase is introduced by
the shortcut handler; only a deliberate press emits the existing mute update.
