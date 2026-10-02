//! Durable, session-bound event spool. Legacy/unbound files are preserved but
//! never guessed to belong to the next session. Network payloads and event
//! hashes are unchanged; the local envelope is removed before upload.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const MAX_EVENT_BYTES: usize = 256 * 1024;
pub const MAX_BATCH_BYTES: usize = 1024 * 1024;
const MAX_CHECKPOINT_BYTES: u64 = 4096;

#[derive(Clone, Debug, Eq, PartialEq, Hash)]
pub struct SessionBinding {
    key: String,
}

impl SessionBinding {
    pub fn new(api_url: &str, session_id: &str) -> io::Result<Self> {
        let origin = api_url.trim().trim_end_matches('/');
        let session = session_id.trim();
        if origin.is_empty() || session.is_empty() {
            return Err(invalid("event binding requires an origin and session"));
        }
        // Length delimiters prevent ambiguous concatenation; identifiers never
        // become filesystem paths and no bearer token is persisted.
        let mut hash = Sha256::new();
        hash.update((origin.len() as u64).to_le_bytes());
        hash.update(origin.as_bytes());
        hash.update(session.as_bytes());
        Ok(Self {
            key: hex::encode(hash.finalize()),
        })
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EventStream {
    Violation,
    Proctoring,
}

#[derive(Serialize, Deserialize)]
struct Envelope {
    stream: EventStream,
    event: Value,
}

/// Validate required wire types without normalizing values or repairing hashes.
/// A syntactically valid JSON object can otherwise poison the HTTP queue.
fn valid_event(event: &Value, stream: EventStream) -> bool {
    let Some(object) = event.as_object() else {
        return false;
    };
    object.get("kind").is_some_and(Value::is_string)
        && object.get("detail").is_some_and(Value::is_string)
        && object.get("ts").is_some_and(Value::is_u64)
        && object.get("seq").is_none_or(Value::is_u64)
        && object.get("hash").is_none_or(Value::is_string)
        && object.get("prev_hash").is_none_or(Value::is_string)
        && (!matches!(stream, EventStream::Proctoring) || object.contains_key("payload"))
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct Checkpoint {
    offset: u64,
    // Ties a checkpoint to the exact bytes acknowledged, detecting truncation
    // or replacement rather than silently skipping new contents at old offsets.
    #[serde(default)]
    last_line_hash: String,
    #[serde(default)]
    last_line_start: u64,
    #[serde(default)]
    discarding_oversized_line: bool,
}

#[derive(Debug)]
pub struct UploadBatch {
    pub events: Vec<Value>,
    /// Encoded once on the blocking reader, reused verbatim by the uploader.
    pub body: Vec<u8>,
    pub notices: Vec<String>,
    path: PathBuf,
    binding: SessionBinding,
    start_offset: u64,
    checkpoint: Checkpoint,
}

pub struct EventStore {
    root: PathBuf,
    run_key: String,
    // A partial append must be detected before a later append; in-process
    // writers also cannot interleave JSON lines.
    io_lock: Mutex<Option<AppendPublication>>,
}

// Keep the published inode and directory alive while cached. Holding their
// handles prevents inode-number reuse after unlink/replacement from making a
// different file appear to be the same already-synced directory entry.
#[cfg(unix)]
struct AppendPublication {
    path: PathBuf,
    identity: (u64, u64, u64, u64),
    _file: File,
    directory: File,
}
#[cfg(not(unix))]
type AppendPublication = ();

impl EventStore {
    pub fn new(root: PathBuf, run_id: &str) -> Self {
        Self {
            root: root.join("bound-events-v1"),
            run_key: hex::encode(Sha256::digest(run_id.as_bytes())),
            io_lock: Mutex::new(None),
        }
    }

    fn directory(&self, binding: Option<&SessionBinding>) -> PathBuf {
        self.root
            .join(binding.map_or("unbound", |b| b.key.as_str()))
    }

    pub fn append<T: Serialize>(
        &self,
        binding: Option<&SessionBinding>,
        stream: EventStream,
        entry: &T,
    ) -> io::Result<usize> {
        let mut guard = self
            .io_lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        // Any error invalidates publication knowledge. We still open the path
        // and inspect the actual tail every time, including after external
        // edits, truncation, or a partial previous write.
        let previous = guard.take();
        #[cfg(not(unix))]
        let _ = previous;
        let event = serde_json::to_value(entry).map_err(invalid)?;
        if !valid_event(&event, stream) {
            return Err(invalid(
                "event is missing required audit fields or has invalid wire types",
            ));
        }
        let mut line = serde_json::to_vec(&Envelope { stream, event }).map_err(invalid)?;
        line.push(b'\n');
        if line.len() > MAX_EVENT_BYTES {
            return Err(invalid("event exceeds local spool size limit"));
        }
        let directory = self.directory(binding);
        let directory_metadata = private_directory(&directory)?;
        #[cfg(not(unix))]
        let _ = directory_metadata;
        let path = directory.join(format!("{}.jsonl", self.run_key));
        let reopened = match fs::remove_file(path.with_extension("closed")) {
            Ok(()) => true,
            Err(error) if error.kind() == io::ErrorKind::NotFound => false,
            Err(error) => return Err(error),
        };
        #[cfg(not(unix))]
        let _ = reopened;
        let mut options = private_options();
        options.create(true).read(true).append(true);
        let mut file = options.open(&path)?;
        let metadata = file.metadata()?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if metadata.permissions().mode() & 0o777 != 0o600 {
                file.set_permissions(fs::Permissions::from_mode(0o600))?;
            }
        }
        let length = metadata.len();
        if length > 0 {
            file.seek(SeekFrom::End(-1))?;
            let mut last = [0];
            file.read_exact(&mut last)?;
            if last[0] != b'\n' {
                // Preserve the incomplete bytes, but delimit them so a failed
                // write cannot poison every later append in this process.
                // The reader quarantines malformed content before advancing.
                file.write_all(b"\n")?;
                file.sync_data()?;
            }
        }
        file.write_all(&line)?;
        file.sync_data()?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            let identity = (
                metadata.dev(),
                metadata.ino(),
                directory_metadata.dev(),
                directory_metadata.ino(),
            );
            let existing = previous
                .filter(|entry| entry.path == path && entry.identity == identity && !reopened);
            let directory_handle = if let Some(entry) = existing {
                entry.directory
            } else {
                let directory_handle = File::open(&directory)?;
                directory_handle.sync_all()?;
                directory_handle
            };
            *guard = Some(AppendPublication {
                path,
                identity,
                _file: file,
                directory: directory_handle,
            });
        }
        Ok(line.len())
    }

    /// Returns a bounded batch from one run of this session, including previous
    /// app runs. A batch retains its immutable destination even if UI config
    /// changes while the HTTP request is in flight.
    pub fn next_batch(
        &self,
        binding: &SessionBinding,
        max_events: usize,
        max_bytes: usize,
    ) -> io::Result<Option<UploadBatch>> {
        if max_events == 0 || max_bytes == 0 {
            return Err(invalid("batch limits must be positive"));
        }
        let max_bytes = max_bytes.min(MAX_BATCH_BYTES);
        let _guard = self
            .io_lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let directory = self.directory(Some(binding));
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(err) => return Err(err),
        };
        // Do not accumulate a list of every historical file in memory.
        for entry in entries {
            let path = entry?.path();
            if path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
                continue;
            }
            let mut notices = Vec::new();
            let checkpoint = recover_checkpoint(&path, &mut notices)?;
            let mut file = File::open(&path)?;
            file.seek(SeekFrom::Start(checkpoint.offset))?;
            let mut reader = BufReader::new(file);
            let mut next = checkpoint.clone();
            let mut events = Vec::new();
            let mut body = b"{\"events\":[".to_vec();
            let mut bytes = 0;
            let mut scanned = 0;
            while events.len() < max_events.min(200) && scanned < 4 * MAX_BATCH_BYTES {
                let mut line = Vec::new();
                reader
                    .by_ref()
                    .take(MAX_EVENT_BYTES as u64)
                    .read_until(b'\n', &mut line)?;
                if line.is_empty() {
                    break;
                }
                scanned += line.len();
                let oversized = next.discarding_oversized_line
                    || (line.len() == MAX_EVENT_BYTES && !line.ends_with(b"\n"));
                if !oversized && !line.ends_with(b"\n") {
                    break; // Incomplete tail stays pending until delimited by append.
                }
                let decoded = if oversized {
                    None
                } else {
                    serde_json::from_slice::<Envelope>(&line).ok()
                };
                let event = match decoded {
                    Some(envelope) if valid_event(&envelope.event, envelope.stream) => {
                        let mut event = envelope.event;
                        event.as_object_mut().expect("object checked").insert(
                            "stream".into(),
                            serde_json::to_value(envelope.stream).map_err(invalid)?,
                        );
                        event
                    }
                    _ => {
                        let reason = if oversized {
                            "oversized event fragment"
                        } else {
                            "malformed event"
                        };
                        quarantine_fragment(&path, next.offset, &line, reason)?;
                        if notices.len() < 8 {
                            notices.push(format!("spool_corruption: {reason} at byte {}; original bytes preserved; hash-chain gap is explicit", next.offset));
                        }
                        next.last_line_start = next.offset;
                        next.offset += line.len() as u64;
                        next.last_line_hash = hex::encode(Sha256::digest(&line));
                        next.discarding_oversized_line = oversized && !line.ends_with(b"\n");
                        continue;
                    }
                };
                let before = body.len();
                if !events.is_empty() {
                    body.push(b',');
                }
                serde_json::to_writer(&mut body, &event).map_err(invalid)?;
                let wire_bytes = body.len() - before + usize::from(events.is_empty());
                if bytes + wire_bytes > max_bytes {
                    body.truncate(before);
                    if events.is_empty() {
                        return Err(invalid("batch byte limit is smaller than pending event"));
                    }
                    break;
                }
                next.last_line_start = next.offset;
                next.offset += line.len() as u64;
                next.last_line_hash = hex::encode(Sha256::digest(&line));
                bytes += wire_bytes;
                events.push(event);
            }
            if !events.is_empty() || next.offset != checkpoint.offset || !notices.is_empty() {
                body.extend_from_slice(b"]}");
                return Ok(Some(UploadBatch {
                    events,
                    body,
                    notices,
                    path,
                    binding: binding.clone(),
                    start_offset: checkpoint.offset,
                    checkpoint: next,
                }));
            }
        }
        Ok(None)
    }

    /// Bounded diagnostic history only (never an upload cursor): inspect at
    /// most 32 recent run files and 4 MiB total, retaining at most 1,000 events.
    /// `None` means pre-session history, not every participant's history.
    pub fn recent_history(
        &self,
        binding: Option<&SessionBinding>,
        max: usize,
    ) -> io::Result<Vec<Value>> {
        let _guard = self
            .io_lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let limit = max.min(1000);
        if limit == 0 {
            return Ok(Vec::new());
        }
        let entries = match fs::read_dir(self.directory(binding)) {
            Ok(entries) => entries,
            Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(err) => return Err(err),
        };
        let mut paths = Vec::new();
        for entry in entries {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
                continue;
            }
            let modified = entry.metadata()?.modified()?;
            paths.push((modified, path));
            paths.sort_by_key(|entry| std::cmp::Reverse(entry.0));
            paths.truncate(32);
        }
        let mut remaining_bytes = 4 * MAX_BATCH_BYTES;
        let mut events = std::collections::VecDeque::new();
        // Most recently written files first; reverse records within each file.
        for (_, path) in paths {
            if events.len() >= limit || remaining_bytes == 0 {
                break;
            }
            let mut file = File::open(path)?;
            let length = file.metadata()?.len();
            let take = length.min(remaining_bytes.min(MAX_BATCH_BYTES) as u64);
            let start = length - take;
            file.seek(SeekFrom::Start(start))?;
            let mut bytes = Vec::with_capacity(take as usize);
            file.take(take).read_to_end(&mut bytes)?;
            remaining_bytes -= bytes.len();
            let first = if start > 0 {
                bytes
                    .iter()
                    .position(|b| *b == b'\n')
                    .map_or(bytes.len(), |i| i + 1)
            } else {
                0
            };
            let Some(last) = bytes.iter().rposition(|b| *b == b'\n') else {
                continue;
            };
            if first > last {
                continue;
            }
            for line in bytes[first..=last].split_inclusive(|b| *b == b'\n').rev() {
                if events.len() >= limit {
                    break;
                }
                let Ok(envelope) = serde_json::from_slice::<Envelope>(line) else {
                    continue;
                };
                if !valid_event(&envelope.event, envelope.stream) {
                    continue;
                }
                let mut event = envelope.event;
                let Some(object) = event.as_object_mut() else {
                    continue;
                };
                object.insert(
                    "stream".into(),
                    serde_json::to_value(envelope.stream).map_err(invalid)?,
                );
                events.push_front(event);
            }
        }
        Ok(events.into_iter().collect())
    }

    /// Explicitly close this run on session disarm; append reopens it.
    pub fn close_binding(&self, binding: &SessionBinding) -> io::Result<()> {
        let mut guard = self
            .io_lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *guard = None;
        let path = self
            .directory(Some(binding))
            .join(format!("{}.jsonl", self.run_key));
        if !path.exists() {
            return Ok(());
        }
        let mut options = private_options();
        options.create(true).truncate(true).write(true);
        let mut marker = options.open(path.with_extension("closed"))?;
        marker.write_all(b"closed after local session disarm\n")?;
        marker.sync_all()?;
        sync_directory(path.parent().expect("run parent"))
    }

    /// Thirty-day local diagnostics retention. Only fully acknowledged runs
    /// from prior app processes qualify; any quarantine evidence protects the
    /// entire run. Active/unbound/legacy/unacknowledged data are never deleted.
    pub fn cleanup_acknowledged(&self, now: std::time::SystemTime) -> io::Result<usize> {
        let _guard = self
            .io_lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let roots = match fs::read_dir(&self.root) {
            Ok(roots) => roots,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(0),
            Err(error) => return Err(error),
        };
        let mut removed = 0;
        for root in roots {
            let root = root?;
            if root.file_name() == "unbound" || !root.file_type()?.is_dir() {
                continue;
            }
            for entry in fs::read_dir(root.path())? {
                let path = entry?.path();
                if path.extension().and_then(|s| s.to_str()) != Some("jsonl")
                    || path.file_stem().and_then(|s| s.to_str()) == Some(&self.run_key)
                    || path.with_extension("quarantine").exists()
                    || !path.with_extension("closed").is_file()
                {
                    continue;
                }
                let metadata = fs::metadata(&path)?;
                if now.duration_since(metadata.modified()?).unwrap_or_default()
                    < std::time::Duration::from_secs(30 * 24 * 60 * 60)
                {
                    continue;
                }
                let Ok(checkpoint) = read_checkpoint(&path) else {
                    continue;
                };
                if checkpoint.offset != metadata.len() || checkpoint.discarding_oversized_line {
                    continue;
                }
                if validate_checkpoint(&mut File::open(&path)?, &checkpoint).is_err() {
                    continue;
                }
                fs::remove_file(&path)?;
                // Removing the acknowledged spool first is crash-safe: a stray
                // checkpoint is ignored, whereas removing it first could replay.
                match fs::remove_file(path.with_extension("checkpoint.json")) {
                    Ok(()) => {}
                    Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                    Err(error) => return Err(error),
                }
                fs::remove_file(path.with_extension("closed"))?;
                sync_directory(path.parent().expect("spool parent"))?;
                removed += 1;
                if removed == 64 {
                    return Ok(removed);
                }
            }
        }
        Ok(removed)
    }

    /// Call only after the exact returned batch received a successful HTTP
    /// response. This is at-least-once delivery: a crash before acknowledgment
    /// can replay events; server-side identity handles any deduplication.
    pub fn acknowledge(&self, binding: &SessionBinding, batch: &UploadBatch) -> io::Result<()> {
        let _guard = self
            .io_lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if binding != &batch.binding
            || batch.path.parent() != Some(self.directory(Some(binding)).as_path())
        {
            return Err(invalid("batch belongs to another session or event store"));
        }
        let current = read_checkpoint(&batch.path)?;
        if current.offset == batch.checkpoint.offset
            && current.last_line_hash == batch.checkpoint.last_line_hash
        {
            return Ok(()); // Safe repeated acknowledgment.
        }
        if current.offset != batch.start_offset {
            return Err(invalid("stale event batch acknowledgment"));
        }
        validate_checkpoint(&mut File::open(&batch.path)?, &batch.checkpoint)?;
        write_checkpoint(&batch.path, &batch.checkpoint)
    }
}

/// Prefer full event identity, including hash/sequence, over timestamp + kind:
/// distinct same-millisecond incidents must not collapse in diagnostics.
pub fn event_identity<T: Serialize>(entry: &T) -> io::Result<String> {
    let value = serde_json::to_value(entry).map_err(invalid)?;
    Ok(hex::encode(Sha256::digest(
        serde_json::to_vec(&value).map_err(invalid)?,
    )))
}

fn write_checkpoint(path: &Path, checkpoint: &Checkpoint) -> io::Result<()> {
    let checkpoint_path = path.with_extension("checkpoint.json");
    let temporary = path.with_extension("checkpoint.tmp");
    let mut options = private_options();
    options.create(true).write(true).truncate(true);
    let mut file = options.open(&temporary)?;
    tighten_permissions(&temporary)?;
    serde_json::to_writer(&mut file, checkpoint).map_err(invalid)?;
    file.sync_all()?;
    drop(file);
    fs::rename(&temporary, &checkpoint_path)?;
    sync_directory(checkpoint_path.parent().expect("checkpoint parent"))
}

fn quarantine_fragment(path: &Path, offset: u64, bytes: &[u8], reason: &str) -> io::Result<()> {
    let directory = path.with_extension("quarantine");
    private_directory(&directory)?;
    let evidence = directory.join(format!(
        "{offset}-{}.bin",
        hex::encode(Sha256::digest(bytes))
    ));
    let mut options = private_options();
    options.write(true).create(true).truncate(true);
    let mut file = options.open(evidence)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    let metadata = directory.join(format!("{offset}.json"));
    let mut file = options.open(metadata)?;
    serde_json::to_writer(&mut file, &serde_json::json!({"offset":offset,"bytes":bytes.len(),"reason":reason,"hash_chain_gap":true})).map_err(invalid)?;
    file.sync_all()?;
    sync_directory(&directory)?;
    sync_directory(path.parent().expect("spool parent"))
}

fn recover_checkpoint(path: &Path, notices: &mut Vec<String>) -> io::Result<Checkpoint> {
    let candidate = read_checkpoint(path).and_then(|checkpoint| {
        validate_checkpoint(&mut File::open(path)?, &checkpoint)?;
        Ok(checkpoint)
    });
    match candidate {
        Ok(checkpoint) => Ok(checkpoint),
        Err(error)
            if matches!(
                error.kind(),
                io::ErrorKind::InvalidData | io::ErrorKind::UnexpectedEof
            ) =>
        {
            let quarantine = path.with_extension("quarantine");
            private_directory(&quarantine)?;
            let checkpoint_path = path.with_extension("checkpoint.json");
            if checkpoint_path.exists() {
                let unique = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos();
                fs::rename(
                    &checkpoint_path,
                    quarantine.join(format!("checkpoint-{unique}.json")),
                )?;
                sync_directory(&quarantine)?;
            }
            let initial = Checkpoint::default();
            write_checkpoint(path, &initial)?;
            notices.push(format!("spool_checkpoint_replay: {error}; original checkpoint preserved; replaying this same session/run from byte zero"));
            Ok(initial)
        }
        Err(error) => Err(error),
    }
}

fn read_checkpoint(path: &Path) -> io::Result<Checkpoint> {
    let file = match File::open(path.with_extension("checkpoint.json")) {
        Ok(file) => file,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(Checkpoint::default()),
        Err(err) => return Err(err),
    };
    if file.metadata()?.len() > MAX_CHECKPOINT_BYTES {
        return Err(invalid("event checkpoint exceeds size limit"));
    }
    serde_json::from_reader(file.take(MAX_CHECKPOINT_BYTES + 1)).map_err(invalid)
}

fn validate_checkpoint(file: &mut File, checkpoint: &Checkpoint) -> io::Result<()> {
    if checkpoint.offset > file.metadata()?.len() {
        return Err(invalid("event spool was truncated below its checkpoint"));
    }
    if checkpoint.offset == 0 {
        if checkpoint.last_line_start != 0
            || !checkpoint.last_line_hash.is_empty()
            || checkpoint.discarding_oversized_line
        {
            return Err(invalid("nonempty state in an initial event checkpoint"));
        }
        return Ok(());
    }
    let length = checkpoint
        .offset
        .checked_sub(checkpoint.last_line_start)
        .filter(|n| *n > 0 && *n <= MAX_EVENT_BYTES as u64)
        .ok_or_else(|| invalid("invalid event checkpoint range"))?;
    file.seek(SeekFrom::Start(checkpoint.last_line_start))?;
    let mut line = vec![0; length as usize];
    file.read_exact(&mut line)?;
    if checkpoint.discarding_oversized_line == line.ends_with(b"\n")
        || hex::encode(Sha256::digest(&line)) != checkpoint.last_line_hash
    {
        return Err(invalid("event checkpoint does not match spool contents"));
    }
    Ok(())
}

fn invalid(message: impl std::fmt::Display) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.to_string())
}
fn private_options() -> OpenOptions {
    #[cfg(unix)]
    let options = {
        use std::os::unix::fs::OpenOptionsExt;
        let mut options = OpenOptions::new();
        options.mode(0o600);
        options
    };
    #[cfg(not(unix))]
    let options = OpenOptions::new();
    options
}
fn private_directory(path: &Path) -> io::Result<fs::Metadata> {
    // A synced file and leaf directory are insufficient when their ancestors
    // were just created: their names must also survive a power failure. Record
    // missing entries first, then publish them durably from the leaf upwards.
    let mut missing = Vec::new();
    let mut ancestor = path;
    let existing = loop {
        match fs::metadata(ancestor) {
            Ok(metadata) => break metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                missing.push(ancestor);
                ancestor = ancestor
                    .parent()
                    .filter(|parent| !parent.as_os_str().is_empty())
                    .unwrap_or_else(|| Path::new("."));
            }
            Err(error) => return Err(error),
        }
    };
    if missing.is_empty() {
        if !existing.is_dir() {
            return Err(invalid("event directory is not a directory"));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if existing.permissions().mode() & 0o777 != 0o700 {
                fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
            }
        }
        return Ok(existing);
    }
    fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    for created in missing {
        let parent = created
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        sync_directory(parent)?;
    }
    fs::metadata(path)
}
#[cfg(unix)]
fn tighten_permissions(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
}
#[cfg(not(unix))]
fn tighten_permissions(_: &Path) -> io::Result<()> {
    Ok(())
}
#[cfg(unix)]
fn sync_directory(path: &Path) -> io::Result<()> {
    File::open(path)?.sync_all()
}
#[cfg(not(unix))]
fn sync_directory(_: &Path) -> io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicU64, Ordering};
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            static ID: AtomicU64 = AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!(
                "ams-event-store-{}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                ID.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn store(&self, run: &str) -> EventStore {
            EventStore::new(self.0.clone(), run)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn binding(session: &str) -> SessionBinding {
        SessionBinding::new("https://exam.invalid", session).unwrap()
    }
    fn event(seq: u64) -> Value {
        json!({"kind":"focus", "ts": 7, "seq":seq,"detail":"example", "payload":null, "hash":format!("event-{seq}")})
    }
    fn pending(store: &EventStore, binding: &SessionBinding) -> UploadBatch {
        store
            .next_batch(binding, 200, MAX_BATCH_BYTES)
            .unwrap()
            .unwrap()
    }

    #[test]
    fn encoded_upload_body_matches_events_without_another_serialization_pass() {
        let fixture = Fixture::new();
        let store = fixture.store("run");
        let binding = binding("session");
        for seq in 0..3 {
            store
                .append(Some(&binding), EventStream::Violation, &event(seq))
                .unwrap();
        }
        let batch = pending(&store, &binding);
        let decoded: Value = serde_json::from_slice(&batch.body).unwrap();
        assert_eq!(decoded["events"], Value::Array(batch.events));
    }
    #[test]
    fn cached_append_detects_replaced_file_and_preserves_partial_tail() {
        let fixture = Fixture::new();
        let store = fixture.store("run");
        let binding = binding("session");
        store
            .append(Some(&binding), EventStream::Violation, &event(1))
            .unwrap();
        let batch = pending(&store, &binding);
        fs::remove_file(&batch.path).unwrap();
        fs::write(&batch.path, b"partial-corrupt-row").unwrap();
        store
            .append(Some(&binding), EventStream::Violation, &event(2))
            .unwrap();
        let next = pending(&store, &binding);
        assert_eq!(next.events.len(), 1);
        assert_eq!(next.events[0]["seq"], 2);
        assert!(!next.notices.is_empty());
        assert!(fs::read(&batch.path)
            .unwrap()
            .starts_with(b"partial-corrupt-row\n"));
    }
    #[test]
    fn session_origin_and_unbound_data_never_cross_destinations() {
        let fixture = Fixture::new();
        let store = fixture.store("run");
        let a = binding("a");
        let b = binding("b");
        let other_origin = SessionBinding::new("https://other.invalid", "a").unwrap();
        for (scope, seq) in [
            (None, 0),
            (Some(&a), 1),
            (Some(&b), 2),
            (Some(&other_origin), 3),
        ] {
            store
                .append(scope, EventStream::Violation, &event(seq))
                .unwrap();
        }
        assert_eq!(pending(&store, &a).events[0]["seq"], 1);
        assert_eq!(pending(&store, &b).events[0]["seq"], 2);
        assert_eq!(pending(&store, &other_origin).events[0]["seq"], 3);
        assert_eq!(store.recent_history(None, 5).unwrap()[0]["seq"], 0);
    }
    #[test]
    fn failed_delivery_retries_and_restart_resumes_only_acknowledged_bytes() {
        let fixture = Fixture::new();
        let a = binding("a");
        let store = fixture.store("first");
        store
            .append(Some(&a), EventStream::Violation, &event(1))
            .unwrap();
        let batch = pending(&store, &a);
        assert_eq!(pending(&store, &a).events, batch.events);
        store.acknowledge(&a, &batch).unwrap();
        store.acknowledge(&a, &batch).unwrap();
        store
            .append(Some(&a), EventStream::Proctoring, &event(2))
            .unwrap();
        let restarted = fixture.store("second");
        let next = pending(&restarted, &a);
        assert_eq!(next.events.len(), 1);
        assert_eq!(next.events[0]["seq"], 2);
        restarted.acknowledge(&a, &next).unwrap();
        assert!(restarted
            .next_batch(&a, 200, MAX_BATCH_BYTES)
            .unwrap()
            .is_none());
    }
    #[test]
    fn batch_ack_is_bound_to_original_session() {
        let fixture = Fixture::new();
        let store = fixture.store("run");
        let a = binding("a");
        let b = binding("b");
        store
            .append(Some(&a), EventStream::Violation, &event(1))
            .unwrap();
        let batch = pending(&store, &a);
        assert!(store.acknowledge(&b, &batch).is_err());
        store.acknowledge(&a, &batch).unwrap();
        assert!(store
            .next_batch(&b, 200, MAX_BATCH_BYTES)
            .unwrap()
            .is_none());
    }
    #[test]
    fn preserves_same_timestamp_events_and_original_payload() {
        let fixture = Fixture::new();
        let store = fixture.store("run");
        let a = binding("a");
        for seq in 0..2 {
            store
                .append(Some(&a), EventStream::Violation, &event(seq))
                .unwrap();
        }
        let batch = pending(&store, &a);
        assert_eq!(batch.events.len(), 2);
        let mut first = batch.events[0].clone();
        first.as_object_mut().unwrap().remove("stream");
        assert_eq!(first, event(0));
        assert_ne!(
            event_identity(&event(0)).unwrap(),
            event_identity(&event(1)).unwrap()
        );
    }
    #[test]
    fn count_and_wire_byte_limits_leave_remaining_events_pending() {
        let fixture = Fixture::new();
        let store = fixture.store("run");
        let a = binding("a");
        for seq in 0..4 {
            store
                .append(Some(&a), EventStream::Violation, &event(seq))
                .unwrap();
        }
        let first = store.next_batch(&a, 2, MAX_BATCH_BYTES).unwrap().unwrap();
        assert_eq!(first.events.len(), 2);
        let bytes = serde_json::to_vec(&first.events[0]).unwrap().len() + 1;
        let one = store.next_batch(&a, 200, bytes).unwrap().unwrap();
        assert_eq!(one.events.len(), 1);
        store.acknowledge(&a, &one).unwrap();
        assert_eq!(pending(&store, &a).events.len(), 3);
        assert!(store.acknowledge(&a, &first).is_err());
    }
    #[test]
    fn incomplete_tail_is_preserved_and_not_acknowledged_or_concatenated() {
        let fixture = Fixture::new();
        let store = fixture.store("run");
        let a = binding("a");
        store
            .append(Some(&a), EventStream::Violation, &event(1))
            .unwrap();
        let batch = pending(&store, &a);
        OpenOptions::new()
            .append(true)
            .open(&batch.path)
            .unwrap()
            .write_all(b"{partial")
            .unwrap();
        store.acknowledge(&a, &batch).unwrap();
        assert!(store
            .next_batch(&a, 200, MAX_BATCH_BYTES)
            .unwrap()
            .is_none());
        store
            .append(Some(&a), EventStream::Violation, &event(2))
            .unwrap();
        let recovered = pending(&store, &a);
        assert_eq!(recovered.events[0]["seq"], 2);
        assert!(!recovered.notices.is_empty());
        assert!(batch.path.with_extension("quarantine").exists());
    }
    #[test]
    fn corrupt_checkpoint_is_preserved_with_explicit_same_session_replay() {
        let fixture = Fixture::new();
        let store = fixture.store("run");
        let a = binding("a");
        store
            .append(Some(&a), EventStream::Violation, &event(1))
            .unwrap();
        let batch = pending(&store, &a);
        fs::write(batch.path.with_extension("checkpoint.json"), b"{broken").unwrap();
        let replay = pending(&store, &a);
        assert_eq!(replay.events[0]["seq"], 1);
        assert!(replay.notices[0].contains("checkpoint_replay"));
        assert!(batch.path.with_extension("quarantine").exists());
    }
    #[test]
    fn corrupt_initial_checkpoint_cannot_discard_valid_events() {
        for checkpoint in [
            Checkpoint {
                discarding_oversized_line: true,
                ..Checkpoint::default()
            },
            Checkpoint {
                last_line_start: 1,
                ..Checkpoint::default()
            },
            Checkpoint {
                last_line_hash: "unexpected".into(),
                ..Checkpoint::default()
            },
        ] {
            let fixture = Fixture::new();
            let store = fixture.store("run");
            let a = binding("a");
            store
                .append(Some(&a), EventStream::Violation, &event(1))
                .unwrap();
            let original = pending(&store, &a);
            write_checkpoint(&original.path, &checkpoint).unwrap();
            let replay = pending(&store, &a);
            assert_eq!(replay.events, original.events);
            assert!(replay.notices[0].contains("checkpoint_replay"));
            store.acknowledge(&a, &replay).unwrap();
            assert!(store
                .next_batch(&a, 200, MAX_BATCH_BYTES)
                .unwrap()
                .is_none());
        }
    }

    #[test]
    fn corrupt_continuation_flag_cannot_discard_the_next_complete_record() {
        let fixture = Fixture::new();
        let store = fixture.store("run");
        let a = binding("a");
        store
            .append(Some(&a), EventStream::Violation, &event(1))
            .unwrap();
        let first = pending(&store, &a);
        store.acknowledge(&a, &first).unwrap();
        let mut checkpoint = first.checkpoint.clone();
        checkpoint.discarding_oversized_line = true;
        write_checkpoint(&first.path, &checkpoint).unwrap();
        store
            .append(Some(&a), EventStream::Violation, &event(2))
            .unwrap();
        let replay = pending(&store, &a);
        assert_eq!(replay.events.len(), 2);
        assert_eq!(replay.events[1]["seq"], 2);
        assert!(replay.notices[0].contains("checkpoint_replay"));
    }

    #[test]
    fn checkpoint_detects_file_replacement_and_truncation() {
        let fixture = Fixture::new();
        let store = fixture.store("run");
        let a = binding("a");
        store
            .append(Some(&a), EventStream::Violation, &event(1))
            .unwrap();
        let batch = pending(&store, &a);
        store.acknowledge(&a, &batch).unwrap();
        let bytes = fs::read(&batch.path).unwrap();
        let mut changed = bytes.clone();
        changed[5] ^= 1;
        fs::write(&batch.path, changed).unwrap();
        let recovered = pending(&store, &a);
        assert!(!recovered.notices.is_empty());
        store.acknowledge(&a, &recovered).unwrap();
        fs::write(&batch.path, b"").unwrap();
        let recovered = pending(&store, &a);
        assert!(!recovered.notices.is_empty());
    }
    #[test]
    fn oversized_event_and_disk_errors_are_returned() {
        let fixture = Fixture::new();
        let store = fixture.store("run");
        let a = binding("a");
        assert!(store
            .append(
                Some(&a),
                EventStream::Violation,
                &json!({"detail":"x".repeat(MAX_EVENT_BYTES)})
            )
            .is_err());
        fs::write(&store.root, b"not a directory").unwrap();
        assert!(store
            .append(Some(&a), EventStream::Violation, &event(0))
            .is_err());
    }
    #[test]
    fn legacy_files_are_preserved_and_never_uploaded() {
        let fixture = Fixture::new();
        let store = fixture.store("run");
        let a = binding("a");
        let path = fixture.0.join("violations.jsonl");
        fs::write(&path, "{\"kind\":\"legacy\"}\n").unwrap();
        assert!(store
            .next_batch(&a, 200, MAX_BATCH_BYTES)
            .unwrap()
            .is_none());
        assert_eq!(fs::read_to_string(path).unwrap(), "{\"kind\":\"legacy\"}\n");
    }
    #[test]
    fn recent_history_returns_bounded_latest_records() {
        let fixture = Fixture::new();
        let store = fixture.store("run");
        let a = binding("a");
        for seq in 0..10 {
            store
                .append(Some(&a), EventStream::Violation, &event(seq))
                .unwrap();
        }
        let recent = store.recent_history(Some(&a), 2).unwrap();
        assert_eq!(recent.len(), 2);
        assert_eq!(recent[0]["seq"], 8);
        assert_eq!(recent[1]["seq"], 9);
    }
    #[test]
    fn concurrent_writers_leave_complete_distinct_events() {
        let fixture = Fixture::new();
        let store = std::sync::Arc::new(fixture.store("run"));
        let a = binding("a");
        let writers: Vec<_> = (0..8)
            .map(|seq| {
                let store = store.clone();
                let a = a.clone();
                std::thread::spawn(move || {
                    store
                        .append(Some(&a), EventStream::Violation, &event(seq))
                        .unwrap()
                })
            })
            .collect();
        for writer in writers {
            writer.join().unwrap();
        }
        let batch = pending(&store, &a);
        let mut sequences: Vec<_> = batch
            .events
            .iter()
            .map(|e| e["seq"].as_u64().unwrap())
            .collect();
        sequences.sort_unstable();
        assert_eq!(sequences, (0..8).collect::<Vec<_>>());
    }
    #[test]
    fn corrupt_and_oversized_rows_are_quarantined_without_stalling() {
        let fixture = Fixture::new();
        let store = fixture.store("run");
        let a = binding("a");
        store
            .append(Some(&a), EventStream::Violation, &event(1))
            .unwrap();
        let batch = pending(&store, &a);
        fs::write(&batch.path, b"broken\n").unwrap();
        let quarantined = pending(&store, &a);
        assert!(quarantined.events.is_empty());
        assert!(!quarantined.notices.is_empty());
        fs::write(&batch.path, vec![b'x'; MAX_EVENT_BYTES + 1]).unwrap();
        let quarantined = pending(&store, &a);
        assert!(quarantined.events.is_empty());
        assert!(!quarantined.notices.is_empty());
        assert!(!batch.path.with_extension("checkpoint.json").exists());
    }
    #[test]
    fn valid_json_with_invalid_wire_fields_is_quarantined_before_upload() {
        let fixture = Fixture::new();
        let store = fixture.store("run");
        let a = binding("a");
        store
            .append(Some(&a), EventStream::Violation, &event(1))
            .unwrap();
        let first = pending(&store, &a);
        store.acknowledge(&a, &first).unwrap();
        let mut file = OpenOptions::new().append(true).open(&first.path).unwrap();
        for bad in [
            json!({}),
            json!({"kind":"focus","detail":"x","ts":"wrong"}),
            json!({"kind":"focus","detail":"x","ts":4,"seq":"wrong"}),
        ] {
            serde_json::to_writer(
                &mut file,
                &Envelope {
                    stream: EventStream::Violation,
                    event: bad,
                },
            )
            .unwrap();
            file.write_all(b"\n").unwrap();
        }
        serde_json::to_writer(
            &mut file,
            &Envelope {
                stream: EventStream::Proctoring,
                event: json!({"kind":"camera","detail":"x","ts":4}),
            },
        )
        .unwrap();
        file.write_all(b"\n").unwrap();
        store
            .append(Some(&a), EventStream::Violation, &event(5))
            .unwrap();
        let batch = pending(&store, &a);
        assert_eq!(batch.events.len(), 1);
        assert_eq!(batch.events[0]["seq"], 5);
        assert_eq!(batch.notices.len(), 4);
        store.acknowledge(&a, &batch).unwrap();
        assert!(store
            .next_batch(&a, 200, MAX_BATCH_BYTES)
            .unwrap()
            .is_none());
    }
    #[test]
    fn valid_events_after_poison_rows_keep_original_hashes() {
        let fixture = Fixture::new();
        let store = fixture.store("run");
        let a = binding("a");
        store
            .append(Some(&a), EventStream::Violation, &event(1))
            .unwrap();
        let first = pending(&store, &a);
        store.acknowledge(&a, &first).unwrap();
        OpenOptions::new()
            .append(true)
            .open(&first.path)
            .unwrap()
            .write_all(b"broken\n")
            .unwrap();
        store
            .append(Some(&a), EventStream::Violation, &event(3))
            .unwrap();
        let batch = pending(&store, &a);
        assert_eq!(batch.events.len(), 1);
        assert_eq!(batch.events[0]["hash"], "event-3");
        assert!(batch.notices[0].contains("hash-chain gap"));
        store.acknowledge(&a, &batch).unwrap();
        assert!(store
            .next_batch(&a, 200, MAX_BATCH_BYTES)
            .unwrap()
            .is_none());
    }
    #[test]
    fn oversized_fragment_cursor_never_uploads_json_looking_suffix() {
        let fixture = Fixture::new();
        let store = fixture.store("run");
        let a = binding("a");
        store
            .append(Some(&a), EventStream::Violation, &event(1))
            .unwrap();
        let first = pending(&store, &a);
        store.acknowledge(&a, &first).unwrap();
        let mut file = OpenOptions::new().append(true).open(&first.path).unwrap();
        file.write_all(&vec![b'x'; 4 * MAX_BATCH_BYTES]).unwrap();
        let suffix = serde_json::to_vec(&Envelope {
            stream: EventStream::Violation,
            event: event(99),
        })
        .unwrap();
        file.write_all(&suffix).unwrap();
        file.write_all(b"\n").unwrap();
        store
            .append(Some(&a), EventStream::Violation, &event(2))
            .unwrap();
        let fragments = pending(&store, &a);
        assert!(fragments.events.is_empty());
        store.acknowledge(&a, &fragments).unwrap();
        let next = pending(&store, &a);
        assert_eq!(next.events.len(), 1);
        assert_eq!(next.events[0]["seq"], 2);
    }
    #[test]
    fn retention_only_deletes_old_fully_acknowledged_closed_clean_runs() {
        let fixture = Fixture::new();
        let old = fixture.store("old");
        let a = binding("a");
        let b = binding("b");
        old.append(Some(&a), EventStream::Violation, &event(1))
            .unwrap();
        let acknowledged = pending(&old, &a);
        old.acknowledge(&a, &acknowledged).unwrap();
        old.append(Some(&b), EventStream::Violation, &event(2))
            .unwrap();
        let unacknowledged = pending(&old, &b);
        old.append(None, EventStream::Violation, &event(3)).unwrap();
        let current = fixture.store("current");
        current
            .append(Some(&a), EventStream::Violation, &event(4))
            .unwrap();
        old.close_binding(&a).unwrap();
        let later =
            std::time::SystemTime::now() + std::time::Duration::from_secs(31 * 24 * 60 * 60);
        assert_eq!(old.cleanup_acknowledged(later).unwrap(), 0); // current process run
        assert_eq!(
            current
                .cleanup_acknowledged(std::time::SystemTime::now())
                .unwrap(),
            0
        );
        assert_eq!(current.cleanup_acknowledged(later).unwrap(), 1);
        assert!(!acknowledged.path.exists());
        assert!(unacknowledged.path.exists());
        assert_eq!(current.recent_history(None, 10).unwrap().len(), 1);
    }
    #[test]
    fn retention_preserves_unclosed_runs_and_reopened_runs() {
        let fixture = Fixture::new();
        let old = fixture.store("old");
        let a = binding("a");
        old.append(Some(&a), EventStream::Violation, &event(1))
            .unwrap();
        let first = pending(&old, &a);
        old.acknowledge(&a, &first).unwrap();
        let later =
            std::time::SystemTime::now() + std::time::Duration::from_secs(31 * 24 * 60 * 60);
        assert_eq!(fixture.store("new").cleanup_acknowledged(later).unwrap(), 0);
        old.close_binding(&a).unwrap();
        assert!(first.path.with_extension("closed").exists());
        old.append(Some(&a), EventStream::Violation, &event(2))
            .unwrap();
        assert!(!first.path.with_extension("closed").exists());
        assert_eq!(fixture.store("new").cleanup_acknowledged(later).unwrap(), 0);
    }
    #[test]
    fn quarantine_prevents_retention_deletion_even_after_ack() {
        let fixture = Fixture::new();
        let old = fixture.store("old");
        let a = binding("a");
        old.append(Some(&a), EventStream::Violation, &event(1))
            .unwrap();
        let initial = pending(&old, &a);
        fs::write(&initial.path, b"corrupt\n").unwrap();
        let recovered = pending(&old, &a);
        old.acknowledge(&a, &recovered).unwrap();
        old.close_binding(&a).unwrap();
        let current = fixture.store("current");
        assert_eq!(
            current
                .cleanup_acknowledged(
                    std::time::SystemTime::now()
                        + std::time::Duration::from_secs(31 * 24 * 60 * 60)
                )
                .unwrap(),
            0
        );
        assert!(initial.path.exists());
    }

    #[test]
    fn interrupted_checkpoint_temporary_file_is_not_accepted() {
        let fixture = Fixture::new();
        let store = fixture.store("run");
        let a = binding("a");
        store
            .append(Some(&a), EventStream::Violation, &event(1))
            .unwrap();
        let batch = pending(&store, &a);
        fs::write(batch.path.with_extension("checkpoint.tmp"), b"{partial").unwrap();
        assert_eq!(pending(&store, &a).events, batch.events);
        store.acknowledge(&a, &batch).unwrap();
        assert!(store
            .next_batch(&a, 200, MAX_BATCH_BYTES)
            .unwrap()
            .is_none());
    }
    #[cfg(unix)]
    #[test]
    fn files_are_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let fixture = Fixture::new();
        let store = fixture.store("run");
        let a = binding("a");
        store
            .append(Some(&a), EventStream::Violation, &event(1))
            .unwrap();
        let batch = pending(&store, &a);
        store.acknowledge(&a, &batch).unwrap();
        assert_eq!(
            fs::metadata(&batch.path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(
            fs::metadata(batch.path.with_extension("checkpoint.json"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
}
