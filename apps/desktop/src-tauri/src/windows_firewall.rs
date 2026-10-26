//! Supervised Windows builds only: verify the selected private runtime before
//! policy mutation, retain its identity pins, and detect environment drift.
use platform_rs::windows::{prepare_private_runtime, VerifiedRuntime};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;
use tauri::Manager;
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Environment8;
use windows_core::Interface;

static POLICY: tokio::sync::Mutex<Option<VerifiedRuntime>> = tokio::sync::Mutex::const_new(None);
static HEALTH: PolicyHealth = PolicyHealth::new();
static ENABLE_EPOCH: OperationEpoch = OperationEpoch::new();

struct OperationEpoch(AtomicU64);

impl OperationEpoch {
    const fn new() -> Self {
        Self(AtomicU64::new(0))
    }

    fn ticket(&self) -> u64 {
        self.0.load(Ordering::SeqCst)
    }

    fn invalidate(&self) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }

    fn check(&self, ticket: u64) -> Result<(), String> {
        if self.ticket() == ticket {
            Ok(())
        } else {
            Err("Network lockdown enable was cancelled by restoration".into())
        }
    }
}

pub fn enable_ticket() -> u64 {
    ENABLE_EPOCH.ticket()
}

pub fn invalidate_pending_enable() {
    ENABLE_EPOCH.invalidate();
}

struct PolicyHealth {
    generation: AtomicU64,
    requested: AtomicBool,
    healthy: AtomicBool,
    recovery_pending: AtomicBool,
}

impl PolicyHealth {
    const fn new() -> Self {
        Self {
            generation: AtomicU64::new(0),
            requested: AtomicBool::new(false),
            healthy: AtomicBool::new(false),
            recovery_pending: AtomicBool::new(false),
        }
    }

    fn protection_ready(&self) -> bool {
        !self.requested.load(Ordering::SeqCst) || self.healthy.load(Ordering::SeqCst)
    }

    fn installing(&self) {
        self.healthy.store(false, Ordering::SeqCst);
        self.generation.fetch_add(1, Ordering::SeqCst);
    }

    fn installed(&self) -> u64 {
        self.requested.store(true, Ordering::SeqCst);
        self.healthy.store(true, Ordering::SeqCst);
        self.generation.fetch_add(1, Ordering::SeqCst) + 1
    }

    fn disabled(&self) {
        self.requested.store(false, Ordering::SeqCst);
        self.healthy.store(false, Ordering::SeqCst);
        self.recovery_pending.store(false, Ordering::SeqCst);
        self.generation.fetch_add(1, Ordering::SeqCst);
    }

    fn cleanup_failed(&self) {
        self.recovery_pending.store(true, Ordering::SeqCst);
    }

    fn recovery_needed(&self, build_expects_firewall: bool) -> bool {
        build_expects_firewall || self.recovery_pending.load(Ordering::SeqCst)
    }

    fn observe(&self, generation: u64, healthy: bool) -> Option<bool> {
        if self.generation.load(Ordering::SeqCst) != generation {
            return None;
        }
        Some(self.healthy.swap(healthy, Ordering::SeqCst))
    }
}

pub fn protection_ready() -> bool {
    HEALTH.protection_ready()
}

pub fn recovery_pending() -> bool {
    HEALTH.recovery_pending.load(Ordering::SeqCst)
}

pub fn recovery_needed(build_expects_firewall: bool) -> bool {
    HEALTH.recovery_needed(build_expects_firewall)
}

pub fn note_startup_cleanup(result: &Result<(), String>) {
    if result.is_err() {
        HEALTH.cleanup_failed();
    }
}

async fn verify(app: &tauri::AppHandle, runtime: &VerifiedRuntime) -> Result<(), String> {
    let views = app.webview_windows();
    if views.is_empty() {
        return Err("Cannot verify WebView2: no active webview".into());
    }
    let mut browsers = Vec::new();
    let mut processes = Vec::new();
    for view in views.into_values() {
        let (tx, rx) = tokio::sync::oneshot::channel();
        view.with_webview(move |webview| {
            let result = (|| -> Result<_, windows_core::Error> {
                unsafe {
                    let environment: ICoreWebView2Environment8 = webview.environment().cast()?;
                    let mut browser = 0;
                    webview
                        .controller()
                        .CoreWebView2()?
                        .BrowserProcessId(&mut browser)?;
                    let inventory = environment.GetProcessInfos()?;
                    let mut count = 0;
                    inventory.Count(&mut count)?;
                    let mut pids = Vec::new();
                    for index in 0..count {
                        let mut pid = 0;
                        inventory.GetValueAtIndex(index)?.ProcessId(&mut pid)?;
                        if pid <= 0 {
                            return Err(windows_core::Error::from_hresult(windows_core::HRESULT(
                                0x80004005u32 as i32,
                            )));
                        }
                        pids.push(pid as u32);
                    }
                    Ok((browser, pids))
                }
            })()
            .map_err(|error| format!("Cannot enumerate WebView2 processes: {error}"));
            let _ = tx.send(result);
        })
        .map_err(|error| format!("Cannot inspect WebView2: {error}"))?;
        let (browser, pids) = tokio::time::timeout(Duration::from_secs(3), rx)
            .await
            .map_err(|_| "WebView2 identity verification timed out")?
            .map_err(|_| "WebView2 identity callback was lost")??;
        if browser == 0 || !pids.contains(&browser) {
            return Err("WebView2 browser missing from process inventory".into());
        }
        browsers.push(browser);
        processes.extend(pids);
    }
    processes.sort_unstable();
    processes.dedup();
    runtime.verify_processes(browsers[0], &processes)
}

pub async fn enable(app: tauri::AppHandle, ips: Vec<String>, ticket: u64) -> Result<bool, String> {
    let mut policy = POLICY.lock().await;
    ENABLE_EPOCH.check(ticket)?;
    HEALTH.installing();
    let folder = option_env!("AMS_PRIVATE_WEBVIEW2_FOLDER").unwrap_or("");
    let runtime = prepare_private_runtime(Path::new(folder))?;
    verify(&app, &runtime).await?;
    ENABLE_EPOCH.check(ticket)?;
    let installed_runtime = runtime.clone();
    let install = tauri::async_runtime::spawn_blocking(move || {
        platform_rs::windows::enable_network_lockdown(&ips, &installed_runtime)
    })
    .await
    .map_err(|error| error.to_string())?;
    if let Err(error) = install {
        // A rollback failure may leave rules referring to this image.
        if policy.is_none() {
            *policy = Some(runtime);
        }
        // Install errors include failed rollback; require verified cleanup before clearing recovery.
        HEALTH.cleanup_failed();
        return Err(error);
    }
    // Process creation during installation must not produce a false success.
    if let Err(error) = verify(&app, &runtime).await {
        let cleanup =
            tauri::async_runtime::spawn_blocking(platform_rs::windows::disable_network_lockdown)
                .await
                .map_err(|error| error.to_string())?;
        if let Err(cleanup) = cleanup {
            *policy = Some(runtime); // Keep identity pins until recovery succeeds.
            HEALTH.cleanup_failed();
            return Err(format!("{error}; rollback failed: {cleanup}"));
        }
        return Err(error);
    }
    *policy = Some(runtime);
    let generation = HEALTH.installed();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            let policy = POLICY.lock().await;
            if HEALTH.generation.load(Ordering::SeqCst) != generation {
                return;
            }
            let Some(runtime) = policy.as_ref() else {
                return;
            };
            // A child can exit between enumeration and image query. Retry a
            // fresh inventory before reporting loss of runtime coverage.
            let verification = match verify(&app, runtime).await {
                Ok(()) => Ok(()),
                Err(_) => verify(&app, runtime).await,
            };
            let healthy = verification.is_ok();
            let Some(was_healthy) = HEALTH.observe(generation, healthy) else {
                return;
            };
            if was_healthy && !healthy {
                let error = verification.unwrap_err();
                super::record_proctoring_event(
                    Some(&app),
                    "network_lockdown_degraded",
                    &error,
                    serde_json::json!({"severity": "high", "coverage": "unverified"}),
                );
            } else if !was_healthy && healthy {
                super::record_proctoring_event(
                    Some(&app),
                    "network_lockdown_restored",
                    "Private WebView2 process identity verified again",
                    serde_json::json!({"severity": "info"}),
                );
            }
        }
    });
    Ok(true)
}

pub fn disable_blocking() -> Result<bool, String> {
    invalidate_pending_enable();
    let mut policy = POLICY.blocking_lock();
    if let Err(error) = platform_rs::windows::disable_network_lockdown() {
        HEALTH.cleanup_failed();
        return Err(error);
    }
    *policy = None;
    HEALTH.disabled();
    Ok(true)
}

pub async fn disable() -> Result<bool, String> {
    invalidate_pending_enable();
    tauri::async_runtime::spawn_blocking(disable_blocking)
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::{OperationEpoch, PolicyHealth};

    #[test]
    fn restore_during_resolution_cancels_late_install() {
        use std::sync::{mpsc, Arc, Mutex};

        let epoch = Arc::new(OperationEpoch::new());
        let policy = Arc::new(Mutex::new(false));
        let (started_tx, started_rx) = mpsc::channel();
        let (continue_tx, continue_rx) = mpsc::channel();
        let pending = {
            let epoch = Arc::clone(&epoch);
            let policy = Arc::clone(&policy);
            std::thread::spawn(move || {
                let ticket = epoch.ticket();
                started_tx.send(()).unwrap();
                continue_rx.recv().unwrap(); // The DNS lookup finishes after restore.
                let mut installed = policy.lock().unwrap();
                if epoch.check(ticket).is_ok() {
                    *installed = true;
                }
            })
        };
        started_rx.recv().unwrap();
        epoch.invalidate();
        *policy.lock().unwrap() = false; // Verified restore found no rules.
        continue_tx.send(()).unwrap();
        pending.join().unwrap();
        assert!(!*policy.lock().unwrap());
    }

    #[test]
    fn disable_invalidates_old_guard_and_default_build_has_no_required_policy() {
        let health = PolicyHealth::new();
        assert!(health.protection_ready());
        let old_guard = health.installed();
        health.disabled();
        assert_eq!(health.observe(old_guard, false), None);
        assert!(health.protection_ready());
        let new_guard = health.installed();
        assert_ne!(old_guard, new_guard);
        assert_eq!(health.observe(old_guard, true), None);
    }

    #[test]
    fn failed_reenable_cannot_keep_previous_healthy_claim() {
        let health = PolicyHealth::new();
        let old_guard = health.installed();
        health.installing();
        assert_eq!(health.observe(old_guard, true), None);
        assert!(!health.protection_ready());
        let retry = health.installed();
        assert!(health.protection_ready());
        assert_eq!(health.observe(retry, false), Some(true));
        assert!(!health.protection_ready());
        assert_eq!(health.observe(retry, true), Some(false));
        assert!(health.protection_ready());
    }

    #[test]
    fn failed_cleanup_remains_pending_until_verified_disable() {
        let health = PolicyHealth::new();
        assert!(!health
            .recovery_pending
            .load(std::sync::atomic::Ordering::SeqCst));
        health.cleanup_failed();
        assert!(health
            .recovery_pending
            .load(std::sync::atomic::Ordering::SeqCst));
        health.installed();
        assert!(health
            .recovery_pending
            .load(std::sync::atomic::Ordering::SeqCst));
        health.disabled();
        assert!(!health
            .recovery_pending
            .load(std::sync::atomic::Ordering::SeqCst));
    }

    #[test]
    fn ordinary_build_retries_only_when_prior_cleanup_failed() {
        let health = PolicyHealth::new();
        assert!(!health.recovery_needed(false));
        assert!(health.recovery_needed(true));
        health.cleanup_failed();
        assert!(health.recovery_needed(false));
    }
}
