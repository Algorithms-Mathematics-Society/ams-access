//! Verified, offline Boost reference packs. The API only publishes a pack after
//! an operator supplies it; no placeholder catalog appears in candidate UI.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::{Read, Take},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        OnceLock,
    },
    time::Duration,
};
use tauri::Manager;

const MAX_FILE: usize = 8 * 1024 * 1024;
const MAX_PACK: u64 = 128 * 1024 * 1024;
const MAX_BLOCKS: usize = 32;
static CANCEL_EPOCH: AtomicU64 = AtomicU64::new(0);
static INSTALLING: AtomicBool = AtomicBool::new(false);
struct InstallGuard;
impl Drop for InstallGuard {
    fn drop(&mut self) {
        INSTALLING.store(false, Ordering::SeqCst);
    }
}
static HTTP: OnceLock<reqwest::Client> = OnceLock::new();

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct File {
    name: String,
    bytes: u64,
    sha256: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    schema: u32,
    release: String,
    title: String,
    index: File,
    blocks: Vec<File>,
}
#[derive(Deserialize)]
struct Index {
    codec: String,
    home: String,
    blocks: Vec<String>,
    files: std::collections::HashMap<String, [u64; 3]>,
}
#[derive(Serialize)]
pub(crate) struct PackStatus {
    available: bool,
    installed: bool,
    release: Option<String>,
    title: Option<String>,
    downloading: bool,
}

fn client() -> Result<&'static reqwest::Client, String> {
    if HTTP.get().is_none() {
        let c = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| e.to_string())?;
        let _ = HTTP.set(c);
    }
    HTTP.get()
        .ok_or_else(|| "Unable to initialize reference client".into())
}
fn api_origin(raw: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw).map_err(|_| "Invalid API origin")?;
    let prod = url.scheme() == "https"
        && url.host_str() == Some("api.amsaccess.com")
        && url.port().is_none();
    #[cfg(debug_assertions)]
    let dev = (url.scheme() == "http" || url.scheme() == "https")
        && matches!(url.host_str(), Some("localhost" | "127.0.0.1"))
        && url.port() == Some(8080);
    #[cfg(not(debug_assertions))]
    let dev = false;
    if !prod && !dev
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Unsupported reference API origin".into());
    }
    Ok(url)
}
fn valid_name(name: &str) -> bool {
    name == "index.json"
        || name
            .strip_prefix('b')
            .and_then(|v| v.strip_suffix(".br"))
            .is_some_and(|v| v.len() == 4 && v.bytes().all(|b| b.is_ascii_digit()))
}
fn valid_release(value: &str) -> bool {
    value
        .bytes()
        .next()
        .is_some_and(|b| b.is_ascii_alphanumeric())
        && value.len() <= 64
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
}
fn valid_sha(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit())
}
fn validate(manifest: &Manifest) -> Result<(), String> {
    if manifest.schema != 1
        || !valid_release(&manifest.release)
        || manifest.title.is_empty()
        || manifest.title.len() > 120
        || manifest.index.name != "index.json"
        || manifest.blocks.is_empty()
        || manifest.blocks.len() > MAX_BLOCKS
    {
        return Err("Invalid Boost pack manifest".into());
    }
    let mut names = HashSet::new();
    let mut total = 0u64;
    for file in std::iter::once(&manifest.index).chain(manifest.blocks.iter()) {
        if !valid_name(&file.name)
            || !names.insert(&file.name)
            || file.bytes == 0
            || file.bytes > MAX_FILE as u64
            || !valid_sha(&file.sha256)
        {
            return Err("Invalid Boost pack asset".into());
        }
        total = total
            .checked_add(file.bytes)
            .ok_or("Boost pack too large")?;
    }
    if total > MAX_PACK {
        return Err("Boost pack exceeds 128 MiB".into());
    }
    Ok(())
}
fn validate_index(raw: &[u8], manifest: &Manifest) -> Result<(), String> {
    let index: Index = serde_json::from_slice(raw).map_err(|_| "Invalid Boost index")?;
    if index.codec != "brotli"
        || index.blocks
            != manifest
                .blocks
                .iter()
                .map(|f| f.name.clone())
                .collect::<Vec<_>>()
        || !index.files.contains_key(&index.home)
        || index.files.is_empty()
        || index.files.len() > 100_000
    {
        return Err("Invalid Boost index shape".into());
    }
    for (path, [block, offset, length]) in &index.files {
        if !path.starts_with("boost/")
            || !path.ends_with(".html")
            || path.contains("..")
            || path.contains('\\')
            || path.chars().any(char::is_control)
            || *length == 0
            || *length > MAX_FILE as u64
            || offset.checked_add(*length).is_none()
            || (*block as usize) >= index.blocks.len()
        {
            return Err("Invalid Boost article entry".into());
        }
    }
    Ok(())
}
fn validate_ranges(raw: &[u8], lengths: &[usize]) -> Result<(), String> {
    let index: Index = serde_json::from_slice(raw).map_err(|_| "Invalid Boost index")?;
    for [block, offset, length] in index.files.values() {
        let size = lengths.get(*block as usize).ok_or("Missing Boost block")?;
        if offset
            .checked_add(*length)
            .is_none_or(|end| end > *size as u64)
        {
            return Err("Boost article exceeds its block".into());
        }
    }
    Ok(())
}
fn base(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.join("boost-reference"))
        .map_err(|e| e.to_string())
}
fn active(base: &Path) -> Result<Option<Manifest>, String> {
    let pointer = match fs::read_to_string(base.join("active")) {
        Ok(v) => v,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    if !valid_release(pointer.trim()) {
        return Err("Invalid installed Boost pack".into());
    }
    let raw =
        fs::read(base.join(pointer.trim()).join("manifest.json")).map_err(|e| e.to_string())?;
    let manifest: Manifest =
        serde_json::from_slice(&raw).map_err(|_| "Invalid installed Boost manifest")?;
    validate(&manifest)?;
    if manifest.release != pointer.trim() {
        return Err("Installed Boost release mismatch".into());
    }
    Ok(Some(manifest))
}
fn verified_active(base: &Path) -> Option<Manifest> {
    let manifest = active(base).ok().flatten()?;
    for file in std::iter::once(&manifest.index).chain(manifest.blocks.iter()) {
        if checked_read(&base.join(&manifest.release).join(&file.name), file).is_err() {
            return None;
        }
    }
    Some(manifest)
}
fn prune_cache(root: &Path, keep: &str) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let safe = valid_release(&name) || name.strip_prefix(".stage-").is_some_and(valid_release);
        if name != keep && safe && entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}
fn checked_read(path: &Path, file: &File) -> Result<Vec<u8>, String> {
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !meta.file_type().is_file() || meta.len() != file.bytes {
        return Err("Boost asset size mismatch".into());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    if hex::encode(Sha256::digest(&bytes)) != file.sha256.to_ascii_lowercase() {
        return Err("Boost asset checksum mismatch".into());
    }
    Ok(bytes)
}
fn decode(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut reader: Take<_> =
        brotli::Decompressor::new(bytes, 16 * 1024).take((MAX_FILE + 1) as u64);
    let mut out = Vec::new();
    reader.read_to_end(&mut out).map_err(|e| e.to_string())?;
    if out.len() > MAX_FILE {
        return Err("Boost block exceeds 8 MiB".into());
    }
    Ok(out)
}
async fn fetch_limited(url: reqwest::Url, max: usize) -> Result<Option<Vec<u8>>, String> {
    let mut response = client()?.get(url).send().await.map_err(|e| e.to_string())?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(format!("Reference API returned {}", response.status()));
    }
    if response.content_length().is_some_and(|n| n > max as u64) {
        return Err("Boost response too large".into());
    }
    let mut out = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if out.len().saturating_add(chunk.len()) > max {
            return Err("Boost response too large".into());
        }
        out.extend_from_slice(&chunk);
    }
    Ok(Some(out))
}
fn asset_url(api: &reqwest::Url, release: &str, name: &str) -> Result<reqwest::Url, String> {
    api.join(&format!("reference-packs/boost/{release}/{name}"))
        .map_err(|e| e.to_string())
}
async fn published(api_url: &str) -> Result<Option<Manifest>, String> {
    let api = api_origin(api_url)?;
    let bytes = match fetch_limited(
        api.join("reference-packs/boost/latest")
            .map_err(|e| e.to_string())?,
        64 * 1024,
    )
    .await?
    {
        Some(v) => v,
        None => return Ok(None),
    };
    let manifest: Manifest =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid published Boost manifest")?;
    validate(&manifest)?;
    Ok(Some(manifest))
}
#[tauri::command]
pub(crate) async fn boost_reference_status(
    app: tauri::AppHandle,
    api_url: String,
) -> Result<PackStatus, String> {
    let root = base(&app)?;
    let installed = tauri::async_runtime::spawn_blocking(move || verified_active(&root))
        .await
        .map_err(|e| e.to_string())?;
    let published = published(&api_url).await?;
    Ok(PackStatus {
        available: published.is_some(),
        installed: published
            .as_ref()
            .is_some_and(|p| installed.as_ref().is_some_and(|i| i.release == p.release))
            || published.is_none() && installed.is_some(),
        release: published
            .as_ref()
            .or(installed.as_ref())
            .map(|v| v.release.clone()),
        title: published
            .as_ref()
            .or(installed.as_ref())
            .map(|v| v.title.clone()),
        downloading: INSTALLING.load(Ordering::SeqCst),
    })
}
#[tauri::command]
pub(crate) async fn boost_reference_local_status(
    app: tauri::AppHandle,
) -> Result<PackStatus, String> {
    let root = base(&app)?;
    let installed = tauri::async_runtime::spawn_blocking(move || verified_active(&root))
        .await
        .map_err(|e| e.to_string())?;
    Ok(PackStatus {
        available: installed.is_some(),
        installed: installed.is_some(),
        release: installed.as_ref().map(|v| v.release.clone()),
        title: installed.as_ref().map(|v| v.title.clone()),
        downloading: INSTALLING.load(Ordering::SeqCst),
    })
}
#[tauri::command]
pub(crate) fn cancel_boost_reference_download() {
    CANCEL_EPOCH.fetch_add(1, Ordering::SeqCst);
}
#[tauri::command]
pub(crate) async fn install_boost_reference(
    app: tauri::AppHandle,
    api_url: String,
) -> Result<PackStatus, String> {
    if INSTALLING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("Boost download is already running".into());
    }
    let _guard = InstallGuard;
    let epoch = CANCEL_EPOCH.load(Ordering::SeqCst);
    let manifest = published(&api_url)
        .await?
        .ok_or("No Boost pack is published")?;
    let api = api_origin(&api_url)?;
    let root = base(&app)?;
    if verified_active(&root).is_some_and(|m| m.release == manifest.release) {
        return Ok(PackStatus {
            available: true,
            installed: true,
            release: Some(manifest.release),
            title: Some(manifest.title),
            downloading: false,
        });
    }
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    if let Ok(Some(old)) = active(&root) {
        prune_cache(&root, &old.release);
    }
    let stage = root.join(format!(".stage-{}", manifest.release));
    let _ = fs::remove_dir_all(&stage);
    fs::create_dir(&stage).map_err(|e| e.to_string())?;
    let result = async {
        let mut index_bytes = Vec::new();
        let mut decoded_lengths = Vec::new();
        for file in std::iter::once(&manifest.index).chain(manifest.blocks.iter()) {
            if CANCEL_EPOCH.load(Ordering::SeqCst) != epoch {
                return Err("Boost download cancelled".into());
            }
            let bytes = fetch_limited(asset_url(&api, &manifest.release, &file.name)?, MAX_FILE)
                .await?
                .ok_or("Published Boost asset missing")?;
            if bytes.len() as u64 != file.bytes
                || hex::encode(Sha256::digest(&bytes)) != file.sha256.to_ascii_lowercase()
            {
                return Err("Published Boost asset checksum mismatch".into());
            }
            if file.name == "index.json" {
                validate_index(&bytes, &manifest)?;
                index_bytes = bytes.clone();
            } else {
                decoded_lengths.push(decode(&bytes)?.len());
            }
            fs::write(stage.join(&file.name), bytes).map_err(|e| e.to_string())?;
        }
        if CANCEL_EPOCH.load(Ordering::SeqCst) != epoch {
            return Err("Boost download cancelled".into());
        }
        validate_ranges(&index_bytes, &decoded_lengths)?;
        fs::write(
            stage.join("manifest.json"),
            serde_json::to_vec(&manifest).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        let dest = root.join(&manifest.release);
        if dest.exists() {
            fs::remove_dir_all(&dest).map_err(|e| e.to_string())?;
        }
        fs::rename(&stage, &dest).map_err(|e| e.to_string())?;
        let pointer = root.join("active.new");
        fs::write(&pointer, &manifest.release).map_err(|e| e.to_string())?;
        fs::rename(&pointer, root.join("active")).map_err(|e| e.to_string())?;
        prune_cache(&root, &manifest.release);
        Ok(PackStatus {
            available: true,
            installed: true,
            release: Some(manifest.release.clone()),
            title: Some(manifest.title.clone()),
            downloading: false,
        })
    }
    .await;
    if result.is_err() {
        let _ = fs::remove_dir_all(&stage);
    }
    result
}
#[tauri::command]
pub(crate) async fn read_boost_reference_asset(
    app: tauri::AppHandle,
    name: String,
    release: String,
) -> Result<tauri::ipc::Response, String> {
    if !valid_name(&name) {
        return Err("Unsupported Boost asset".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let root = base(&app)?;
        let manifest = active(&root)?.ok_or("Boost reference is not installed")?;
        if manifest.release != release {
            return Err("Boost reference changed; reopen the reference panel".into());
        }
        let file = std::iter::once(&manifest.index)
            .chain(manifest.blocks.iter())
            .find(|f| f.name == name)
            .ok_or("Boost asset not in manifest")?;
        let bytes = checked_read(&root.join(&manifest.release).join(&name), file)?;
        if name == "index.json" {
            validate_index(&bytes, &manifest)?;
            Ok(tauri::ipc::Response::new(bytes))
        } else {
            Ok(tauri::ipc::Response::new(decode(&bytes)?))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_paths_and_bad_manifests() {
        assert!(!valid_name("../b0000.br"));
        assert!(!valid_name("b0000.br/../x"));
        assert!(!valid_release("../escape"));
        let m = Manifest {
            schema: 1,
            release: "v1".into(),
            title: "Boost".into(),
            index: File {
                name: "index.json".into(),
                bytes: 5,
                sha256: "a".repeat(64),
            },
            blocks: vec![File {
                name: "b0000.br".into(),
                bytes: 5,
                sha256: "b".repeat(64),
            }],
        };
        assert!(validate(&m).is_ok());
        let mut bad = m.clone();
        bad.blocks[0].name = "../evil".into();
        assert!(validate(&bad).is_err());
    }
    #[test]
    fn pins_api_origin_and_release_slug() {
        assert!(api_origin("https://api.amsaccess.com").is_ok());
        assert!(api_origin("https://api.amsaccess.com.evil.test").is_err());
        assert!(api_origin("https://api.amsaccess.com/other").is_err());
        assert!(api_origin("https://user@api.amsaccess.com").is_err());
        assert!(!valid_release(".."));
        assert!(!valid_release(".stage-v1"));
        assert!(valid_release("boost-1.2"));
    }
    #[test]
    fn verified_pack_rejects_corruption_without_switching_pointer() {
        use std::io::Write;
        let root = std::env::temp_dir().join(format!(
            "ams-boost-test-{}-{}",
            std::process::id(),
            CANCEL_EPOCH.fetch_add(1, Ordering::SeqCst)
        ));
        let release = root.join("fixture-v1");
        fs::create_dir_all(&release).unwrap();
        let page = b"<h1>Boost fixture</h1>";
        let mut compressed = Vec::new();
        {
            let mut writer = brotli::CompressorWriter::new(&mut compressed, 4096, 5, 22);
            writer.write_all(page).unwrap();
        }
        let index = serde_json::json!({"codec":"brotli","home":"boost/index.html","blocks":["b0000.br"],"files":{"boost/index.html":[0,0,page.len()]}}).to_string().into_bytes();
        let m = Manifest {
            schema: 1,
            release: "fixture-v1".into(),
            title: "Boost fixture".into(),
            index: File {
                name: "index.json".into(),
                bytes: index.len() as u64,
                sha256: hex::encode(Sha256::digest(&index)),
            },
            blocks: vec![File {
                name: "b0000.br".into(),
                bytes: compressed.len() as u64,
                sha256: hex::encode(Sha256::digest(&compressed)),
            }],
        };
        fs::write(release.join("index.json"), &index).unwrap();
        fs::write(release.join("b0000.br"), &compressed).unwrap();
        fs::write(
            release.join("manifest.json"),
            serde_json::to_vec(&m).unwrap(),
        )
        .unwrap();
        fs::write(root.join("active"), "fixture-v1").unwrap();
        assert_eq!(verified_active(&root).unwrap().release, "fixture-v1");
        fs::write(release.join("b0000.br"), b"corrupt").unwrap();
        assert!(verified_active(&root).is_none());
        assert_eq!(
            fs::read_to_string(root.join("active")).unwrap(),
            "fixture-v1"
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn validates_index_entries() {
        let m = Manifest {
            schema: 1,
            release: "v1".into(),
            title: "Boost".into(),
            index: File {
                name: "index.json".into(),
                bytes: 5,
                sha256: "a".repeat(64),
            },
            blocks: vec![File {
                name: "b0000.br".into(),
                bytes: 5,
                sha256: "b".repeat(64),
            }],
        };
        let ok = br#"{"codec":"brotli","home":"boost/index.html","blocks":["b0000.br"],"files":{"boost/index.html":[0,0,5]}}"#;
        assert!(validate_index(ok, &m).is_ok());
        assert!(validate_ranges(ok, &[5]).is_ok());
        assert!(validate_ranges(ok, &[4]).is_err());
        let invalid_range = br#"{"codec":"brotli","home":"boost/index.html","blocks":["b0000.br"],"files":{"boost/index.html":[0,999999,10]}}"#;
        assert!(validate_index(invalid_range, &m).is_ok());
        assert!(validate_ranges(invalid_range, &[20]).is_err());
        let bad = br#"{"codec":"brotli","home":"boost/../evil.html","blocks":["b0000.br"],"files":{"boost/../evil.html":[0,0,5]}}"#;
        assert!(validate_index(bad, &m).is_err());
    }
}
