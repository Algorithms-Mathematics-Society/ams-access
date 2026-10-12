use serde::Serialize;
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{SetWindowDisplayAffinity, WINDOW_DISPLAY_AFFINITY};

const WDA_EXCLUDEFROMCAPTURE: WINDOW_DISPLAY_AFFINITY = WINDOW_DISPLAY_AFFINITY(0x11);
const WDA_MONITOR: WINDOW_DISPLAY_AFFINITY = WINDOW_DISPLAY_AFFINITY(0x01);

/// Reports the requested affinity, not a guarantee against every capture mechanism.
/// On Windows 10 before 2004, even a successful exclusion request can behave
/// like WDA_MONITOR; the API does not report the effective capture behavior.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum CaptureProtectionStatus {
    Exclusion { reason: String },
    MonitorFallback { reason: String },
    Failed { reason: String },
}

impl CaptureProtectionStatus {
    pub fn applied(&self) -> bool {
        !matches!(self, Self::Failed { .. })
    }
}

// Keep the decision logic independent of Win32 so all failure paths can be tested
// without changing display affinity on a real window.
fn request_affinity(mut set: impl FnMut(u32) -> Result<(), String>) -> CaptureProtectionStatus {
    match set(WDA_EXCLUDEFROMCAPTURE.0) {
        Ok(()) => CaptureProtectionStatus::Exclusion {
            reason: "Exclusion request accepted; Windows 10 before 2004 may use monitor behavior instead, and capture outside supported display-affinity paths is not covered".into(),
        },
        Err(exclusion_error) => match set(WDA_MONITOR.0) {
            Ok(()) => CaptureProtectionStatus::MonitorFallback {
                reason: format!("Exclusion request failed: {exclusion_error}; WDA_MONITOR accepted (limited protection)"),
            },
            Err(monitor_error) => CaptureProtectionStatus::Failed {
                reason: format!("Exclusion request failed: {exclusion_error}; WDA_MONITOR failed: {monitor_error}"),
            },
        },
    }
}

/// Request affinity for the exam window (HWND cast to isize).
/// SetWindowDisplayAffinity is best-effort, applies only to this window, and
/// cannot prevent all forms of screen capture. WDA_MONITOR is a weaker fallback.
pub fn capture_protection_status(hwnd_raw: isize) -> CaptureProtectionStatus {
    let hwnd = HWND(hwnd_raw as *mut _);
    request_affinity(|affinity| {
        unsafe { SetWindowDisplayAffinity(hwnd, WINDOW_DISPLAY_AFFINITY(affinity)) }
            .map_err(|error| error.to_string())
    })
}

/// Compatibility wrapper for callers expecting whether either affinity was accepted.
pub fn apply_capture_protection(hwnd_raw: isize) -> bool {
    capture_protection_status(hwnd_raw).applied()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exclusion_accepted_does_not_try_monitor() {
        let mut calls = vec![];
        let status = request_affinity(|affinity| {
            calls.push(affinity);
            Ok(())
        });
        assert!(matches!(status, CaptureProtectionStatus::Exclusion { .. }));
        assert!(status.applied());
        assert_eq!(calls, [0x11]);
    }

    #[test]
    fn exclusion_failure_uses_monitor_fallback() {
        let mut calls = vec![];
        let status = request_affinity(|affinity| {
            calls.push(affinity);
            if affinity == 0x11 {
                Err("exclusion error".into())
            } else {
                Ok(())
            }
        });
        assert!(
            matches!(status, CaptureProtectionStatus::MonitorFallback { ref reason } if reason.contains("exclusion error"))
        );
        assert!(status.applied());
        assert_eq!(calls, [0x11, 0x01]);
    }

    #[test]
    fn both_requests_fail_with_both_reasons() {
        let mut calls = vec![];
        let status = request_affinity(|affinity| {
            calls.push(affinity);
            Err(format!("error {affinity}"))
        });
        assert!(
            matches!(status, CaptureProtectionStatus::Failed { ref reason } if reason.contains("error 17") && reason.contains("error 1"))
        );
        assert!(!status.applied());
        assert_eq!(calls, [0x11, 0x01]);
    }
}
