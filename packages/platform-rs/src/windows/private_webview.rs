//! Identity and retained handles for the supervised app-private WebView2 target.
//! No rules may be installed from a guessed or shared Evergreen executable path.

use std::path::{Component, Path, PathBuf, Prefix};

use std::fs::{File, OpenOptions};
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::AsRawHandle;
use std::sync::{Arc, Mutex};
use windows::core::PWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::Storage::FileSystem::{
    GetFinalPathNameByHandleW, FILE_FLAG_BACKUP_SEMANTICS, FILE_NAME_NORMALIZED,
};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};

type ProcessSnapshot = (u32, Vec<u32>);

#[derive(Clone)]
pub struct VerifiedRuntime {
    pub(super) app_image: PathBuf,
    pub(super) browser_image: PathBuf,
    folder: PathBuf,
    // Deny rename/delete/write of the selected image and directory for the
    // policy lifetime. Path validation without retained handles has a TOCTOU gap.
    _pins: Arc<Vec<File>>,
    processes: Arc<Mutex<Option<ProcessSnapshot>>>,
}

pub fn prepare_private_runtime(folder: &Path) -> Result<VerifiedRuntime, String> {
    let app = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !matches!(app.components().next(), Some(Component::Prefix(prefix)) if matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_)))
    {
        return Err("Supervised private WebView2 must be installed on a local drive".into());
    }
    let browser = expected_browser_image(&app, folder)?;
    let directory = browser.parent().unwrap();
    let pins = vec![
        pin(app.parent().unwrap(), true)?,
        pin(&app, false)?,
        pin(directory, true)?,
        pin(&browser, false)?,
    ];
    let canonical_dir = directory.canonicalize().map_err(|e| e.to_string())?;
    let canonical_browser = browser.canonicalize().map_err(|e| e.to_string())?;
    validate_canonical_layout(&app, folder, &canonical_dir, &canonical_browser)?;
    Ok(VerifiedRuntime {
        app_image: app,
        browser_image: canonical_browser,
        folder: folder.to_owned(),
        _pins: Arc::new(pins),
        processes: Arc::new(Mutex::new(None)),
    })
}

fn pin(path: &Path, directory: bool) -> Result<File, String> {
    let mut options = OpenOptions::new();
    // FILE_SHARE_READ only. This prevents replacement while rules refer to it.
    options.read(true).share_mode(1);
    if directory {
        options.custom_flags(FILE_FLAG_BACKUP_SEMANTICS.0);
    }
    let file = options.open(path).map_err(|e| {
        format!(
            "Cannot pin private WebView2 identity {}: {e}",
            path.display()
        )
    })?;
    let mut buffer = vec![0u16; 32768];
    let length = unsafe {
        GetFinalPathNameByHandleW(
            HANDLE(file.as_raw_handle()),
            &mut buffer,
            FILE_NAME_NORMALIZED,
        )
    };
    if length == 0 || length as usize >= buffer.len() {
        return Err("Cannot resolve pinned private WebView2 identity".into());
    }
    let actual = PathBuf::from(String::from_utf16_lossy(&buffer[..length as usize]));
    let expected = path.canonicalize().map_err(|e| e.to_string())?;
    if actual != expected {
        return Err("Private WebView2 path changed during validation".into());
    }
    Ok(file)
}

impl VerifiedRuntime {
    /// Called using a fresh Environment8 process inventory from the UI thread.
    pub fn verify_processes(&self, browser_pid: u32, processes: &[u32]) -> Result<(), String> {
        self.check_processes(browser_pid, processes)?;
        *self
            .processes
            .lock()
            .map_err(|_| "WebView2 identity lock poisoned")? =
            Some((browser_pid, processes.to_vec()));
        Ok(())
    }

    fn check_processes(&self, browser_pid: u32, processes: &[u32]) -> Result<(), String> {
        let images = processes
            .iter()
            .map(|&pid| process_image(pid).map(|image| (pid, image)))
            .collect::<Result<Vec<_>, _>>()?;
        validate_browser_images(&self.browser_image, browser_pid, &images)
    }

    pub(super) fn revalidate_layout(&self) -> Result<(), String> {
        let directory = self
            .browser_image
            .parent()
            .unwrap()
            .canonicalize()
            .map_err(|e| e.to_string())?;
        let browser = self
            .browser_image
            .canonicalize()
            .map_err(|e| e.to_string())?;
        validate_canonical_layout(&self.app_image, &self.folder, &directory, &browser)?;
        let snapshot = self
            .processes
            .lock()
            .map_err(|_| "WebView2 identity lock poisoned")?;
        let (browser_pid, processes) = snapshot
            .as_ref()
            .ok_or("WebView2 processes have not been verified")?;
        self.check_processes(*browser_pid, processes)
    }
}

fn process_image(pid: u32) -> Result<PathBuf, String> {
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }
        .map_err(|e| format!("Cannot inspect WebView2 process {pid}: {e}"))?;
    let mut buffer = vec![0u16; 32768];
    let mut length = buffer.len() as u32;
    let result = unsafe {
        QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut length,
        )
    };
    let _ = unsafe { CloseHandle(handle) };
    result.map_err(|e| format!("Cannot resolve WebView2 process {pid}: {e}"))?;
    PathBuf::from(String::from_utf16_lossy(&buffer[..length as usize]))
        .canonicalize()
        .map_err(|e| e.to_string())
}

/// Derive the only acceptable browser image for a Fixed Version runtime packaged
/// in a single directory directly beside the AMS executable. This must be
/// paired with the actual Tauri FixedRuntime setting; it does not select a
/// runtime or establish that a process uses it.
pub(super) fn expected_browser_image(
    app_exe: &Path,
    configured_folder: &Path,
) -> Result<PathBuf, String> {
    if !matches!(
        configured_folder
            .components()
            .collect::<Vec<_>>()
            .as_slice(),
        [Component::Normal(_)]
    ) {
        return Err(
            "Fixed WebView2 runtime must be a single private directory beside the AMS executable"
                .into(),
        );
    }
    let app_dir = app_exe
        .parent()
        .ok_or("AMS executable has no parent directory")?;
    Ok(app_dir.join(configured_folder).join("msedgewebview2.exe"))
}

/// Reject a reparse-point escape: callers must canonicalize the executable,
/// runtime directory and browser image separately before calling this function.
/// A textual path under the app directory is not enough for a firewall rule.
pub(super) fn validate_canonical_layout(
    app_exe: &Path,
    configured_folder: &Path,
    runtime_dir: &Path,
    browser_image: &Path,
) -> Result<(), String> {
    let expected = expected_browser_image(app_exe, configured_folder)?;
    if runtime_dir != expected.parent().unwrap() || browser_image != expected {
        return Err("Fixed WebView2 runtime resolves outside the private AMS directory".into());
    }
    Ok(())
}

/// Check *canonical* image paths returned by the OS, not process names or PIDs
/// alone. In particular, a PID enumerated once is not a firewall identity:
/// WebView2 can start replacement processes after the enumeration.
pub(super) fn validate_browser_images(
    expected_image: &Path,
    browser_pid: u32,
    process_images: &[(u32, PathBuf)],
) -> Result<(), String> {
    if browser_pid == 0
        || process_images.is_empty()
        || !process_images.iter().any(|(pid, _)| *pid == browser_pid)
    {
        return Err("Cannot verify the WebView2 browser process image".into());
    }
    if process_images
        .iter()
        .any(|(_, image)| image != expected_image)
    {
        return Err("WebView2 process image differs from the selected private runtime".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retained_image_handle_prevents_replacement_until_released() {
        let name = format!(
            "ams-private-image-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let directory = std::env::temp_dir().join(name);
        std::fs::create_dir(&directory).unwrap();
        let image = directory.join("msedgewebview2.exe");
        let replacement = directory.join("replacement.exe");
        std::fs::write(&image, b"fixture, never executed").unwrap();
        let file = pin(&image, false).unwrap();
        assert!(std::fs::write(&image, b"replacement").is_err());
        assert!(std::fs::rename(&image, &replacement).is_err());
        drop(file);
        std::fs::rename(&image, &replacement).unwrap();
        std::fs::remove_file(replacement).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn accepts_only_a_direct_private_folder() {
        let app = Path::new(r"C:\Program Files\AMS Access\ams-access.exe");
        let expected = Path::new(r"C:\Program Files\AMS Access\fixed-webview2\msedgewebview2.exe");
        assert_eq!(
            expected_browser_image(app, Path::new("fixed-webview2")).unwrap(),
            expected
        );
        for folder in [
            ".",
            "..",
            r"..\Edge",
            r"C:\Program Files\Microsoft\EdgeWebView\Application",
            r"fixed-webview2\subfolder",
        ] {
            assert!(
                expected_browser_image(app, Path::new(folder)).is_err(),
                "{folder}"
            );
        }
    }

    #[test]
    fn rejects_mixed_shared_runtime_and_missing_browser() {
        let private =
            PathBuf::from(r"C:\Program Files\AMS Access\fixed-webview2\msedgewebview2.exe");
        let shared = PathBuf::from(
            r"C:\Program Files (x86)\Microsoft\EdgeWebView\Application\msedgewebview2.exe",
        );
        assert!(validate_browser_images(
            &private,
            10,
            &[(10, private.clone()), (11, private.clone())]
        )
        .is_ok());
        assert!(
            validate_browser_images(&private, 10, &[(10, private.clone()), (11, shared)]).is_err()
        );
        assert!(validate_browser_images(&private, 10, &[(11, private.clone())]).is_err());
        assert!(validate_browser_images(&private, 0, &[(10, private.clone())]).is_err());
    }

    #[test]
    fn rejects_runtime_directory_reparse_escape() {
        let app = Path::new(r"C:\Program Files\AMS Access\ams-access.exe");
        let folder = Path::new("fixed-webview2");
        let expected = expected_browser_image(app, folder).unwrap();
        assert!(
            validate_canonical_layout(app, folder, expected.parent().unwrap(), &expected).is_ok()
        );
        let shared = Path::new(r"C:\Program Files (x86)\Microsoft\EdgeWebView\Application");
        assert!(
            validate_canonical_layout(app, folder, shared, &shared.join("msedgewebview2.exe"))
                .is_err()
        );
    }
}
