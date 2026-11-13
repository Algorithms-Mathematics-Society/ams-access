//! Private, unprivileged Linux voice worker. No shell, listener, or API token.
use serde_json::{json, Value};

#[cfg(any(target_os = "linux", test))]
const MAX_FRAME: usize = 65_536;
#[cfg(any(target_os = "linux", test))]
const RELAY: &str = "43.204.79.244";

#[cfg(any(target_os = "linux", test))]
fn identifier(value: Option<&Value>) -> bool {
    value.and_then(Value::as_str).is_some_and(|s| {
        !s.is_empty()
            && s.len() <= 128
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    })
}

#[cfg(any(target_os = "linux", test))]
fn valid_candidate(candidate: &str) -> bool {
    if candidate.len() > 4096 || candidate.contains(['\r', '\n', '\0']) {
        return false;
    }
    let parts: Vec<_> = candidate.split_ascii_whitespace().collect();
    parts.len() >= 8
        && parts[0].starts_with("candidate:")
        && parts[1] == "1"
        && (parts[2].eq_ignore_ascii_case("udp") || parts[2].eq_ignore_ascii_case("tcp"))
        && parts[4] == RELAY
        && parts[5].parse::<u16>().is_ok_and(|p| p != 0)
        && parts[6] == "typ"
        && parts[7] == "relay"
}

#[cfg(any(target_os = "linux", test))]
fn valid_turn(server: &Value) -> bool {
    let Some(username) = server.get("username").and_then(Value::as_str) else {
        return false;
    };
    let Some(password) = server.get("credential").and_then(Value::as_str) else {
        return false;
    };
    if username.is_empty()
        || username.len() > 1024
        || password.is_empty()
        || password.len() > 4096
        || username.chars().any(char::is_control)
        || password.chars().any(char::is_control)
    {
        return false;
    }
    let urls = match server.get("urls") {
        Some(Value::String(url)) => vec![url.as_str()],
        Some(Value::Array(urls)) if !urls.is_empty() && urls.len() <= 8 => {
            let Some(urls) = urls.iter().map(Value::as_str).collect::<Option<Vec<_>>>() else {
                return false;
            };
            urls
        }
        _ => return false,
    };
    urls.into_iter().all(|raw| {
        let Some(rest) = raw
            .strip_prefix("turn:")
            .or_else(|| raw.strip_prefix("turns:"))
        else {
            return false;
        };
        let (authority, query) = rest.split_once('?').unwrap_or((rest, ""));
        if !matches!(query, "" | "transport=udp" | "transport=tcp") {
            return false;
        }
        let (host, port) = authority.split_once(':').unwrap_or((authority, ""));
        matches!(host, "turn.amsaccess.com" | RELAY)
            && (matches!(port, "" | "3478" | "5349")
                || (port == "443"
                    && raw.starts_with("turns:")
                    && matches!(query, "" | "transport=tcp")))
    })
}

#[cfg(any(target_os = "linux", test))]
fn validate_request(request: &Value) -> Result<(), String> {
    let fail = || Err("Invalid native voice request".into());
    let Some(obj) = request.as_object() else {
        return fail();
    };
    if serde_json::to_vec(request)
        .map_err(|_| "Invalid native voice request")?
        .len()
        > MAX_FRAME - 256
    {
        return fail();
    }
    if !identifier(obj.get("session")) {
        return fail();
    }
    let Some(op) = obj.get("op").and_then(Value::as_str) else {
        return fail();
    };
    let fields: &[&str] = match op {
        "peer_create" | "configure" => &["op", "session", "peer", "ice_servers", "expires_at"],
        "peer_close" | "stats" => &["op", "session", "peer"],
        "local_description" => &["op", "session", "peer", "type", "ice_restart"],
        "remote_description" => &["op", "session", "peer", "description"],
        "ice" => &["op", "session", "peer", "candidate"],
        "mute" => &["op", "session", "muted"],
        "keepalive" => &["op", "session"],
        "volume" => &["op", "session", "peer", "volume"],
        _ => return fail(),
    };
    if obj.keys().any(|k| !fields.contains(&k.as_str())) {
        return fail();
    }
    if !matches!(op, "mute" | "keepalive") && !identifier(obj.get("peer")) {
        return fail();
    }
    match op {
        "peer_create" | "configure" => {
            let Some(servers) = obj.get("ice_servers").and_then(Value::as_array) else {
                return fail();
            };
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| "Clock unavailable")?
                .as_secs();
            if servers.is_empty()
                || servers.len() > 8
                || !servers.iter().all(valid_turn)
                || !obj
                    .get("expires_at")
                    .and_then(Value::as_u64)
                    .is_some_and(|expiry| expiry > now && expiry - now <= 86_400)
            {
                return fail();
            }
        }
        "local_description" => {
            if !matches!(
                obj.get("type").and_then(Value::as_str),
                Some("offer" | "answer")
            ) || obj.get("ice_restart").is_some_and(|v| !v.is_boolean())
            {
                return fail();
            }
        }
        "remote_description" => {
            let Some(description) = obj.get("description").and_then(Value::as_object) else {
                return fail();
            };
            if description
                .keys()
                .any(|key| !matches!(key.as_str(), "type" | "sdp"))
            {
                return fail();
            }
            match description.get("type").and_then(Value::as_str) {
                Some("rollback") => {
                    if description
                        .get("sdp")
                        .is_some_and(|s| s.as_str() != Some(""))
                    {
                        return fail();
                    }
                }
                Some("offer" | "answer") => {
                    let Some(sdp) = description.get("sdp").and_then(Value::as_str) else {
                        return fail();
                    };
                    let media: Vec<_> = sdp.lines().filter(|l| l.starts_with("m=")).collect();
                    if sdp.len() > 48_000
                        || sdp.contains('\0')
                        || media.len() != 1
                        || !media[0].starts_with("m=audio ")
                        || !sdp.lines().any(|l| {
                            l.starts_with("a=rtpmap:")
                                && l.to_ascii_lowercase().contains("opus/48000")
                        })
                        || sdp
                            .lines()
                            .filter_map(|l| l.strip_prefix("a=candidate:"))
                            .any(|s| !valid_candidate(&format!("candidate:{s}")))
                    {
                        return fail();
                    }
                }
                _ => return fail(),
            }
        }
        "ice" => {
            let Some(candidate) = obj.get("candidate").and_then(Value::as_object) else {
                return fail();
            };
            if candidate
                .keys()
                .any(|k| !matches!(k.as_str(), "candidate" | "sdpMLineIndex" | "sdpMid"))
                || !candidate
                    .get("candidate")
                    .and_then(Value::as_str)
                    .is_some_and(valid_candidate)
                || candidate.get("sdpMLineIndex").and_then(Value::as_u64) != Some(0)
                || candidate
                    .get("sdpMid")
                    .is_some_and(|s| !s.is_null() && !s.as_str().is_some_and(|s| s.len() <= 64))
            {
                return fail();
            }
        }
        "mute" => {
            if !obj.get("muted").is_some_and(Value::is_boolean) {
                return fail();
            }
        }
        "volume" => {
            if !obj
                .get("volume")
                .and_then(Value::as_f64)
                .is_some_and(|v| (0.0..=1.0).contains(&v))
            {
                return fail();
            }
        }
        _ => {}
    }
    Ok(())
}

#[cfg(any(target_os = "linux", test))]
fn read_frame(reader: &mut impl std::io::BufRead) -> Result<Value, ()> {
    use std::io::{BufRead, Read};
    let mut bytes = Vec::new();
    let count = reader
        .take(MAX_FRAME as u64)
        .read_until(b'\n', &mut bytes)
        .map_err(|_| ())?;
    if count == 0 || count >= MAX_FRAME || !bytes.ends_with(b"\n") {
        return Err(());
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| ())?;
    if value.get("v").and_then(Value::as_u64) != Some(1) {
        return Err(());
    }
    Ok(value)
}

#[cfg(target_os = "linux")]
mod native {
    use super::*;
    use std::io::{BufReader, Write};
    use std::process::{Child, ChildStdin, Command, Stdio};
    use std::sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex, OnceLock,
    };
    use std::time::{Duration, Instant};
    use tauri::Emitter;
    #[cfg(not(debug_assertions))]
    use tauri::Manager;

    static WORKER: OnceLock<Mutex<Option<Worker>>> = OnceLock::new();
    static CONTROL: OnceLock<Mutex<Option<Control>>> = OnceLock::new();
    static CLOSED: AtomicBool = AtomicBool::new(false);
    static NEXT: AtomicU64 = AtomicU64::new(1);
    #[derive(Clone)]
    struct Control {
        child: Arc<Mutex<Child>>,
        session: Arc<Mutex<Option<String>>>,
        stopped: Arc<AtomicBool>,
        intentional: Arc<AtomicBool>,
        failed: Arc<AtomicBool>,
        rpc_deadline: Arc<Mutex<Option<Instant>>>,
        last_seen: Arc<Mutex<Instant>>,
    }
    impl Control {
        fn kill(&self) {
            self.failed.store(true, Ordering::Release);
            self.terminate();
        }
        fn stop(&self) {
            self.intentional.store(true, Ordering::Release);
            self.terminate();
        }
        fn notify_failure(&self) -> bool {
            self.failed.load(Ordering::Acquire) || !self.intentional.load(Ordering::Acquire)
        }
        fn expired(&self, now: Instant) -> bool {
            let timed_out = self
                .rpc_deadline
                .lock()
                .map(|d| d.is_some_and(|d| now >= d))
                .unwrap_or(true);
            let active = self.session.lock().map(|s| s.is_some()).unwrap_or(true);
            let lease_expired = active
                && self
                    .last_seen
                    .lock()
                    .map(|seen| now.saturating_duration_since(*seen) >= Duration::from_secs(15))
                    .unwrap_or(true);
            timed_out || lease_expired
        }
        fn terminate(&self) {
            self.stopped.store(true, Ordering::Release);
            if let Ok(mut child) = self.child.lock() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
    struct Worker {
        control: Control,
        input: ChildStdin,
        replies: mpsc::Receiver<Value>,
        next: u32,
        peers: std::collections::HashMap<String, (u16, u16)>,
    }
    impl Drop for Worker {
        fn drop(&mut self) {
            self.control.stop();
        }
    }

    fn authorize(window: &tauri::WebviewWindow, app: &tauri::AppHandle) -> Result<(), String> {
        let uri = window.url().map_err(|_| "Voice origin unavailable")?;
        if window.label() != "main"
            || !crate::linux_media_permission::should_allow(
                "WebKitDeviceInfoPermissionRequest",
                None,
                Some(uri.as_str()),
                app.config().build.dev_url.as_ref(),
            )
        {
            return Err("Native voice is restricted to the main app".into());
        }
        Ok(())
    }
    impl Worker {
        fn spawn(app: &tauri::AppHandle) -> Result<Self, String> {
            if CLOSED.load(Ordering::Acquire) {
                return Err("Native voice is shutting down".into());
            }
            let path = {
                #[cfg(debug_assertions)]
                {
                    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                        .join("helpers/ams-linux-voice-worker")
                }
                #[cfg(not(debug_assertions))]
                {
                    app.path()
                        .resource_dir()
                        .map_err(|_| "Voice resources unavailable")?
                        .join("helpers/ams-linux-voice-worker")
                }
            };
            let mut process = Command::new(path)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|_| "Native voice worker is not installed")?;
            let input = process
                .stdin
                .take()
                .ok_or("Native voice input unavailable")?;
            let output = process
                .stdout
                .take()
                .ok_or("Native voice output unavailable")?;
            let control = Control {
                child: Arc::new(Mutex::new(process)),
                session: Arc::new(Mutex::new(None)),
                stopped: Arc::new(AtomicBool::new(false)),
                intentional: Arc::new(AtomicBool::new(false)),
                failed: Arc::new(AtomicBool::new(false)),
                rpc_deadline: Arc::new(Mutex::new(None)),
                last_seen: Arc::new(Mutex::new(Instant::now())),
            };
            let reader_control = control.clone();
            let app = app.clone();
            let (tx, replies) = mpsc::sync_channel(1);
            std::thread::Builder::new()
                .name("ams-native-voice".into())
                .spawn(move || {
                    let mut reader = BufReader::new(output);
                    loop {
                        let Ok(value) = read_frame(&mut reader) else {
                            break;
                        };
                        if value.get("id").is_some() {
                            if tx.try_send(value).is_err() {
                                break;
                            }
                        } else if let Some(event) = value.get("event").and_then(Value::as_str) {
                            if !matches!(event, "ice" | "negotiation" | "state" | "ended") {
                                break;
                            }
                            let session =
                                reader_control.session.lock().ok().and_then(|s| s.clone());
                            if value.get("session").and_then(Value::as_str) == session.as_deref()
                                && !reader_control.stopped.load(Ordering::Acquire)
                            {
                                let _ = app.emit_to("main", "linux-team-voice", &value);
                            }
                        } else {
                            break;
                        }
                    }
                    let failed = reader_control.notify_failure();
                    reader_control.terminate();
                    if failed {
                        let session = reader_control.session.lock().ok().and_then(|s| s.clone());
                        if let Some(session) = session {
                            let _ = app.emit_to(
                                "main",
                                "linux-team-voice",
                                json!({"v":1,"event":"ended","session":session}),
                            );
                        }
                    }
                })
                .map_err(|_| {
                    control.kill();
                    "Cannot start native voice reader"
                })?;
            let watchdog = control.clone();
            std::thread::Builder::new()
                .name("ams-voice-watchdog".into())
                .spawn(move || {
                    while !watchdog.stopped.load(Ordering::Acquire) {
                        if watchdog.expired(Instant::now()) {
                            watchdog.kill();
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(100));
                    }
                })
                .map_err(|_| {
                    control.kill();
                    "Cannot start native voice watchdog"
                })?;
            *CONTROL
                .get_or_init(|| Mutex::new(None))
                .lock()
                .map_err(|_| "Voice state unavailable")? = Some(control.clone());
            if CLOSED.load(Ordering::Acquire) {
                control.kill();
                return Err("Native voice is shutting down".into());
            }
            Ok(Self {
                control,
                input,
                replies,
                next: 0,
                peers: std::collections::HashMap::new(),
            })
        }
        fn rpc(&mut self, mut value: Value) -> Result<Value, String> {
            if self.control.stopped.load(Ordering::Acquire) {
                return Err("Native voice worker stopped".into());
            }
            self.next = self
                .next
                .checked_add(1)
                .ok_or("Native voice request limit reached")?;
            value["v"] = json!(1);
            value["id"] = json!(self.next);
            let mut raw = serde_json::to_vec(&value).map_err(|_| "Native voice request invalid")?;
            raw.push(b'\n');
            if raw.len() > MAX_FRAME {
                return Err("Native voice request too large".into());
            }
            // One worker watchdog bounds writes as well as response waits.
            *self
                .control
                .rpc_deadline
                .lock()
                .map_err(|_| "Voice state unavailable")? =
                Some(Instant::now() + Duration::from_secs(8));
            let result = (|| {
                self.input
                    .write_all(&raw)
                    .map_err(|_| "Native voice worker write failed")?;
                self.input
                    .flush()
                    .map_err(|_| "Native voice worker write failed")?;
                let reply = self
                    .replies
                    .recv_timeout(Duration::from_secs(8))
                    .map_err(|_| "Native voice worker timed out")?;
                if reply.get("id").and_then(Value::as_u64) != Some(u64::from(self.next)) {
                    return Err("Invalid native voice response".into());
                }
                if reply.get("ok").and_then(Value::as_bool) != Some(true) {
                    return Err("Native voice operation failed".into());
                }
                Ok(reply.get("result").cloned().unwrap_or(json!({})))
            })();
            if let Ok(mut deadline) = self.control.rpc_deadline.lock() {
                *deadline = None;
            }
            if result.is_err() {
                self.control.kill();
            }
            result
        }
    }
    fn with_worker(
        app: &tauri::AppHandle,
        f: impl FnOnce(&mut Worker) -> Result<Value, String>,
    ) -> Result<Value, String> {
        let mut slot = WORKER
            .get_or_init(|| Mutex::new(None))
            .try_lock()
            .map_err(|_| "Native voice is busy")?;
        if slot
            .as_ref()
            .is_some_and(|w| w.control.stopped.load(Ordering::Acquire))
        {
            *slot = None;
        }
        if slot.is_none() {
            *slot = Some(Worker::spawn(app)?);
        }
        let worker = slot.as_mut().ok_or("Native voice unavailable")?;
        f(worker)
    }
    pub async fn probe(
        window: tauri::WebviewWindow,
        app: tauri::AppHandle,
    ) -> Result<Value, String> {
        authorize(&window, &app)?;
        tauri::async_runtime::spawn_blocking(move || {
            with_worker(&app, |w| w.rpc(json!({"op":"probe"})))
        })
        .await
        .map_err(|_| "Native voice probe failed")?
    }
    pub async fn start(
        window: tauri::WebviewWindow,
        app: tauri::AppHandle,
    ) -> Result<Value, String> {
        authorize(&window, &app)?;
        tauri::async_runtime::spawn_blocking(move || {
            with_worker(&app, |w| {
                let session = format!("voice-{}", NEXT.fetch_add(1, Ordering::Relaxed));
                {
                    let mut active = w
                        .control
                        .session
                        .lock()
                        .map_err(|_| "Voice state unavailable")?;
                    if active.is_some() {
                        return Err("Native voice already started".into());
                    }
                    *w.control
                        .last_seen
                        .lock()
                        .map_err(|_| "Voice state unavailable")? = Instant::now();
                    *active = Some(session.clone());
                }
                w.rpc(json!({"op":"start","session":session}))?;
                Ok(json!({"session":session}))
            })
        })
        .await
        .map_err(|_| "Native voice start failed")?
    }
    pub async fn call(
        window: tauri::WebviewWindow,
        app: tauri::AppHandle,
        request: Value,
    ) -> Result<Value, String> {
        authorize(&window, &app)?;
        validate_request(&request)?;
        tauri::async_runtime::spawn_blocking(move || {
            with_worker(&app, |w| {
                if w.control
                    .session
                    .lock()
                    .map_err(|_| "Voice state unavailable")?
                    .as_deref()
                    != request.get("session").and_then(Value::as_str)
                {
                    return Err("Stale native voice session".into());
                }
                let op = request["op"].as_str().ok_or("Invalid voice operation")?;
                let peer = request
                    .get("peer")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_owned();
                match op {
                    "peer_create" => {
                        if w.peers.contains_key(&peer) || w.peers.len() >= 4 {
                            return Err("Native voice peer limit reached".into());
                        }
                        w.peers.insert(peer.clone(), (0, 0));
                    }
                    "mute" => {}
                    "keepalive" => {
                        *w.control
                            .last_seen
                            .lock()
                            .map_err(|_| "Voice state unavailable")? = Instant::now();
                        return Ok(json!({}));
                    }
                    "peer_close" => {
                        if w.peers.remove(&peer).is_none() {
                            return Ok(json!({}));
                        }
                    }
                    _ => {
                        let bounds = w
                            .peers
                            .get_mut(&peer)
                            .ok_or("Native voice peer unavailable")?;
                        if matches!(op, "local_description" | "remote_description") {
                            if bounds.0 >= 16 {
                                return Err("Native voice description limit reached".into());
                            }
                            bounds.0 += 1;
                        }
                        if op == "ice" {
                            if bounds.1 >= 96 {
                                return Err("Native voice candidate limit reached".into());
                            }
                            bounds.1 += 1;
                        }
                    }
                }
                w.rpc(request)
            })
        })
        .await
        .map_err(|_| "Native voice call failed")?
    }
    pub async fn stop(
        window: tauri::WebviewWindow,
        app: tauri::AppHandle,
        session: String,
    ) -> Result<(), String> {
        authorize(&window, &app)?;
        tauri::async_runtime::spawn_blocking(move || close(Some(&session)))
            .await
            .map_err(|_| "Native voice stop failed")?;
        Ok(())
    }
    pub fn shutdown() {
        CLOSED.store(true, Ordering::Release);
        close(None);
    }
    pub fn close(session: Option<&str>) {
        let control = CONTROL
            .get_or_init(|| Mutex::new(None))
            .lock()
            .ok()
            .and_then(|c| c.clone());
        if let Some(control) = control {
            let same = session.is_none()
                || control
                    .session
                    .lock()
                    .ok()
                    .is_some_and(|s| s.as_deref() == session);
            if same {
                control.stop();
            }
        }
    }
    #[cfg(test)]
    mod lifecycle_tests {
        use super::*;

        fn waiting_child() -> Control {
            // A disposable child exercises kill/reap without devices or networking.
            let child = Command::new("sleep").arg("30").spawn().unwrap();
            Control {
                child: Arc::new(Mutex::new(child)),
                session: Arc::new(Mutex::new(Some("voice-test".into()))),
                stopped: Arc::new(AtomicBool::new(false)),
                intentional: Arc::new(AtomicBool::new(false)),
                failed: Arc::new(AtomicBool::new(false)),
                rpc_deadline: Arc::new(Mutex::new(None)),
                last_seen: Arc::new(Mutex::new(Instant::now())),
            }
        }

        #[test]
        fn renderer_lease_and_rpc_deadline_are_independent_and_bounded() {
            let control = waiting_child();
            let now = Instant::now();
            *control.last_seen.lock().unwrap() = now;
            assert!(!control.expired(now + Duration::from_secs(14)));
            assert!(control.expired(now + Duration::from_secs(15)));
            *control.last_seen.lock().unwrap() = now + Duration::from_secs(10);
            assert!(!control.expired(now + Duration::from_secs(15)));
            *control.rpc_deadline.lock().unwrap() = Some(now + Duration::from_secs(8));
            assert!(control.expired(now + Duration::from_secs(8)));
            *control.rpc_deadline.lock().unwrap() = None;
            *control.session.lock().unwrap() = None;
            assert!(!control.expired(now + Duration::from_secs(100)));
            control.stop();
        }

        #[test]
        fn fatal_worker_exit_remains_visible_after_drop_cleanup() {
            let control = waiting_child();
            control.kill();
            control.stop();
            assert!(control.notify_failure());
            assert!(control.child.lock().unwrap().try_wait().unwrap().is_some());
        }

        #[test]
        fn intentional_stop_suppresses_failure_but_reaps_child() {
            let control = waiting_child();
            control.stop();
            assert!(!control.notify_failure());
            assert!(control.child.lock().unwrap().try_wait().unwrap().is_some());
        }

        #[test]
        fn unexpected_eof_is_failure_even_without_rpc_error() {
            let control = waiting_child();
            assert!(control.notify_failure());
            control.terminate();
            assert!(control.notify_failure());
        }
    }
}

#[tauri::command]
pub async fn linux_voice_probe(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Value, String> {
    #[cfg(target_os = "linux")]
    {
        native::probe(window, app).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (window, app);
        Ok(json!({"available":false}))
    }
}
#[tauri::command]
pub async fn linux_voice_start(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Value, String> {
    #[cfg(target_os = "linux")]
    {
        native::start(window, app).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (window, app);
        Err("Native Linux voice unavailable".into())
    }
}
#[tauri::command]
pub async fn linux_voice_call(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    request: Value,
) -> Result<Value, String> {
    #[cfg(target_os = "linux")]
    {
        native::call(window, app, request).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (window, app, request);
        Err("Native Linux voice unavailable".into())
    }
}
#[tauri::command]
pub async fn linux_voice_stop(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    session: String,
) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        native::stop(window, app, session).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (window, app, session);
        Ok(())
    }
}
pub fn shutdown() {
    #[cfg(target_os = "linux")]
    native::shutdown();
}

pub fn suspend() {
    #[cfg(target_os = "linux")]
    native::close(None);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn frame_reader_bounds_unterminated_lines_and_protocol_version() {
        use std::io::Cursor;
        assert_eq!(
            read_frame(&mut Cursor::new(b"{\"v\":1,\"id\":1,\"ok\":true}\n")).unwrap()["id"],
            1
        );
        for invalid in [
            b"{\"v\":2}\n".to_vec(),
            b"{\"v\":1}".to_vec(),
            vec![b'x'; MAX_FRAME + 10],
            b"not json\n".to_vec(),
        ] {
            let mut cursor = Cursor::new(invalid);
            assert!(read_frame(&mut cursor).is_err());
            assert!(cursor.position() <= MAX_FRAME as u64);
        }
    }
    fn request(op: &str) -> Value {
        json!({"op":op,"session":"voice-1","peer":"member-1"})
    }
    #[test]
    fn rejects_unbounded_or_unknown_requests() {
        assert!(validate_request(&json!({"op":"start","session":"voice-1"})).is_err());
        let mut r = request("stats");
        r["arbitrary"] = json!(true);
        assert!(validate_request(&r).is_err());
        let mut r = request("stats");
        r["peer"] = json!("x".repeat(129));
        assert!(validate_request(&r).is_err());
        assert!(validate_request(&request("stats")).is_ok());
    }
    #[test]
    fn turn_credentials_cannot_expand_network_destinations() {
        for url in [
            "turn:turn.amsaccess.com:3478?transport=udp",
            "turns:43.204.79.244:5349?transport=tcp",
            "turns:turn.amsaccess.com:443?transport=tcp",
        ] {
            assert!(valid_turn(
                &json!({"urls":url,"username":"u","credential":"p"})
            ));
        }
        for url in [
            "stun:turn.amsaccess.com",
            "turn:127.0.0.1:3478",
            "turn:turn.amsaccess.com.evil:3478",
            "turn:user@turn.amsaccess.com",
            "turn:turn.amsaccess.com:22",
            "turn:turn.amsaccess.com:443?transport=udp",
            "turn:turn.amsaccess.com?transport=udp&host=evil",
        ] {
            assert!(!valid_turn(
                &json!({"urls":url,"username":"u","credential":"p"})
            ));
        }
    }
    #[test]
    fn candidate_requires_reviewed_relay() {
        assert!(valid_candidate(
            "candidate:1 1 UDP 123 43.204.79.244 50000 typ relay"
        ));
        for c in [
            "candidate:1 1 UDP 1 127.0.0.1 5000 typ host",
            "candidate:1 1 UDP 1 10.0.0.1 80 typ relay",
            "candidate:1 1 UDP 1 43.204.79.244 0 typ relay",
        ] {
            assert!(!valid_candidate(c));
        }
    }
    #[test]
    fn validates_expiry_and_sdp_before_worker() {
        let mut r = request("peer_create");
        r["ice_servers"] =
            json!([{"urls":"turn:turn.amsaccess.com:3478","username":"u","credential":"p"}]);
        r["expires_at"] = json!(0);
        assert!(validate_request(&r).is_err());
        r["expires_at"] = json!(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs()
                + 60
        );
        assert!(validate_request(&r).is_ok());
        let mut s = request("remote_description");
        s["description"] = json!({"type":"offer","sdp":"v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 opus/48000/2\r\n"});
        assert!(validate_request(&s).is_ok());
        s["description"]["sdp"] = json!("m=video 9 RTP/AVP 96\na=rtpmap:96 opus/48000/2");
        assert!(validate_request(&s).is_err());
    }
}
