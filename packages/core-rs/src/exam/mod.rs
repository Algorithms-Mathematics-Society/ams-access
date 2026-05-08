use serde::{Deserialize, Serialize};

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

#[derive(Debug, Clone, Serialize, Deserialize)]
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
pub struct VirtDetectionResult {
    pub detected: bool,
    pub platform: Option<String>,
    pub confidence: &'static str,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyboardInterceptResult {
    pub active: bool,
    pub method: &'static str,
    pub platform: &'static str,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkCheckResult {
    pub reachable: bool,
    pub latency_ms: Option<u64>,
    pub jitter_ms: Option<u64>,
    pub quality: &'static str,
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
