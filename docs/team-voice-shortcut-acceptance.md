# Team voice shortcut acceptance (#323)

Status: native acceptance is **not yet run**. Source/unit checks do not prove that
an OS or desktop compositor delivers a key combination to the packaged WebView.

Code evidence:
- Windows `keyboard_policy::should_block` permits Ctrl+Shift+M on press/release;
  the policy regression test covers this with lockdown Escape protection active.
- Linux lockdown disables configured GNOME/KDE shell shortcuts; it does not
  implement a blanket Ctrl+Shift letter filter. Custom desktop shortcuts can
  still intercept keys and require device testing.
- The WebView handles the chord during window capture, before editor target
  handlers, prevents its default action, and stops propagation. Held-key repeats
  are consumed without toggling again. Suspended/invalid/absent voice sessions do
  not consume the chord.

Run on packaged Windows 10 and 11, and each supported Linux distribution/session
(GNOME/KDE, X11/Wayland as supported). Record app version, OS, compositor, keyboard
layout, and results for every case; leave #323 open until all required cases pass.

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

If the native layer swallows the chord, record which environment and focus state
failed before selecting another chord. Update the displayed hint and rerun this
matrix for the replacement. No production request/load increase is introduced by
the shortcut handler; only a deliberate press emits the existing mute update.
