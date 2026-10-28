//! Pure Mac shortcut decisions, shared by the event tap and portable regressions.
// CGEventFlags modifier masks
const FLAG_CMD: u64 = 0x0010_0000;
const FLAG_SHIFT: u64 = 0x0002_0000;
pub(super) const FLAG_CTRL: u64 = 0x0004_0000;
const FLAG_OPT: u64 = 0x0008_0000;
// kCGEventFlagMaskSecondaryFn: the fn / Globe key.
const FLAG_FN: u64 = 0x0080_0000;

// macOS virtual key codes (from <Carbon/Carbon.h> HIToolbox/Events.h)
const VK_TAB: i64 = 48;
const VK_SPACE: i64 = 49;
const VK_BACKTICK: i64 = 50; // ` / ~ — Cmd+` cycles windows
const VK_ESCAPE: i64 = 53;
const VK_H: i64 = 4;
const VK_M: i64 = 46;
const VK_Q: i64 = 12;
const VK_W: i64 = 13;
const VK_3: i64 = 20; // Cmd+Shift+3 screenshot
const VK_4: i64 = 21; // Cmd+Shift+4 screenshot
const VK_5: i64 = 23; // Cmd+Shift+5 screenshot
const VK_F: i64 = 3; // f key — Ctrl+Cmd+F toggles fullscreen
const VK_F3: i64 = 99; // Mission Control (default binding)
const VK_F4: i64 = 118; // Launchpad
const VK_UP: i64 = 126; // Ctrl+Up = Mission Control
const VK_DOWN: i64 = 125; // Ctrl+Down = App Exposé
const VK_LEFT: i64 = 123; // Ctrl+Left/Right = move between Spaces
const VK_RIGHT: i64 = 124;
const VK_6: i64 = 22; // Cmd+Shift+6 Touch Bar screenshot
const VK_A: i64 = 0;
const VK_D: i64 = 2;
const VK_C: i64 = 8;
const VK_V: i64 = 9;
const VK_X: i64 = 7;
const VK_E: i64 = 14;
const VK_N: i64 = 45;
// Globe / fn. A modifier: it arrives as a flags change, not a key-down.
pub(super) const VK_FN: i64 = 63;
// Ctrl+1..9 switch to Desktop N.
const DIGIT_KEYS: [i64; 9] = [18, 19, 20, 21, 23, 22, 26, 28, 25];
// Bare F1–F20.
const FUNCTION_KEYS: [i64; 20] = [
    122, 120, 99, 118, 96, 97, 98, 100, 101, 109, 103, 111, 105, 107, 113, 106, 64, 79, 80, 90,
];
// The top row of recent Apple keyboards sends these instead of F-keys:
// Mission Control, Launchpad, Spotlight, Dictation, Do Not Disturb, Globe.
const SYSTEM_FEATURE_KEYS: [i64; 6] = [160, 131, 177, 176, 178, 179];

#[derive(Clone, Copy, Default)]
pub(super) struct Policy {
    pub function_keys_blocked: bool,
    pub escape_blocked: bool,
    pub clipboard_blocked: bool,
}

/// The shortcut policy, free of FFI so it reads as one table.
pub(super) fn should_block_key(kc: i64, flags: u64, policy: Policy) -> bool {
    let cmd = (flags & FLAG_CMD) != 0;
    let shift = (flags & FLAG_SHIFT) != 0;
    let ctrl = (flags & FLAG_CTRL) != 0;
    let opt = (flags & FLAG_OPT) != 0;
    let fn_only = (flags & FLAG_FN) != 0 && !cmd && !ctrl && !opt;

    if SYSTEM_FEATURE_KEYS.contains(&kc) {
        return true;
    }
    if FUNCTION_KEYS.contains(&kc) && (kc == VK_F3 || kc == VK_F4 || policy.function_keys_blocked) {
        return true;
    }
    if ctrl && !cmd && DIGIT_KEYS.contains(&kc) {
        return true;
    }

    match kc {
        // Cmd+Tab (app switcher)
        VK_TAB if cmd => true,
        // Cmd+` (in-app window switcher)
        VK_BACKTICK if cmd => true,
        // Cmd+Q (quit), Ctrl+Cmd+Q (lock screen), Cmd+Shift+Q (log out)
        VK_Q if cmd => true,
        // Cmd+W (close window)
        VK_W if cmd => true,
        // Cmd+H (hide)
        VK_H if cmd => true,
        // Cmd+M (minimize)
        VK_M if cmd => true,
        // Cmd+Space with any modifier: Spotlight, Finder search, Character Viewer
        VK_SPACE if cmd => true,
        // Cmd+Option+Esc (Force Quit dialog)
        VK_ESCAPE if cmd && opt => true,
        // Bare Escape — skipped when Monaco is focused so editor can dismiss suggestions
        VK_ESCAPE if !cmd && !ctrl && !opt && !shift && policy.escape_blocked => true,
        // Cmd+Shift+3/4/5/6 (screenshots, recording, Touch Bar capture)
        VK_3 | VK_4 | VK_5 | VK_6 if cmd && shift => true,
        // Ctrl+arrows: Mission Control, App Exposé, move between Spaces
        VK_UP | VK_DOWN | VK_LEFT | VK_RIGHT if ctrl => true,
        // Cmd+Opt+D (show/hide the Dock)
        VK_D if cmd && opt => true,
        // Ctrl+Cmd+F (fullscreen toggle — would exit AMS fullscreen)
        VK_F if cmd && ctrl => true,
        // Globe shortcuts: Quick Note, emoji, Dock, Notification Center,
        // Control Center, fullscreen, desktop, dictation, menu bar
        VK_Q | VK_E | VK_A | VK_N | VK_C | VK_F | VK_H | VK_D | VK_M if fn_only => true,
        // Clipboard, when the contest forbids it
        VK_C | VK_V | VK_X if cmd && policy.clipboard_blocked => true,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn editing_navigation_and_ime_keys_are_not_system_shortcuts() {
        let policy = Policy {
            function_keys_blocked: true,
            escape_blocked: true,
            clipboard_blocked: false,
        };
        // Letters, delete/return, undo/redo, select all, word navigation,
        // Shift selection, and the input-source key when it is not restricted.
        for (key, flags) in [
            (0, 0),
            (6, FLAG_CMD),
            (6, FLAG_CMD | FLAG_SHIFT),
            (VK_A, FLAG_CMD),
            (51, 0),
            (36, 0),
            (VK_LEFT, FLAG_OPT),
            (VK_RIGHT, FLAG_SHIFT),
            (VK_LEFT, FLAG_CMD),
            (VK_TAB, 0),
        ] {
            assert!(
                !should_block_key(key, flags, policy),
                "key={key} flags={flags}"
            );
        }
    }
    #[test]
    fn editor_escape_and_clipboard_follow_explicit_policy() {
        for blocked in [false, true] {
            let policy = Policy {
                escape_blocked: blocked,
                clipboard_blocked: blocked,
                ..Policy::default()
            };
            assert_eq!(should_block_key(VK_ESCAPE, 0, policy), blocked);
            for key in [VK_C, VK_V, VK_X] {
                assert_eq!(should_block_key(key, FLAG_CMD, policy), blocked);
                assert!(!should_block_key(key, 0, policy));
            }
        }
    }
    #[test]
    fn app_switching_screenshots_and_spaces_still_block() {
        for (key, flags) in [
            (VK_Q, FLAG_CMD),
            (VK_TAB, FLAG_CMD),
            (VK_3, FLAG_CMD | FLAG_SHIFT),
            (VK_LEFT, FLAG_CTRL),
            (VK_ESCAPE, FLAG_CMD | FLAG_OPT),
            (VK_SPACE, FLAG_CMD),
        ] {
            assert!(should_block_key(key, flags, Policy::default()));
        }
    }
}
