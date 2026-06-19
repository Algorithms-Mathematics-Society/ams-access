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

/// Windows-only display topology probe. On macOS/Linux this is never populated
/// (`DeviceState::external_displays` stays `None`) so the readiness policy
/// remains inert on those platforms.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DisplayScan {
    pub count: u32,
    pub has_extra: bool,    // >1 monitor attached
    pub has_wireless: bool, // a Miracast/virtual/wireless output present
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
    ClockIntegrity,
    KeyboardLockdown,
    RestrictedApps,
    Virtualization,
    Platform,
    ExternalDisplay,
    RemoteServer,
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
    NetworkHelperUnavailable,
    KeyboardLockdownUnavailable,
    RestrictedApplicationDetected,
    VirtualizationDetected,
    UnsupportedPlatform,
    ClockSkewDetected,
    ExternalDisplayDetected,
    RemoteServerDetected,
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
    InstallNetworkHelper,
    CloseRestrictedApplications,
    UsePhysicalMachine,
    UseSupportedPlatform,
    DisconnectExtraDisplays,
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
        Self::for_profile_with_platform(profile, None)
    }

    /// Platform-aware policy builder. The camera and the two Windows-only entry
    /// checks (`ExternalDisplay`, `RemoteServer`) become hard, blocking
    /// requirements ONLY when the profile is strict AND the device platform is
    /// Windows. On macOS/Linux (or when `platform` is `None`, e.g. the legacy
    /// `for_profile` callers) these stay advisory, so behavior there is
    /// unchanged.
    pub fn for_profile_with_platform(profile: EnforcementProfile, platform: Option<&str>) -> Self {
        let strict = matches!(profile, EnforcementProfile::StrictContest);
        // Prefix match so "windows_no_admin" (the unelevated-Windows platform
        // string) also counts as Windows — otherwise the new enforcement would
        // silently disarm on exactly the lower-trust non-admin machines.
        let is_windows =
            matches!(platform, Some(p) if p.to_ascii_lowercase().starts_with("windows"));
        let is_macos = matches!(platform, Some(p) if p.to_ascii_lowercase().starts_with("macos"));
        // Unelevated Windows: auto-elevation + the Relaunch-as-Administrator
        // recovery still run, but if a candidate genuinely cannot elevate (a
        // locked-down machine where UAC needs credentials they lack), the
        // Platform check is downgraded to a warning so they are not trapped.
        // Cost: no network firewall on that machine; keyboard + process
        // proctoring still apply. Genuinely unsupported OSes stay hard-blocked.
        let is_windows_no_admin =
            matches!(platform, Some(p) if p.eq_ignore_ascii_case("windows_no_admin"));
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
            CheckKind::ClockIntegrity,
            CheckKind::Camera,
            CheckKind::Microphone,
            CheckKind::ExternalDisplay,
            CheckKind::RemoteServer,
        ]
        .into_iter()
        .map(|kind| {
            // Microphone is advisory-only on all profiles — many contest machines
            // (lab desktops, headless setups) have no audio input. Proctoring
            // continuity does not depend on it.
            let (kind_required, kind_severity) = match kind {
                CheckKind::Microphone => (false, BlockingSeverity::Warning),
                // Network readiness is advisory on all profiles: egress lockdown is
                // applied best-effort during the contest and is NOT a hard entry
                // gate. A failing or uncollected network surfaces as a warning,
                // never a block, so contest entry is never gated on it. (Mirrors
                // the Microphone precedent above.)
                CheckKind::Network => (false, BlockingSeverity::Warning),
                // Camera and the two Windows-only entry checks are hard
                // requirements only under a strict Windows session; everywhere
                // else (non-strict, or non-Windows) they remain advisory so
                // macOS/Linux readiness behavior is identical to before.
                CheckKind::Camera | CheckKind::ExternalDisplay | CheckKind::RemoteServer => {
                    if strict && is_windows {
                        (true, BlockingSeverity::Block)
                    } else {
                        (false, BlockingSeverity::Warning)
                    }
                }
                // KeyboardLockdown is advisory (warning, not required) on macOS:
                // CGEventTap requires Accessibility permission which is often not
                // granted on day-of and cannot be obtained without leaving the exam
                // shell. Linux and Windows retain required+Block so their
                // lockdown invariants are unchanged.
                CheckKind::KeyboardLockdown if is_macos => (false, BlockingSeverity::Warning),
                // Unelevated Windows → advisory Platform check (see is_windows_no_admin).
                CheckKind::Platform if is_windows_no_admin => (false, BlockingSeverity::Warning),
                _ => (required, severity.clone()),
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
    pub external_displays: Option<DisplayScan>,
    pub rdp_server: Option<bool>,
    /// Whether the privileged network-lockdown helper is installed and reachable.
    /// Populated only where egress control depends on an out-of-process root
    /// helper (Linux). `None` elsewhere (Windows locks in-process; macOS readiness
    /// is intentionally left advisory), and `None` never blocks — only an explicit
    /// `Some(false)` does. `#[serde(default)]` keeps older payloads deserializing.
    #[serde(default)]
    pub network_helper_ready: Option<bool>,
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
        CheckKind::ClockIntegrity => match &device_state.network {
            // Only a MEASURED skew beyond the bound fails (and thus blocks).
            Some(network)
                if network
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
            // Clock within tolerance, OR not measured at all (no network probe,
            // e.g. the entry gate). We never block on an UNMEASURED clock, so the
            // gate is not re-blocked; clock integrity is enforced wherever the
            // network is actually probed (onboarding).
            _ => (
                true,
                None,
                Some("device clock within tolerance".to_string()),
                vec![],
            ),
        },
        CheckKind::Network if device_state.network_helper_ready == Some(false) => {
            // Network is advisory on every profile (see SessionPolicy), so a
            // down helper surfaces here as a non-blocking warning — it never
            // blocks contest entry. The check reports Warn (non-required/Warning
            // checks map to Warn, not Fail), so the cause is visible under "Optional warnings".
            (
                false,
                Some(FailureReasonCode::NetworkHelperUnavailable),
                Some(
                    "network lockdown helper is not installed or not running — egress cannot be restricted"
                        .to_string(),
                ),
                vec![
                    RecoveryAction::InstallNetworkHelper,
                    RecoveryAction::RetryReadinessScan,
                ],
            )
        }
        CheckKind::Network => match &device_state.network {
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
                // Include the method string so the UI can detect
                // "accessibility_denied" specifically on macOS and present
                // a targeted "Grant Accessibility permission" recovery panel
                // rather than a generic "unavailable" message.
                Some(format!(
                    "keyboard lockdown unavailable on {} (method: {})",
                    keyboard.platform, keyboard.method
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
        // Windows-only entry check. Inert on macOS/Linux: when the device
        // platform is not Windows (or no display scan was produced) the check
        // always passes, and `required=false` from the policy on those
        // platforms makes it doubly inert.
        CheckKind::ExternalDisplay => {
            let is_windows = matches!(&device_state.platform, Some(p) if p.to_ascii_lowercase().starts_with("windows"));
            let bad = is_windows
                && device_state
                    .external_displays
                    .as_ref()
                    .map(|d| d.has_extra || d.has_wireless)
                    .unwrap_or(false);
            if bad {
                (
                    false,
                    Some(FailureReasonCode::ExternalDisplayDetected),
                    Some(
                        "A second or wireless display is connected — disconnect it to continue."
                            .to_string(),
                    ),
                    vec![
                        RecoveryAction::DisconnectExtraDisplays,
                        RecoveryAction::RetryReadinessScan,
                    ],
                )
            } else {
                (
                    true,
                    None,
                    Some("no extra or wireless display detected".to_string()),
                    vec![],
                )
            }
        }
        // Windows-only entry check. Inert on macOS/Linux for the same reasons
        // as `ExternalDisplay`.
        CheckKind::RemoteServer => {
            let is_windows = matches!(&device_state.platform, Some(p) if p.to_ascii_lowercase().starts_with("windows"));
            let bad = is_windows && device_state.rdp_server == Some(true);
            if bad {
                (
                    false,
                    Some(FailureReasonCode::RemoteServerDetected),
                    Some("This machine is hosting a remote-desktop session.".to_string()),
                    vec![
                        RecoveryAction::UsePhysicalMachine,
                        RecoveryAction::ContactOrganizer,
                    ],
                )
            } else {
                (
                    true,
                    None,
                    Some("not hosting a remote-desktop session".to_string()),
                    vec![],
                )
            }
        }
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
            external_displays: None,
            rdp_server: None,
            network_helper_ready: Some(true),
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
    fn network_helper_down_warns_not_blocks_strict_and_is_inert_when_unknown() {
        // Network is advisory: even with the egress helper explicitly down,
        // strict contest must NOT block on it — it surfaces as a non-blocking
        // warning so contest entry is never gated on network readiness.
        let mut down = passing_state();
        down.network_helper_ready = Some(false);
        let report = evaluate_readiness(
            &SessionPolicy::strict_contest(),
            Some("contest-1".into()),
            Some("device-1".into()),
            &down,
        );
        assert_eq!(report.decision, EnforcementDecision::AllowedWithWarnings);
        // The helper-down reason rides on the (non-blocking) network check, so it
        // must NOT appear in blocking_reasons.
        assert!(report.blocking_reasons.is_empty());
        let net = report
            .checks
            .iter()
            .find(|c| c.kind == CheckKind::Network)
            .expect("network check present");
        assert!(!net.blocking);
        // Advisory (non-required/Warning) checks surface as Warn, not Fail.
        assert_eq!(net.outcome, CheckOutcome::Warn);
        assert!(net.reason == Some(FailureReasonCode::NetworkHelperUnavailable));

        // Unknown helper signal + an otherwise-good network still passes cleanly.
        let mut unknown = passing_state();
        unknown.network_helper_ready = None;
        let report = evaluate_readiness(
            &SessionPolicy::strict_contest(),
            Some("contest-1".into()),
            Some("device-1".into()),
            &unknown,
        );
        assert_eq!(report.decision, EnforcementDecision::Allowed);
    }

    #[test]
    fn network_requirement_is_advisory_under_strict_contest() {
        // Even on a strict Windows session (where camera/display become strict),
        // Network stays advisory.
        let policy = SessionPolicy::for_profile_with_platform(
            EnforcementProfile::StrictContest,
            Some("windows"),
        );
        let net = policy
            .checks
            .iter()
            .find(|r| r.kind == CheckKind::Network)
            .expect("network requirement present");
        assert!(!net.required, "network must be advisory (not required)");
        assert!(matches!(net.severity, BlockingSeverity::Warning));
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
    fn clock_skew_beyond_bound_blocks_strict_via_clock_integrity() {
        // Clock skew is now enforced via the dedicated ClockIntegrity check, which
        // is required+Block under strict_contest. A detected skew BLOCKS entry and
        // appears in blocking_reasons.
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
        // The ClockIntegrity check itself must be blocking with Fail outcome.
        let clock = report
            .checks
            .iter()
            .find(|c| c.kind == CheckKind::ClockIntegrity)
            .expect("ClockIntegrity check present");
        assert!(clock.blocking);
        assert_eq!(clock.outcome, CheckOutcome::Fail);
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
        // With no platform supplied (legacy `strict_contest()` / `None`
        // platform), camera/microphone, network, and the two Windows-only entry
        // checks are all advisory; the other seven checks (including ClockIntegrity)
        // stay required under the strict profile. `optional_kinds` is ordered by
        // `CheckKind`'s derived `Ord`.
        let optional_kinds = report
            .optional_checks
            .iter()
            .map(|check| check.kind.clone())
            .collect::<Vec<_>>();
        assert_eq!(
            optional_kinds,
            vec![
                CheckKind::Camera,
                CheckKind::Microphone,
                CheckKind::Network,
                CheckKind::ExternalDisplay,
                CheckKind::RemoteServer,
            ]
        );
        assert_eq!(report.required_checks.len(), 7);
        assert_eq!(
            report.required_checks.len() + report.optional_checks.len(),
            report.checks.len()
        );
    }

    /// Helper: a fully clean Windows device state.
    fn windows_state() -> DeviceState {
        DeviceState {
            platform: Some("windows".to_string()),
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
                platform: "windows".to_string(),
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
            external_displays: Some(DisplayScan {
                count: 1,
                has_extra: false,
                has_wireless: false,
            }),
            rdp_server: Some(false),
            // Windows locks egress in-process; the out-of-process helper signal
            // does not apply, so the gate stays inert (None).
            network_helper_ready: None,
        }
    }

    #[test]
    fn macos_camera_and_new_checks_stay_non_blocking() {
        // macOS: camera absent, new probes absent — none of these may block.
        let mut state = passing_state();
        state.platform = Some("macos".to_string());
        state.camera_available = None;
        state.external_displays = None;
        state.rdp_server = None;

        let report = evaluate_readiness(
            &SessionPolicy::strict_contest(),
            Some("c1".into()),
            Some("d1".into()),
            &state,
        );

        assert_ne!(report.decision, EnforcementDecision::Blocked);
        // Camera advisory behavior preserved: not required, never blocking.
        let camera = report
            .checks
            .iter()
            .find(|c| c.kind == CheckKind::Camera)
            .expect("camera check present");
        assert!(!camera.required);
        assert!(!camera.blocking);
        for kind in [CheckKind::ExternalDisplay, CheckKind::RemoteServer] {
            let check = report
                .checks
                .iter()
                .find(|c| c.kind == kind)
                .expect("check present");
            assert!(!check.blocking);
        }
        // KeyboardLockdown: with the platform-aware policy builder (macos),
        // the requirement is advisory. Verified in full by
        // `macos_keyboard_lockdown_is_advisory_not_blocking`; here we just
        // confirm it does not block on a passing macOS device state.
        let kbd = report
            .checks
            .iter()
            .find(|c| c.kind == CheckKind::KeyboardLockdown)
            .expect("keyboard_lockdown check present");
        assert!(!kbd.blocking, "keyboard_lockdown must not block on macOS");
    }

    #[test]
    fn macos_keyboard_lockdown_is_advisory_not_blocking() {
        // macOS strict contest: keyboard lockdown failure must NOT block entry.
        // Linux and Windows must still be required+Block.
        let policy = SessionPolicy::for_profile_with_platform(
            EnforcementProfile::StrictContest,
            Some("macos"),
        );
        let kbd_req = policy
            .checks
            .iter()
            .find(|r| r.kind == CheckKind::KeyboardLockdown)
            .expect("keyboard_lockdown requirement present");
        assert!(
            !kbd_req.required,
            "keyboard_lockdown must be non-required on macOS"
        );
        assert!(
            matches!(kbd_req.severity, BlockingSeverity::Warning),
            "keyboard_lockdown severity must be Warning on macOS, got {:?}",
            kbd_req.severity
        );

        // Simulate keyboard lockdown failing on macOS — must NOT block.
        let mut state = passing_state();
        state.platform = Some("macos".to_string());
        state.keyboard = Some(KeyboardInterceptResult {
            active: false,
            method: "accessibility_denied".to_string(),
            platform: "macos".to_string(),
        });

        let report = evaluate_readiness(&policy, Some("c1".into()), Some("d1".into()), &state);

        assert_ne!(
            report.decision,
            EnforcementDecision::Blocked,
            "macOS keyboard lockdown failure must not block contest entry"
        );
        assert!(
            !report
                .blocking_reasons
                .contains(&FailureReasonCode::KeyboardLockdownUnavailable),
            "KeyboardLockdownUnavailable must not appear in blocking_reasons on macOS"
        );
        let kbd_check = report
            .checks
            .iter()
            .find(|c| c.kind == CheckKind::KeyboardLockdown)
            .expect("keyboard_lockdown check present");
        assert!(!kbd_check.blocking);
        assert_eq!(kbd_check.outcome, CheckOutcome::Warn);

        // Linux: keyboard lockdown must remain required+Block.
        let linux_policy = SessionPolicy::for_profile_with_platform(
            EnforcementProfile::StrictContest,
            Some("linux"),
        );
        let linux_kbd = linux_policy
            .checks
            .iter()
            .find(|r| r.kind == CheckKind::KeyboardLockdown)
            .expect("keyboard_lockdown present on linux policy");
        assert!(
            linux_kbd.required,
            "keyboard_lockdown must be required on Linux"
        );
        assert!(
            matches!(linux_kbd.severity, BlockingSeverity::Block),
            "keyboard_lockdown must be Block on Linux"
        );

        // Windows: keyboard lockdown must remain required+Block.
        let windows_policy = SessionPolicy::for_profile_with_platform(
            EnforcementProfile::StrictContest,
            Some("windows"),
        );
        let windows_kbd = windows_policy
            .checks
            .iter()
            .find(|r| r.kind == CheckKind::KeyboardLockdown)
            .expect("keyboard_lockdown present on windows policy");
        assert!(
            windows_kbd.required,
            "keyboard_lockdown must be required on Windows"
        );
        assert!(
            matches!(windows_kbd.severity, BlockingSeverity::Block),
            "keyboard_lockdown must be Block on Windows"
        );
    }

    #[test]
    fn windows_no_admin_platform_check_is_advisory() {
        // Unelevated Windows must not be trapped: the Platform check is advisory
        // (auto-elevation + the Relaunch-as-Administrator recovery still run).
        // Elevated Windows keeps it required+Block.
        let policy = SessionPolicy::for_profile_with_platform(
            EnforcementProfile::StrictContest,
            Some("windows_no_admin"),
        );
        let plat = policy
            .checks
            .iter()
            .find(|r| r.kind == CheckKind::Platform)
            .expect("platform requirement present");
        assert!(
            !plat.required,
            "platform must be advisory on windows_no_admin"
        );
        assert!(
            matches!(plat.severity, BlockingSeverity::Warning),
            "platform severity must be Warning on windows_no_admin, got {:?}",
            plat.severity
        );

        let elevated = SessionPolicy::for_profile_with_platform(
            EnforcementProfile::StrictContest,
            Some("windows"),
        );
        let ep = elevated
            .checks
            .iter()
            .find(|r| r.kind == CheckKind::Platform)
            .expect("platform present on elevated windows policy");
        assert!(
            ep.required && matches!(ep.severity, BlockingSeverity::Block),
            "elevated Windows must keep platform required+Block"
        );
    }

    #[test]
    fn linux_camera_and_new_checks_stay_non_blocking() {
        let mut state = passing_state();
        state.platform = Some("linux".to_string());
        state.camera_available = None;
        state.external_displays = None;
        state.rdp_server = None;

        let report = evaluate_readiness(
            &SessionPolicy::strict_contest(),
            Some("c1".into()),
            Some("d1".into()),
            &state,
        );

        assert_ne!(report.decision, EnforcementDecision::Blocked);
        let camera = report
            .checks
            .iter()
            .find(|c| c.kind == CheckKind::Camera)
            .expect("camera check present");
        assert!(!camera.required);
        assert!(!camera.blocking);
    }

    #[test]
    fn windows_strict_blocks_missing_camera() {
        let policy = SessionPolicy::for_profile_with_platform(
            EnforcementProfile::StrictContest,
            Some("windows"),
        );
        let mut state = windows_state();
        state.camera_available = Some(false);

        let report = evaluate_readiness(&policy, Some("c1".into()), Some("d1".into()), &state);

        assert_eq!(report.decision, EnforcementDecision::Blocked);
        assert!(report
            .blocking_reasons
            .contains(&FailureReasonCode::CameraUnavailable));
    }

    #[test]
    fn windows_strict_blocks_extra_display() {
        let policy = SessionPolicy::for_profile_with_platform(
            EnforcementProfile::StrictContest,
            Some("windows"),
        );
        let mut state = windows_state();
        state.external_displays = Some(DisplayScan {
            count: 2,
            has_extra: true,
            has_wireless: false,
        });

        let report = evaluate_readiness(&policy, Some("c1".into()), Some("d1".into()), &state);

        assert_eq!(report.decision, EnforcementDecision::Blocked);
        assert!(report
            .blocking_reasons
            .contains(&FailureReasonCode::ExternalDisplayDetected));
    }

    #[test]
    fn windows_strict_blocks_rdp_server() {
        let policy = SessionPolicy::for_profile_with_platform(
            EnforcementProfile::StrictContest,
            Some("windows"),
        );
        let mut state = windows_state();
        state.rdp_server = Some(true);

        let report = evaluate_readiness(&policy, Some("c1".into()), Some("d1".into()), &state);

        assert_eq!(report.decision, EnforcementDecision::Blocked);
        assert!(report
            .blocking_reasons
            .contains(&FailureReasonCode::RemoteServerDetected));
    }

    #[test]
    fn windows_no_admin_still_enforces_new_checks() {
        // Unelevated Windows reports platform "windows_no_admin"; the enforcement
        // must still apply (prefix match), so the lowest-trust machines are not
        // the ones that silently lose camera/display/RDP gating.
        let policy = SessionPolicy::for_profile_with_platform(
            EnforcementProfile::StrictContest,
            Some("windows_no_admin"),
        );
        let mut state = windows_state();
        state.platform = Some("windows_no_admin".into());
        state.external_displays = Some(DisplayScan {
            count: 2,
            has_extra: true,
            has_wireless: false,
        });

        let report = evaluate_readiness(&policy, Some("c1".into()), Some("d1".into()), &state);

        assert_eq!(report.decision, EnforcementDecision::Blocked);
        assert!(report
            .blocking_reasons
            .contains(&FailureReasonCode::ExternalDisplayDetected));
    }

    #[test]
    fn clean_windows_is_not_blocked_by_new_checks() {
        let policy = SessionPolicy::for_profile_with_platform(
            EnforcementProfile::StrictContest,
            Some("windows"),
        );
        let report = evaluate_readiness(
            &policy,
            Some("c1".into()),
            Some("d1".into()),
            &windows_state(),
        );

        assert_eq!(report.decision, EnforcementDecision::Allowed);
        assert!(report.blocking_reasons.is_empty());
    }

    #[test]
    fn organizer_override_relaxes_windows_camera() {
        let policy = SessionPolicy::for_profile_with_platform(
            EnforcementProfile::StrictContest,
            Some("windows"),
        );
        // Sanity: camera is a hard requirement under the Windows strict policy.
        // (`organizer_override_allowed` follows the crate-wide `!strict` pattern,
        // so it is `false` here — there is no per-check non-overridable set;
        // override application happens by merging a relaxed requirement below.)
        let camera_req = policy
            .checks
            .iter()
            .find(|r| r.kind == CheckKind::Camera)
            .expect("camera requirement present");
        assert!(camera_req.required);

        // Apply an organizer override that downgrades camera to advisory. The
        // crate exposes override application via `policy.checks` (merged in
        // `merge_requirements`), mirroring the existing
        // `custom_optional_requirement_warns_without_blocking` test.
        let mut overridden = policy;
        overridden.checks.push(ReadinessRequirement {
            kind: CheckKind::Camera,
            required: false,
            severity: BlockingSeverity::Warning,
            organizer_override_allowed: true,
        });

        let mut state = windows_state();
        state.camera_available = Some(false);

        let report = evaluate_readiness(&overridden, Some("c1".into()), Some("d1".into()), &state);

        // Camera no longer blocks once overridden to advisory.
        assert_ne!(report.decision, EnforcementDecision::Blocked);
        assert!(!report
            .blocking_reasons
            .contains(&FailureReasonCode::CameraUnavailable));
    }

    #[test]
    fn clock_integrity_passes_when_network_unmeasured() {
        // When there is no network probe (entry gate skips it), ClockIntegrity
        // must not block. The decision will be AllowedWithWarnings (Network is
        // advisory+unmeasured→Warn) but ClockIntegrity must be Pass and non-blocking.
        let mut state = passing_state();
        state.network = None;

        let report = evaluate_readiness(
            &SessionPolicy::strict_contest(),
            Some("c1".into()),
            Some("d1".into()),
            &state,
        );

        assert_ne!(report.decision, EnforcementDecision::Blocked);
        let clock = report
            .checks
            .iter()
            .find(|c| c.kind == CheckKind::ClockIntegrity)
            .expect("ClockIntegrity check present");
        assert!(!clock.blocking);
        assert_eq!(clock.outcome, CheckOutcome::Pass);
    }

    #[test]
    fn clock_integrity_is_required_block_under_strict() {
        let p = SessionPolicy::for_profile_with_platform(
            EnforcementProfile::StrictContest,
            Some("windows"),
        );
        let c = p
            .checks
            .iter()
            .find(|r| r.kind == CheckKind::ClockIntegrity)
            .expect("ClockIntegrity requirement present");
        assert!(c.required);
        assert!(matches!(c.severity, BlockingSeverity::Block));
    }
}
