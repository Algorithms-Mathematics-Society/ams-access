use std::{
    fs::File,
    os::{
        fd::AsRawFd,
        unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt},
    },
    path::{Path, PathBuf},
};
const LOCK_EX: i32 = 2;
const LOCK_NB: i32 = 4;
const O_NOFOLLOW: i32 = 0x20000;
unsafe extern "C" {
    fn flock(fd: i32, operation: i32) -> i32;
}
fn uid() -> Result<u32, String> {
    std::fs::metadata("/proc/self")
        .map(|m| m.uid())
        .map_err(|e| e.to_string())
}
fn state_root() -> Result<PathBuf, String> {
    std::env::var_os("XDG_STATE_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .or_else(|| {
            std::env::var_os("HOME")
                .map(PathBuf::from)
                .map(|p| p.join(".local/state"))
        })
        .filter(|p| p.is_absolute())
        .ok_or("no absolute per-user state directory".into())
}
fn acquire_at(path: &Path) -> Result<File, String> {
    let dir = path.parent().ok_or("lock path has no parent")?;
    let state_parent = dir
        .parent()
        .ok_or("instance-lock directory has no parent")?;
    std::fs::create_dir_all(state_parent)
        .map_err(|error| format!("cannot create state directory hierarchy: {error}"))?;
    match std::fs::DirBuilder::new().mode(0o700).create(dir) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(e.to_string()),
    }
    let dm = std::fs::symlink_metadata(dir).map_err(|e| e.to_string())?;
    if !dm.is_dir() || dm.uid() != uid()? || dm.permissions().mode() & 0o077 != 0 {
        return Err("instance-lock directory is not private and owned by this user".into());
    }
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .mode(0o600)
        .custom_flags(O_NOFOLLOW)
        .open(path)
        .map_err(|e| e.to_string())?;
    let fm = file.metadata().map_err(|e| e.to_string())?;
    if !fm.is_file() || fm.uid() != uid()? || fm.permissions().mode() & 0o077 != 0 {
        return Err("instance lock is not a private owned file".into());
    }
    if unsafe { flock(file.as_raw_fd(), LOCK_EX | LOCK_NB) } != 0 {
        return Err(format!(
            "another AMS Access instance is already running: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(file)
}
pub fn acquire() -> Result<File, String> {
    acquire_at(&state_root()?.join("ams-access/instance.lock"))
}
#[cfg(test)]
mod tests {
    use super::*;
    fn p() -> PathBuf {
        std::env::temp_dir()
            .join(format!(
                "ams-instance-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ))
            .join("lock")
    }
    #[test]
    fn second_owner_rejected_then_reacquires() {
        let p = p();
        let a = acquire_at(&p).unwrap();
        assert!(acquire_at(&p).is_err());
        drop(a);
        assert!(acquire_at(&p).is_ok());
        std::fs::remove_dir_all(p.parent().unwrap()).unwrap();
    }
    #[test]
    fn missing_nested_state_parents_are_created() {
        let root = p();
        let path = root
            .parent()
            .unwrap()
            .join("missing/state/ams-access/instance.lock");
        assert!(acquire_at(&path).is_ok());
        assert!(path.exists());
        std::fs::remove_dir_all(root.parent().unwrap()).unwrap();
    }

    #[test]
    fn symlink_and_public_lock_objects_are_rejected() {
        use std::os::unix::fs::symlink;
        let path = p();
        std::fs::DirBuilder::new()
            .mode(0o700)
            .create(path.parent().unwrap())
            .unwrap();
        let target = path.parent().unwrap().join("target");
        std::fs::write(&target, b"outside").unwrap();
        symlink(&target, &path).unwrap();
        assert!(acquire_at(&path).is_err());
        std::fs::remove_file(&path).unwrap();
        std::fs::write(&path, b"public").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(acquire_at(&path).is_err());
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn stale_file_is_reused_without_unlink() {
        let p = p();
        std::fs::DirBuilder::new()
            .mode(0o700)
            .create(p.parent().unwrap())
            .unwrap();
        std::fs::write(&p, b"stale").unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600)).unwrap();
        let before = std::fs::metadata(&p).unwrap().ino();
        let _g = acquire_at(&p).unwrap();
        assert_eq!(before, std::fs::metadata(&p).unwrap().ino());
        std::fs::remove_dir_all(p.parent().unwrap()).unwrap();
    }
}
