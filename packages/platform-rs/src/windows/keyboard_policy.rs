const VK_LWIN: u32 = 0x5B;
const VK_RWIN: u32 = 0x5C;

pub(super) fn should_block(
    vk: u32,
    key_up: bool,
    alt_down: bool,
    ctrl_down: bool,
    shift_down: bool,
    win_down: bool,
    escape_blocked: bool,
) -> bool {
    // Always let Windows observe the modifier release. Blocking both halves of
    // a Win+D chord can leave the shell believing Win is still held when the
    // hook is installed or removed between those halves. The down event and
    // every chord made while Win is physically held remain blocked.
    if key_up && (vk == VK_LWIN || vk == VK_RWIN) {
        return false;
    }

    vk == VK_LWIN
        || vk == VK_RWIN
        || vk == 0x2C // VK_SNAPSHOT (PrintScreen)
        || (alt_down && vk == 0x09) // Alt+Tab
        || (alt_down && vk == 0x73) // Alt+F4
        || (ctrl_down && vk == 0x1B) // Ctrl+Esc
        || (ctrl_down && shift_down && vk == 0x1B) // Ctrl+Shift+Esc
        || (ctrl_down && shift_down && vk == 0x09) // Ctrl+Shift+Tab
        || (vk == 0x1B && escape_blocked)
        || (alt_down && vk == 0x0D) // Alt+Enter
        || (alt_down && vk == 0x20) // Alt+Space
        || (alt_down && vk == 0x5A) // Alt+Z
        || (alt_down && vk == 0x52) // Alt+R
        || (alt_down && vk == 0x78) // Alt+F9
        || win_down
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_key_down_is_blocked_but_release_is_forwarded() {
        assert!(should_block(
            VK_LWIN, false, false, false, false, true, true
        ));
        assert!(!should_block(
            VK_LWIN, true, false, false, false, true, true
        ));
        assert!(!should_block(
            VK_RWIN, true, false, false, false, true, true
        ));
    }

    #[test]
    fn windows_chords_remain_blocked() {
        assert!(should_block(0x44, false, false, false, false, true, true));
        assert!(should_block(0x47, false, false, false, false, true, true));
    }

    #[test]
    fn editor_keys_without_a_blocked_modifier_are_forwarded() {
        assert!(!should_block(0x41, false, false, false, false, false, true));
    }

    #[test]
    fn a_win_chord_cannot_leave_the_shell_believing_win_is_held() {
        // The sequence a candidate reported on 21 Oct, in order.
        //
        // He pressed Win+D. The hook blocked the Win press, blocked the D,
        // and then blocked the Win *release* too -- so the shell never saw
        // Win come up. From that point every key he typed was read as a Win
        // chord: A opened the network flyout, G opened Game Bar, and the
        // editor received nothing at all. He could type before it happened.
        //
        // The release must always reach the shell, whatever else is blocked,
        // because it is the only event that can clear that state.
        assert!(should_block(
            VK_LWIN, false, false, false, false, true, true
        ));
        assert!(should_block(0x44, false, false, false, false, true, true));
        assert!(!should_block(
            VK_LWIN, true, false, false, false, true, true
        ));

        // And once Win is genuinely up, ordinary typing is untouched.
        for vk in [0x41u32, 0x44, 0x47] {
            assert!(
                !should_block(vk, false, false, false, false, false, true),
                "vk {vk:#x} must reach the editor"
            );
        }
    }

    #[test]
    fn the_release_is_forwarded_even_mid_chord() {
        // The hook renews every few seconds, so it can be installed between a
        // Win press and its release. Blocking that orphaned release is how
        // the stuck state outlives the keystroke that caused it.
        assert!(!should_block(VK_LWIN, true, true, true, true, true, true));
        assert!(!should_block(
            VK_RWIN, true, false, false, false, false, false
        ));
    }
}
