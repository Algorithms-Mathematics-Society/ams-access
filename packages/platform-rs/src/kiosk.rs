// ── Fullscreen kiosk: pure decision core (platform-neutral, unit-tested, no Win32) ──

const KIOSK_TICK_MS: u64 = 750;
const NULL_LOCK_TICKS: u32 = 2;
const GIVE_UP_ATTEMPTS: u32 = 4;
/// Re-assert audit events are throttled to at most one per this window, per kind,
/// so a sustained fullscreen/always-on-top fight cannot flood the proctor log,
/// while a single drift (e.g. one F11 press) is always reported. The window op
/// itself is NEVER throttled — only the audit event is.
const REASSERT_REPORT_THROTTLE_MS: u64 = 5000;

/// Backoff before the next foreground nudge, by 1-based attempt number:
/// 1→750ms, 2→1500, 3→3000, 4→6000 (capped). The *schedule* — not the count —
/// is the anti-tight-loop safety property (spec §6).
fn backoff_ms(attempt: u32) -> u64 {
    let shift = attempt.saturating_sub(1).min(13);
    KIOSK_TICK_MS.saturating_mul(1u64 << shift).min(6000)
}

/// True if a re-assert audit event for this kind may be emitted now (first ever,
/// or the throttle window has elapsed since the last emit). The caller updates
/// the last-emit timestamp only when it actually emits.
fn reassert_report_due(last_ms: Option<u64>, now_ms: u64) -> bool {
    match last_ms {
        None => true,
        Some(last) => now_ms.saturating_sub(last) >= REASSERT_REPORT_THROTTLE_MS,
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum LossCause {
    ForeignApp,
    Locked,
    SystemDialog,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Severity {
    Info,
    Low,
    Medium,
    High,
}

#[derive(Clone, Debug)]
struct Episode {
    opened_cause: LossCause,
    phase: LossCause,
    started_ms: u64,
    ever_locked: bool,
    sticky_hwnd: isize,
    attempts: u32,
    next_attempt_ms: u64,
    gave_up: bool,
}

#[derive(Default)]
pub struct KioskState {
    episode: Option<Episode>,
    null_streak: u32,
    last_fs_reassert_ms: Option<u64>,
    last_aot_reassert_ms: Option<u64>,
}

pub struct TickInput {
    pub now_ms: u64,
    pub exam_is_foreground: bool,
    pub foreground_is_null: bool,
    pub foreground_hwnd: isize,
    pub foreground_is_secure_system: bool,
    pub foreground_process: Option<String>,
    pub is_fullscreen: bool,
    pub is_always_on_top: bool,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Action {
    ReassertFullscreen,
    ReassertAlwaysOnTop,
    NudgeForeground,
    Report {
        event: &'static str,
        severity: Severity,
        detail: String,
    },
    ResumeBannerAndReport {
        ever_locked: bool,
        duration_ms: u64,
    },
}

/// Decide what the watchdog must do this tick. Pure: mutates `state`, returns actions.
pub fn decide(state: &mut KioskState, input: TickInput) -> Vec<Action> {
    let mut actions = Vec::new();

    // CASE A — exam is foreground: close any episode, drift-check fullscreen/always-on-top.
    if input.exam_is_foreground {
        state.null_streak = 0;
        if let Some(ep) = state.episode.take() {
            actions.push(Action::ResumeBannerAndReport {
                ever_locked: ep.ever_locked,
                duration_ms: input.now_ms.saturating_sub(ep.started_ms),
            });
        }
        if !input.is_fullscreen {
            actions.push(Action::ReassertFullscreen); // enforcement: every drift tick
            if reassert_report_due(state.last_fs_reassert_ms, input.now_ms) {
                state.last_fs_reassert_ms = Some(input.now_ms);
                actions.push(Action::Report {
                    event: "fullscreen_reasserted",
                    severity: Severity::Info,
                    detail: "exam lost fullscreen while focused — re-asserted".into(),
                });
            }
        }
        if !input.is_always_on_top {
            actions.push(Action::ReassertAlwaysOnTop); // enforcement: every drift tick
            if reassert_report_due(state.last_aot_reassert_ms, input.now_ms) {
                state.last_aot_reassert_ms = Some(input.now_ms);
                actions.push(Action::Report {
                    event: "always_on_top_reasserted",
                    severity: Severity::Info,
                    detail: "exam lost always-on-top while focused — re-asserted".into(),
                });
            }
        }
        return actions;
    }

    // CASE B — NULL foreground: transient stays fail-safe; sustained = workstation locked.
    if input.foreground_is_null {
        state.null_streak = state.null_streak.saturating_add(1);
        if state.null_streak < NULL_LOCK_TICKS {
            return actions;
        }
        match &mut state.episode {
            None => {
                state.episode = Some(Episode {
                    opened_cause: LossCause::Locked,
                    phase: LossCause::Locked,
                    started_ms: input.now_ms,
                    ever_locked: true,
                    sticky_hwnd: 0,
                    attempts: 0,
                    next_attempt_ms: 0,
                    gave_up: false,
                });
                actions.push(Action::Report {
                    event: "workstation_locked",
                    severity: Severity::Medium,
                    detail: "sustained null foreground — Win+L/CAD; cannot re-assert".into(),
                });
            }
            Some(ep) => {
                ep.ever_locked = true;
                ep.phase = LossCause::Locked;
            }
        }
        return actions;
    }

    // CASE C — a foreign window holds foreground.
    state.null_streak = 0;
    let pname = input
        .foreground_process
        .clone()
        .unwrap_or_else(|| "unknown".into());

    if input.foreground_is_secure_system {
        if state.episode.is_none() {
            state.episode = Some(Episode {
                opened_cause: LossCause::SystemDialog,
                phase: LossCause::SystemDialog,
                started_ms: input.now_ms,
                ever_locked: false,
                sticky_hwnd: 0,
                attempts: 0,
                next_attempt_ms: 0,
                gave_up: false,
            });
            actions.push(Action::Report {
                event: "system_dialog_foreground",
                severity: Severity::Low,
                detail: pname,
            });
        }
        return actions; // legit OS dialog — never fight
    }

    // normal foreign app: open/transition episode, then gentle nudge with backoff.
    let now = input.now_ms;
    let fg = input.foreground_hwnd;
    let mut need_edge = false;
    match &mut state.episode {
        None => need_edge = true,
        Some(ep) if ep.phase != LossCause::ForeignApp => {
            need_edge = true;
            ep.phase = LossCause::ForeignApp;
            ep.sticky_hwnd = fg;
            ep.attempts = 0;
            ep.next_attempt_ms = now;
            ep.gave_up = false;
        }
        Some(ep) if ep.sticky_hwnd != fg => {
            ep.sticky_hwnd = fg;
            ep.attempts = 0;
            ep.next_attempt_ms = now;
            ep.gave_up = false;
        }
        Some(_) => {}
    }
    if state.episode.is_none() {
        state.episode = Some(Episode {
            opened_cause: LossCause::ForeignApp,
            phase: LossCause::ForeignApp,
            started_ms: now,
            ever_locked: false,
            sticky_hwnd: fg,
            attempts: 0,
            next_attempt_ms: now,
            gave_up: false,
        });
    }
    if need_edge {
        actions.push(Action::Report {
            event: "focus_loss",
            severity: Severity::Medium,
            detail: pname.clone(),
        });
    }
    if let Some(ep) = &mut state.episode {
        if ep.phase == LossCause::ForeignApp && !ep.gave_up && now >= ep.next_attempt_ms {
            if ep.attempts < GIVE_UP_ATTEMPTS {
                ep.attempts += 1;
                ep.next_attempt_ms = now.saturating_add(backoff_ms(ep.attempts));
                actions.push(Action::NudgeForeground);
            } else {
                ep.gave_up = true;
                actions.push(Action::Report {
                    event: "focus_loss_persistent",
                    severity: Severity::High,
                    detail: format!(
                        "{}, away {}s",
                        pname,
                        now.saturating_sub(ep.started_ms) / 1000
                    ),
                });
            }
        }
    }
    actions
}

/// Drain an open episode when the watchdog loop exits (lockdown disengage /
/// session end). Closes the episode with a terminal record (no banner — the UI
/// is tearing down). Guarantees no dangling open episode (spec §4.1).
pub fn on_teardown(state: &mut KioskState, now_ms: u64) -> Vec<Action> {
    if let Some(ep) = state.episode.take() {
        let severity = if ep.ever_locked || ep.gave_up {
            Severity::High
        } else {
            Severity::Medium
        };
        vec![Action::Report {
            event: "focus_episode_unresolved_at_session_end",
            severity,
            detail: format!(
                "away {}s, cause={:?}",
                now_ms.saturating_sub(ep.started_ms) / 1000,
                ep.opened_cause
            ),
        }]
    } else {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> TickInput {
        TickInput {
            now_ms: 0,
            exam_is_foreground: false,
            foreground_is_null: false,
            foreground_hwnd: 0,
            foreground_is_secure_system: false,
            foreground_process: None,
            is_fullscreen: true,
            is_always_on_top: true,
        }
    }
    fn exam_fg(now: u64, fs: bool, aot: bool) -> TickInput {
        TickInput {
            now_ms: now,
            exam_is_foreground: true,
            is_fullscreen: fs,
            is_always_on_top: aot,
            ..base()
        }
    }
    fn null_fg(now: u64) -> TickInput {
        TickInput {
            now_ms: now,
            foreground_is_null: true,
            ..base()
        }
    }
    fn foreign(now: u64, hwnd: isize, name: &str) -> TickInput {
        TickInput {
            now_ms: now,
            foreground_hwnd: hwnd,
            foreground_process: Some(name.into()),
            ..base()
        }
    }
    fn secure(now: u64, hwnd: isize, name: &str) -> TickInput {
        TickInput {
            now_ms: now,
            foreground_hwnd: hwnd,
            foreground_is_secure_system: true,
            foreground_process: Some(name.into()),
            ..base()
        }
    }
    fn has(a: &[Action], e: &str) -> bool {
        a.iter()
            .any(|x| matches!(x, Action::Report { event, .. } if *event == e))
    }
    fn nudges(a: &[Action]) -> usize {
        a.iter()
            .filter(|x| matches!(x, Action::NudgeForeground))
            .count()
    }

    #[test]
    fn case_a_reasserts_only_on_drift() {
        let mut s = KioskState::default();
        // no drift → nothing
        assert!(decide(&mut s, exam_fg(0, true, true)).is_empty());
        // fullscreen drift (first) → window op + throttled Info report, no aot op
        let a = decide(&mut s, exam_fg(0, false, true));
        assert!(a.contains(&Action::ReassertFullscreen));
        assert!(has(&a, "fullscreen_reasserted"));
        assert!(!a.iter().any(|x| matches!(x, Action::ReassertAlwaysOnTop)));
        // always-on-top drift (first) → window op + throttled Info report
        let b = decide(&mut s, exam_fg(0, true, false));
        assert!(b.contains(&Action::ReassertAlwaysOnTop));
        assert!(has(&b, "always_on_top_reasserted"));
    }

    #[test]
    fn transient_null_silent_sustained_locks_once() {
        let mut s = KioskState::default();
        assert!(decide(&mut s, null_fg(0)).is_empty());
        assert!(has(&decide(&mut s, null_fg(750)), "workstation_locked"));
        assert!(decide(&mut s, null_fg(1500)).is_empty());
    }

    #[test]
    fn foreign_edge_reports_and_nudges() {
        let mut s = KioskState::default();
        let a = decide(&mut s, foreign(0, 111, "chrome.exe"));
        assert!(has(&a, "focus_loss"));
        assert_eq!(nudges(&a), 1);
    }

    #[test]
    fn nudges_are_multi_second_spaced_not_a_tight_loop() {
        let mut s = KioskState::default();
        assert_eq!(nudges(&decide(&mut s, foreign(0, 111, "x.exe"))), 1); // #1 @ t0
        assert_eq!(nudges(&decide(&mut s, foreign(100, 111, "x.exe"))), 0); // inside gap
        assert_eq!(nudges(&decide(&mut s, foreign(749, 111, "x.exe"))), 0); // inside gap
        assert_eq!(nudges(&decide(&mut s, foreign(750, 111, "x.exe"))), 1); // #2 @ 750
        assert_eq!(nudges(&decide(&mut s, foreign(2249, 111, "x.exe"))), 0);
        assert_eq!(nudges(&decide(&mut s, foreign(2250, 111, "x.exe"))), 1); // #3 @ 2250
        assert_eq!(nudges(&decide(&mut s, foreign(5249, 111, "x.exe"))), 0);
        assert_eq!(nudges(&decide(&mut s, foreign(5250, 111, "x.exe"))), 1); // #4 @ 5250
    }

    #[test]
    fn gives_up_after_four_nudges_then_persistent() {
        let mut s = KioskState::default();
        for t in [0u64, 750, 2250, 5250] {
            assert_eq!(nudges(&decide(&mut s, foreign(t, 111, "x.exe"))), 1);
        }
        assert_eq!(nudges(&decide(&mut s, foreign(11249, 111, "x.exe"))), 0); // final 6s gap
        let a = decide(&mut s, foreign(11250, 111, "x.exe"));
        assert_eq!(nudges(&a), 0);
        assert!(has(&a, "focus_loss_persistent"));
        assert_eq!(nudges(&decide(&mut s, foreign(20000, 111, "x.exe"))), 0); // stays given-up
    }

    #[test]
    fn different_foreign_window_resets_backoff() {
        let mut s = KioskState::default();
        assert_eq!(nudges(&decide(&mut s, foreign(0, 111, "a.exe"))), 1);
        assert_eq!(nudges(&decide(&mut s, foreign(100, 111, "a.exe"))), 0); // inside gap
        assert_eq!(nudges(&decide(&mut s, foreign(100, 222, "b.exe"))), 1); // new hwnd → reset
    }

    #[test]
    fn secure_foreground_never_nudged() {
        let mut s = KioskState::default();
        let a = decide(&mut s, secure(0, 999, "consent.exe"));
        assert!(has(&a, "system_dialog_foreground"));
        assert_eq!(nudges(&a), 0);
        assert!(decide(&mut s, secure(750, 999, "consent.exe")).is_empty()); // no spam
    }

    #[test]
    fn lock_then_resume_is_one_record() {
        let mut s = KioskState::default();
        decide(&mut s, null_fg(0));
        decide(&mut s, null_fg(750)); // opens Locked at started_ms = 750
        let a = decide(&mut s, exam_fg(5000, true, true));
        assert_eq!(
            a,
            vec![Action::ResumeBannerAndReport {
                ever_locked: true,
                duration_ms: 4250
            }]
        );
    }

    #[test]
    fn lock_then_foreign_then_resume_keeps_locked_and_total_duration() {
        let mut s = KioskState::default();
        decide(&mut s, null_fg(0));
        decide(&mut s, null_fg(750)); // Locked, started_ms = 750
        decide(&mut s, foreign(1000, 111, "x.exe")); // transition; started_ms preserved
        let a = decide(&mut s, exam_fg(4000, true, true));
        assert_eq!(
            a,
            vec![Action::ResumeBannerAndReport {
                ever_locked: true,
                duration_ms: 3250
            }]
        );
    }

    #[test]
    fn recovery_clears_state() {
        let mut s = KioskState::default();
        decide(&mut s, null_fg(0));
        decide(&mut s, null_fg(750));
        decide(&mut s, exam_fg(1000, true, true));
        assert!(s.episode.is_none());
        assert_eq!(s.null_streak, 0);
    }

    #[test]
    fn teardown_closes_open_episode() {
        let mut s = KioskState::default();
        decide(&mut s, foreign(0, 111, "x.exe"));
        let a = on_teardown(&mut s, 3000);
        assert!(has(&a, "focus_episode_unresolved_at_session_end"));
        assert!(s.episode.is_none());
        assert!(on_teardown(&mut s, 4000).is_empty());
    }

    fn count_event(a: &[Action], e: &str) -> usize {
        a.iter()
            .filter(|x| matches!(x, Action::Report { event, .. } if *event == e))
            .count()
    }

    #[test]
    fn reassert_throttle_is_per_kind_independent() {
        let mut s = KioskState::default();
        // fullscreen drift at t0 → fullscreen event, NO aot event
        let a = decide(&mut s, exam_fg(0, false, true));
        assert_eq!(count_event(&a, "fullscreen_reasserted"), 1);
        assert_eq!(count_event(&a, "always_on_top_reasserted"), 0);
        // t=1000 (within the fullscreen throttle window): fullscreen STILL drifts (its event is
        // suppressed) but always-on-top drifts for the FIRST time → it emits independently,
        // proving the two throttle timestamps are separate.
        let b = decide(&mut s, exam_fg(1000, false, false));
        assert_eq!(count_event(&b, "fullscreen_reasserted"), 0);
        assert_eq!(count_event(&b, "always_on_top_reasserted"), 1);
    }

    #[test]
    fn reassert_first_emits_sustained_throttled_then_reemits_after_gap() {
        let mut s = KioskState::default();
        // first drift → exactly one event, and the window op
        let t0 = decide(&mut s, exam_fg(0, false, true));
        assert_eq!(count_event(&t0, "fullscreen_reasserted"), 1);
        assert!(t0.contains(&Action::ReassertFullscreen));
        // sustained sub-window fight → event suppressed, but the window op STILL fires every tick
        let t700 = decide(&mut s, exam_fg(700, false, true));
        assert_eq!(count_event(&t700, "fullscreen_reasserted"), 0);
        assert!(t700.contains(&Action::ReassertFullscreen));
        let t1400 = decide(&mut s, exam_fg(1400, false, true));
        assert_eq!(count_event(&t1400, "fullscreen_reasserted"), 0);
        // after the throttle window elapses, a fresh drift emits again (throttle resets, no latch)
        let t5000 = decide(&mut s, exam_fg(5000, false, true));
        assert_eq!(count_event(&t5000, "fullscreen_reasserted"), 1);
    }
}
