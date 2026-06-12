use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SessionStage {
    SessionIsolation,
    FullscreenSecure,
    MonitorDetection,
    KeyboardLockdown,
    EnvironmentValidation,
    RestrictedApps,
    VmDetection,
    CameraInit,
    FaceCalibration,
    PresenceVerification,
    AudioVerification,
    NetworkValidation,
    IntegrityConfirmation,
    LockInCountdown,
    ContestLaunch,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StageStatus {
    Pending,
    Checking,
    Pass,
    Warn,
    Fail,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MonitorInfo {
    pub index: u32,
    pub is_primary: bool,
    pub width: u32,
    pub height: u32,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessScanResult {
    pub found: Vec<String>,
    pub clean: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloseAppsResult {
    pub closed: Vec<String>,
    pub failed: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VirtDetectionResult {
    pub detected: bool,
    pub platform: Option<String>,
    pub confidence: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyboardInterceptResult {
    pub active: bool,
    pub method: String,
    pub platform: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkCheckResult {
    pub reachable: bool,
    pub latency_ms: Option<u64>,
    pub jitter_ms: Option<u64>,
    pub quality: String,
    /// Signed offset of the device clock vs the contest server (server − local),
    /// measured from an HTTP `Date` header. `None` when no server time signal
    /// was available — absence of the signal is never treated as a failure.
    #[serde(default)]
    pub clock_skew_ms: Option<i64>,
}

/// Device clocks drifted beyond this bound make submission timestamps and
/// contest-window enforcement unreliable — the readiness network check fails.
pub const MAX_CLOCK_SKEW_MS: i64 = 120_000;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckKind {
    ContestId,
    DeviceId,
    Camera,
    Microphone,
    Network,
    KeyboardLockdown,
    RestrictedApps,
    Virtualization,
    Platform,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EnforcementProfile {
    Practice,
    InternalPilot,
    StrictContest,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlockingSeverity {
    Info,
    Warning,
    Block,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FailureReasonCode {
    ContestIdMissing,
    DeviceIdMissing,
    CameraUnavailable,
    MicrophoneUnavailable,
    NetworkUnreachable,
    KeyboardLockdownUnavailable,
    RestrictedApplicationDetected,
    VirtualizationDetected,
    UnsupportedPlatform,
    ClockSkewDetected,
    ProbeUnavailable,
}

pub type FailureReason = FailureReasonCode;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryAction {
    SelectContest,
    RegisterDevice,
    GrantMediaPermission,
    ConnectNetwork,
    CloseRestrictedApplications,
    UsePhysicalMachine,
    UseSupportedPlatform,
    RetryReadinessScan,
    ContactOrganizer,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadinessRequirement {
    pub kind: CheckKind,
    pub required: bool,
    pub severity: BlockingSeverity,
    pub organizer_override_allowed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionPolicy {
    pub profile: EnforcementProfile,
    pub checks: Vec<ReadinessRequirement>,
}

impl SessionPolicy {
    pub fn for_profile(profile: EnforcementProfile) -> Self {
        let strict = matches!(profile, EnforcementProfile::StrictContest);
        let severity = if strict {
            BlockingSeverity::Block
        } else {
            BlockingSeverity::Warning
        };
        let required = strict;
        let organizer_override_allowed = !strict;

        let checks = [
            CheckKind::ContestId,
            CheckKind::DeviceId,
            CheckKind::Platform,
            CheckKind::RestrictedApps,
            CheckKind::Virtualization,
            CheckKind::KeyboardLockdown,
            CheckKind::Network,
            CheckKind::Camera,
            CheckKind::Microphone,
        ]
        .into_iter()
        .map(|kind| {
            // Microphone is advisory-only on all profiles — many contest machines
            // (lab desktops, headless setups) have no audio input. Proctoring
            // continuity does not depend on it.
            // Camera is advisory-only too — when hardware is absent the dedicated
            // face-calibration stages will surface the issue with proper UX.
            let (kind_required, kind_severity) =
                if matches!(kind, CheckKind::Microphone | CheckKind::Camera) {
                    (false, BlockingSeverity::Warning)
                } else {
                    (required, severity.clone())
                };
            ReadinessRequirement {
                kind,
                required: kind_required,
                severity: kind_severity,
                organizer_override_allowed,
            }
        })
        .collect();

        Self { profile, checks }
    }

    pub fn strict_contest() -> Self {
        Self::for_profile(EnforcementProfile::StrictContest)
    }
}

impl Default for SessionPolicy {
    fn default() -> Self {
        Self::strict_contest()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceState {
    pub platform: Option<String>,
    pub camera_available: Option<bool>,
    pub microphone_available: Option<bool>,
    pub network: Option<NetworkCheckResult>,
    pub keyboard: Option<KeyboardInterceptResult>,
    pub restricted_processes: Option<ProcessScanResult>,
    pub virtualization: Option<VirtDetectionResult>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckOutcome {
    Pass,
    Warn,
    Fail,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadinessCheck {
    pub kind: CheckKind,
    pub required: bool,
    pub severity: BlockingSeverity,
    pub outcome: CheckOutcome,
    pub blocking: bool,
    pub organizer_override_allowed: bool,
    pub reason: Option<FailureReasonCode>,
    pub recovery_actions: Vec<RecoveryAction>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EnforcementDecision {
    Allowed,
    AllowedWithWarnings,
    Blocked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadinessReport {
    pub contest_id: Option<String>,
    pub device_id: Option<String>,
    pub policy_profile: EnforcementProfile,
    pub decision: EnforcementDecision,
    pub required_checks: Vec<ReadinessCheck>,
    pub optional_checks: Vec<ReadinessCheck>,
    pub checks: Vec<ReadinessCheck>,
    pub blocking_reasons: Vec<FailureReasonCode>,
    pub generated_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvironmentReport {
    pub os: String,
    pub display_server: String,
    pub monitors: Vec<MonitorInfo>,
    pub restricted_procs: Vec<String>,
    pub virtualization: Option<String>,
    pub keyboard_hooks: bool,
    pub debugger_detected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExamSession {
    pub contest_id: Option<String>,
    pub stage: SessionStage,
    pub environment: Option<EnvironmentReport>,
    pub integrity_score: u8,
}

impl Default for ExamSession {
    fn default() -> Self {
        Self {
            contest_id: None,
            stage: SessionStage::SessionIsolation,
            environment: None,
            integrity_score: 100,
        }
    }
}

impl ExamSession {
    pub fn new(contest_id: Option<String>) -> Self {
        Self {
            contest_id,
            ..Default::default()
        }
    }

    pub fn next_stage(&mut self) {
        self.stage = match self.stage {
            SessionStage::SessionIsolation => SessionStage::FullscreenSecure,
            SessionStage::FullscreenSecure => SessionStage::MonitorDetection,
            SessionStage::MonitorDetection => SessionStage::KeyboardLockdown,
            SessionStage::KeyboardLockdown => SessionStage::EnvironmentValidation,
            SessionStage::EnvironmentValidation => SessionStage::RestrictedApps,
            SessionStage::RestrictedApps => SessionStage::VmDetection,
            SessionStage::VmDetection => SessionStage::CameraInit,
            SessionStage::CameraInit => SessionStage::FaceCalibration,
            SessionStage::FaceCalibration => SessionStage::PresenceVerification,
            SessionStage::PresenceVerification => SessionStage::AudioVerification,
            SessionStage::AudioVerification => SessionStage::NetworkValidation,
            SessionStage::NetworkValidation => SessionStage::IntegrityConfirmation,
            SessionStage::IntegrityConfirmation => SessionStage::LockInCountdown,
            SessionStage::LockInCountdown => SessionStage::ContestLaunch,
            SessionStage::ContestLaunch => SessionStage::ContestLaunch,
        };
    }
}

pub fn evaluate_readiness(
    policy: &SessionPolicy,
    contest_id: Option<String>,
    device_id: Option<String>,
    device_state: &DeviceState,
) -> ReadinessReport {
    let requirements = merge_requirements(policy);
    let checks = requirements
        .into_values()
        .map(|requirement| {
            evaluate_requirement(
                requirement,
                contest_id.as_deref(),
                device_id.as_deref(),
                device_state,
            )
        })
        .collect::<Vec<_>>();

    let blocking_reasons = checks
        .iter()
        .filter(|check| check.blocking)
        .filter_map(|check| check.reason.clone())
        .collect::<Vec<_>>();

    let has_blocking = !blocking_reasons.is_empty();
    let has_warnings = checks.iter().any(|check| {
        matches!(
            check.outcome,
            CheckOutcome::Warn | CheckOutcome::Fail | CheckOutcome::Unknown
        )
    });

    let decision = if has_blocking {
        EnforcementDecision::Blocked
    } else if has_warnings {
        EnforcementDecision::AllowedWithWarnings
    } else {
        EnforcementDecision::Allowed
    };

    let required_checks = checks
        .iter()
        .filter(|check| check.required)
        .cloned()
        .collect::<Vec<_>>();
    let optional_checks = checks
        .iter()
        .filter(|check| !check.required)
        .cloned()
        .collect::<Vec<_>>();

    ReadinessReport {
        contest_id,
        device_id,
        policy_profile: policy.profile.clone(),
        decision,
        required_checks,
        optional_checks,
        checks,
        blocking_reasons,
        generated_at_ms: now_ms(),
    }
}

fn merge_requirements(policy: &SessionPolicy) -> BTreeMap<CheckKind, ReadinessRequirement> {
    let mut requirements = SessionPolicy::for_profile(policy.profile.clone())
        .checks
        .into_iter()
        .map(|requirement| (requirement.kind.clone(), requirement))
        .collect::<BTreeMap<_, _>>();

    for requirement in &policy.checks {
        requirements.insert(requirement.kind.clone(), requirement.clone());
    }

    requirements
}

fn evaluate_requirement(
    requirement: ReadinessRequirement,
    contest_id: Option<&str>,
    device_id: Option<&str>,
    device_state: &DeviceState,
) -> ReadinessCheck {
    let (passed, reason, detail, recovery_actions) = match requirement.kind {
        CheckKind::ContestId if is_present(contest_id) => {
            (true, None, Some("contest id present".to_string()), vec![])
        }
        CheckKind::ContestId => (
            false,
            Some(FailureReasonCode::ContestIdMissing),
            Some("contest id missing".to_string()),
            vec![RecoveryAction::SelectContest],
        ),
        CheckKind::DeviceId if is_present(device_id) => {
            (true, None, Some("device id present".to_string()), vec![])
        }
        CheckKind::DeviceId => (
            false,
            Some(FailureReasonCode::DeviceIdMissing),
            Some("device id missing".to_string()),
            vec![RecoveryAction::RegisterDevice],
        ),
        CheckKind::Camera => match device_state.camera_available {
            Some(true) => (true, None, Some("camera available".to_string()), vec![]),
            Some(false) => (
                false,
                Some(FailureReasonCode::CameraUnavailable),
                Some("camera unavailable".to_string()),
                vec![
                    RecoveryAction::GrantMediaPermission,
                    RecoveryAction::RetryReadinessScan,
                ],
            ),
            None => unknown(FailureReasonCode::ProbeUnavailable),
        },
        CheckKind::Microphone => match device_state.microphone_available {
            Some(true) => (true, None, Some("microphone available".to_string()), vec![]),
            Some(false) => (
                false,
                Some(FailureReasonCode::MicrophoneUnavailable),
                Some("microphone unavailable".to_string()),
                vec![
                    RecoveryAction::GrantMediaPermission,
                    RecoveryAction::RetryReadinessScan,
                ],
            ),
            None => unknown(FailureReasonCode::ProbeUnavailable),
        },
        CheckKind::Network => match &device_state.network {
            // Clock integrity rides on the network check: the device clock
            // drives report and submission timestamps, so a drift beyond the
            // bound is as disqualifying as an unreachable network. Checked
            // first so a skewed-but-fast network cannot pass.
            Some(network)
                if network.reachable
                    && network
                        .clock_skew_ms
                        .is_some_and(|skew| skew.abs() > MAX_CLOCK_SKEW_MS) =>
            {
                (
                    false,
                    Some(FailureReasonCode::ClockSkewDetected),
                    Some(format!(
                        "device clock differs from contest server by {} s — fix the system clock",
                        network.clock_skew_ms.unwrap_or_default() / 1000
                    )),
                    vec![
                        RecoveryAction::RetryReadinessScan,
                        RecoveryAction::ContactOrganizer,
                    ],
                )
            }
            Some(network) if network.reachable && network.quality != "poor" => (
                true,
                None,
                Some(format!(
                    "network reachable with {} quality",
                    network.quality
                )),
                vec![],
            ),
            Some(network) if network.reachable => (
                false,
                Some(FailureReasonCode::NetworkUnreachable),
                Some("network quality is poor".to_string()),
                vec![
                    RecoveryAction::ConnectNetwork,
                    RecoveryAction::RetryReadinessScan,
                ],
            ),
            Some(_) => (
                false,
                Some(FailureReasonCode::NetworkUnreachable),
                Some("network unreachable".to_string()),
                vec![
                    RecoveryAction::ConnectNetwork,
                    RecoveryAction::RetryReadinessScan,
                ],
            ),
            None => unknown(FailureReasonCode::ProbeUnavailable),
        },
        CheckKind::KeyboardLockdown => match &device_state.keyboard {
            Some(keyboard) if keyboard.active => (
                true,
                None,
                Some(format!("keyboard lockdown active via {}", keyboard.method)),
                vec![],
            ),
            Some(keyboard) => (
                false,
                Some(FailureReasonCode::KeyboardLockdownUnavailable),
                Some(format!(
                    "keyboard lockdown unavailable on {}",
                    keyboard.platform
                )),
                vec![
                    RecoveryAction::RetryReadinessScan,
                    RecoveryAction::ContactOrganizer,
                ],
            ),
            None => unknown(FailureReasonCode::ProbeUnavailable),
        },
        CheckKind::RestrictedApps => match &device_state.restricted_processes {
            Some(scan) if scan.clean => (
                true,
                None,
                Some("no restricted applications detected".to_string()),
                vec![],
            ),
            Some(scan) => (
                false,
                Some(FailureReasonCode::RestrictedApplicationDetected),
                Some(format!(
                    "restricted applications: {}",
                    scan.found.join(", ")
                )),
                vec![
                    RecoveryAction::CloseRestrictedApplications,
                    RecoveryAction::RetryReadinessScan,
                ],
            ),
            None => unknown(FailureReasonCode::ProbeUnavailable),
        },
        CheckKind::Virtualization => match &device_state.virtualization {
            Some(virt) if !virt.detected => (
                true,
                None,
                Some("physical environment expected".to_string()),
                vec![],
            ),
            Some(virt) => (
                false,
                Some(FailureReasonCode::VirtualizationDetected),
                Some(
                    virt.platform
                        .clone()
                        .unwrap_or_else(|| "virtualized environment detected".to_string()),
                ),
                vec![
                    RecoveryAction::UsePhysicalMachine,
                    RecoveryAction::ContactOrganizer,
                ],
            ),
            None => unknown(FailureReasonCode::ProbeUnavailable),
        },
        CheckKind::Platform => match &device_state.platform {
            Some(platform) if platform == "linux" => (
                true,
                None,
                Some("supported platform: linux".to_string()),
                vec![],
            ),
            Some(platform) if platform == "macos" => (
                true,
                None,
                Some("supported platform: macos".to_string()),
                vec![],
            ),
            Some(platform) if platform == "windows" => (
                true,
                None,
                Some("supported platform: windows (Administrator)".to_string()),
                vec![],
            ),
            Some(platform) if platform == "windows_no_admin" => (
                false,
                Some(FailureReasonCode::UnsupportedPlatform),
                Some("Administrator privileges are required on Windows. Use the Relaunch as Administrator action — Windows will show a single confirmation prompt.".to_string()),
                vec![
                    RecoveryAction::UseSupportedPlatform,
                    RecoveryAction::ContactOrganizer,
                ],
            ),
            Some(platform) => (
                false,
                Some(FailureReasonCode::UnsupportedPlatform),
                Some(format!("unsupported platform: {}", platform)),
                vec![
                    RecoveryAction::UseSupportedPlatform,
                    RecoveryAction::ContactOrganizer,
                ],
            ),
            None => unknown(FailureReasonCode::ProbeUnavailable),
        },
    };

    let outcome = if passed {
        CheckOutcome::Pass
    } else if matches!(requirement.severity, BlockingSeverity::Block) && requirement.required {
        CheckOutcome::Fail
    } else {
        CheckOutcome::Warn
    };
    let blocking = matches!(outcome, CheckOutcome::Fail)
        && requirement.required
        && matches!(requirement.severity, BlockingSeverity::Block);

    ReadinessCheck {
        kind: requirement.kind,
        required: requirement.required,
        severity: requirement.severity,
        outcome,
        blocking,
        organizer_override_allowed: requirement.organizer_override_allowed,
        reason,
        recovery_actions,
        detail,
    }
}

fn unknown(
    reason: FailureReasonCode,
) -> (
    bool,
    Option<FailureReasonCode>,
    Option<String>,
    Vec<RecoveryAction>,
) {
    (
        false,
        Some(reason),
        Some("readiness probe did not return a result".to_string()),
        vec![
            RecoveryAction::RetryReadinessScan,
            RecoveryAction::ContactOrganizer,
        ],
    )
}

fn is_present(value: Option<&str>) -> bool {
    value.map(str::trim).is_some_and(|value| !value.is_empty())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn passing_state() -> DeviceState {
        DeviceState {
            platform: Some("linux".to_string()),
            camera_available: Some(true),
            microphone_available: Some(true),
            network: Some(NetworkCheckResult {
                reachable: true,
                latency_ms: Some(40),
                jitter_ms: Some(5),
                quality: "good".to_string(),
                clock_skew_ms: Some(800),
            }),
            keyboard: Some(KeyboardInterceptResult {
                active: true,
                method: "test".to_string(),
                platform: "linux".to_string(),
            }),
            restricted_processes: Some(ProcessScanResult {
                found: vec![],
                clean: true,
            }),
            virtualization: Some(VirtDetectionResult {
                detected: false,
                platform: None,
                confidence: "high".to_string(),
            }),
        }
    }

    #[test]
    fn strict_policy_blocks_required_failure() {
        let mut state = passing_state();
        state.virtualization = Some(VirtDetectionResult {
            detected: true,
            platform: Some("KVM".to_string()),
            confidence: "high".to_string(),
        });

        let report = evaluate_readiness(
            &SessionPolicy::strict_contest(),
            Some("c1".into()),
            None,
            &state,
        );

        assert_eq!(report.decision, EnforcementDecision::Blocked);
        assert!(report
            .blocking_reasons
            .contains(&FailureReasonCode::VirtualizationDetected));
    }

    #[test]
    fn practice_policy_warns_without_blocking() {
        let mut state = passing_state();
        state.camera_available = Some(false);

        let policy = SessionPolicy::for_profile(EnforcementProfile::Practice);
        let report = evaluate_readiness(&policy, None, None, &state);

        assert_eq!(report.decision, EnforcementDecision::AllowedWithWarnings);
        assert!(report.blocking_reasons.is_empty());
    }

    #[test]
    fn strict_policy_allows_when_all_required_checks_pass() {
        let report = evaluate_readiness(
            &SessionPolicy::strict_contest(),
            Some("contest-1".into()),
            Some("device-1".into()),
            &passing_state(),
        );

        assert_eq!(report.decision, EnforcementDecision::Allowed);
        assert!(report.blocking_reasons.is_empty());
        assert!(report
            .checks
            .iter()
            .all(|check| check.outcome == CheckOutcome::Pass && !check.blocking));
    }

    #[test]
    fn custom_optional_requirement_warns_without_blocking() {
        let mut state = passing_state();
        state.network = Some(NetworkCheckResult {
            reachable: false,
            latency_ms: None,
            jitter_ms: None,
            quality: "offline".to_string(),
            clock_skew_ms: None,
        });

        let mut policy = SessionPolicy::strict_contest();
        policy.checks.push(ReadinessRequirement {
            kind: CheckKind::Network,
            required: false,
            severity: BlockingSeverity::Warning,
            organizer_override_allowed: true,
        });

        let report = evaluate_readiness(
            &policy,
            Some("contest-1".into()),
            Some("device-1".into()),
            &state,
        );

        let network_check = report
            .checks
            .iter()
            .find(|check| check.kind == CheckKind::Network)
            .expect("network check is present");

        assert_eq!(report.decision, EnforcementDecision::AllowedWithWarnings);
        assert!(report.blocking_reasons.is_empty());
        assert_eq!(network_check.outcome, CheckOutcome::Warn);
        assert!(!network_check.required);
        assert!(!network_check.blocking);
    }

    #[test]
    fn clock_skew_beyond_bound_blocks_strict_policy() {
        let mut state = passing_state();
        if let Some(network) = state.network.as_mut() {
            network.clock_skew_ms = Some(MAX_CLOCK_SKEW_MS + 1);
        }

        let report = evaluate_readiness(
            &SessionPolicy::strict_contest(),
            Some("c1".into()),
            Some("d1".into()),
            &state,
        );

        assert_eq!(report.decision, EnforcementDecision::Blocked);
        assert!(report
            .blocking_reasons
            .contains(&FailureReasonCode::ClockSkewDetected));
    }

    #[test]
    fn missing_clock_skew_signal_is_not_a_failure() {
        let mut state = passing_state();
        if let Some(network) = state.network.as_mut() {
            network.clock_skew_ms = None;
        }

        let report = evaluate_readiness(
            &SessionPolicy::strict_contest(),
            Some("c1".into()),
            Some("d1".into()),
            &state,
        );

        assert_eq!(report.decision, EnforcementDecision::Allowed);
    }

    #[test]
    fn strict_policy_blocks_missing_ids_and_splits_outcomes() {
        let policy = SessionPolicy::strict_contest();
        let report = evaluate_readiness(&policy, None, Some("device-1".into()), &passing_state());

        assert_eq!(report.decision, EnforcementDecision::Blocked);
        assert!(report
            .blocking_reasons
            .contains(&FailureReasonCode::ContestIdMissing));
        // Camera and microphone are advisory-only on every profile; the other
        // seven checks stay required under the strict profile.
        let optional_kinds = report
            .optional_checks
            .iter()
            .map(|check| check.kind.clone())
            .collect::<Vec<_>>();
        assert_eq!(
            optional_kinds,
            vec![CheckKind::Camera, CheckKind::Microphone]
        );
        assert_eq!(report.required_checks.len(), 7);
        assert_eq!(
            report.required_checks.len() + report.optional_checks.len(),
            report.checks.len()
        );
    }
}
