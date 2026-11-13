//! Private, single-session Linux team voice worker. Stdout carries bounded JSON only.
use gst::prelude::*;
use gstreamer as gst;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{self, BufRead, Write},
    sync::mpsc::{self, Receiver, SyncSender},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const FRAME_MAX: usize = 65_536;
const SDP_MAX: usize = 48_000;
const ICE_MAX: usize = 4_096;
const PEERS_MAX: usize = 4;
const CANDIDATES_MAX: u32 = 96;
const DESCRIPTIONS_MAX: u32 = 16;
const NEGOTIATION_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone)]
enum Message {
    Input(String),
    Event(Value),
}

struct Peer {
    rtc: gst::Element,
    branch: Vec<gst::Element>,
    tee_pad: gst::Pad,
    sink: Vec<gst::Element>,
    volume: gst::Element,
    expires_at: u64,
    local_candidates: u32,
    remote_candidates: u32,
    descriptions: u32,
    generation: u64,
    turn_updates: u8,
    opus_payload: u8,
}
struct Session {
    id: String,
    pipeline: gst::Pipeline,
    tee: gst::Element,
    microphone_volume: gst::Element,
    muted: bool,
    peers: HashMap<String, Peer>,
    synthetic: bool,
}
struct Worker {
    session: Option<Session>,
    tx: SyncSender<Message>,
    next_generation: u64,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn text<'a>(v: &'a Value, key: &str, max: usize) -> Result<&'a str, &'static str> {
    let value = v.get(key).and_then(Value::as_str).ok_or("invalid input")?;
    if value.is_empty() || value.len() > max || value.chars().any(|c| c.is_control()) {
        return Err("invalid input");
    }
    Ok(value)
}
fn identifier(v: &Value, key: &str) -> Result<String, &'static str> {
    let s = text(v, key, 128)?;
    if !s
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
    {
        return Err("invalid input");
    }
    Ok(s.to_owned())
}
fn bool_field(v: &Value, key: &str) -> Result<bool, &'static str> {
    v.get(key).and_then(Value::as_bool).ok_or("invalid input")
}
fn candidate_ok(candidate: &str) -> bool {
    if candidate.len() > ICE_MAX || candidate.chars().any(char::is_control) {
        return false;
    }
    let parts: Vec<&str> = candidate.split_ascii_whitespace().collect();
    parts.len() >= 8
        && parts[0].starts_with("candidate:")
        && parts[0].len() > 10
        && parts[1] == "1"
        && matches!(parts[2].to_ascii_lowercase().as_str(), "udp" | "tcp")
        && parts[3].parse::<u32>().is_ok()
        && parts[4] == "43.204.79.244"
        && parts[5].parse::<u16>().map(|p| p > 0).unwrap_or(false)
        && parts[6] == "typ"
        && parts[7] == "relay"
}
fn opus_payload(sdp: &str) -> Result<u8, &'static str> {
    if sdp.len() > SDP_MAX
        || !sdp.starts_with("v=0")
        || sdp
            .chars()
            .any(|c| c.is_control() && c != '\r' && c != '\n')
    {
        return Err("invalid description");
    }
    let lines: Vec<&str> = sdp.lines().map(str::trim_end).collect();
    let media: Vec<&str> = lines
        .iter()
        .copied()
        .filter(|l| l.starts_with("m="))
        .collect();
    if media.len() != 1
        || !media[0].starts_with("m=audio ")
        || !media[0].contains(" UDP/TLS/RTP/SAVPF ")
    {
        return Err("invalid description");
    }
    if media[0]
        .split_ascii_whitespace()
        .nth(1)
        .and_then(|port| port.parse::<u16>().ok())
        .filter(|port| *port > 0)
        .is_none()
    {
        return Err("invalid description");
    }
    let media_start = lines
        .iter()
        .position(|l| l.starts_with("m="))
        .ok_or("invalid description")?;
    let media_lines = &lines[media_start..];
    if !media_lines.contains(&"a=sendrecv")
        || media_lines
            .iter()
            .any(|l| matches!(*l, "a=inactive" | "a=sendonly" | "a=recvonly"))
    {
        return Err("invalid description");
    }
    let offered: Vec<u8> = media[0]
        .split_ascii_whitespace()
        .skip(3)
        .map(|n| {
            n.parse::<u8>()
                .ok()
                .filter(|pt| *pt <= 127)
                .ok_or("invalid description")
        })
        .collect::<Result<_, _>>()?;
    let payload = media_lines
        .iter()
        .find_map(|l| {
            let (number, codec) = l.strip_prefix("a=rtpmap:")?.split_once(' ')?;
            if !codec.eq_ignore_ascii_case("opus/48000/2")
                && !codec.eq_ignore_ascii_case("opus/48000")
            {
                return None;
            }
            number.parse::<u8>().ok().filter(|pt| offered.contains(pt))
        })
        .ok_or("invalid description")?;
    if lines
        .iter()
        .any(|l| l.starts_with("a=candidate:") && !candidate_ok(l.trim_start_matches("a=")))
    {
        return Err("invalid description");
    }
    if lines
        .iter()
        .any(|l| l.starts_with("a=sctp") || l.starts_with("a=dcmap"))
    {
        return Err("invalid description");
    }
    Ok(payload)
}
fn valid_sdp(sdp: &str) -> Result<(), &'static str> {
    opus_payload(sdp).map(|_| ())
}
fn turn_servers(v: &Value) -> Result<(Vec<String>, u64), &'static str> {
    let expiry = v
        .get("expires_at")
        .and_then(Value::as_u64)
        .ok_or("invalid credentials")?;
    if expiry <= now() + 5 || expiry > now() + 86_400 {
        return Err("invalid credentials");
    }
    let entries = v
        .get("ice_servers")
        .and_then(Value::as_array)
        .ok_or("invalid credentials")?;
    if entries.is_empty() || entries.len() > 4 {
        return Err("invalid credentials");
    }
    let mut urls = Vec::new();
    for item in entries {
        let username = text(item, "username", 256)?;
        let credential = text(item, "credential", 256)?;
        let inputs: Vec<&str> = match item.get("urls") {
            Some(Value::String(s)) => vec![s],
            Some(Value::Array(a)) if !a.is_empty() && a.len() <= 4 => a
                .iter()
                .map(|x| x.as_str().ok_or("invalid credentials"))
                .collect::<Result<_, _>>()?,
            _ => return Err("invalid credentials"),
        };
        for input in inputs {
            let (scheme, raw) = input.split_once(':').ok_or("invalid credentials")?;
            if !matches!(scheme, "turn" | "turns") {
                return Err("invalid credentials");
            }
            let raw = raw.strip_prefix("//").unwrap_or(raw);
            let url =
                url::Url::parse(&format!("http://{raw}")).map_err(|_| "invalid credentials")?;
            let host = url.host_str().ok_or("invalid credentials")?;
            let port = url
                .port()
                .unwrap_or(if scheme == "turn" { 3478 } else { 5349 });
            if !url.username().is_empty()
                || url.password().is_some()
                || !matches!(host, "turn.amsaccess.com" | "43.204.79.244")
                || !matches!(port, 3478 | 5349 | 443)
                || url.path() != "/"
                || url.fragment().is_some()
            {
                return Err("invalid credentials");
            }
            if let Some(q) = url.query() {
                if q != "transport=udp" && q != "transport=tcp" {
                    return Err("invalid credentials");
                }
            }
            if port == 443 && (scheme != "turns" || url.query() == Some("transport=udp")) {
                return Err("invalid credentials");
            }
            let mut auth = url::Url::parse(&format!("{scheme}://{host}:{port}"))
                .map_err(|_| "invalid credentials")?;
            auth.set_username(username)
                .map_err(|_| "invalid credentials")?;
            auth.set_password(Some(credential))
                .map_err(|_| "invalid credentials")?;
            if let Some(query) = url.query() {
                auth.set_query(Some(query));
            }
            urls.push(auth.to_string());
        }
    }
    if urls.len() > 8 {
        return Err("invalid credentials");
    }
    Ok((urls, expiry))
}
fn factory(name: &str) -> Result<gst::Element, &'static str> {
    gst::ElementFactory::make(name)
        .build()
        .map_err(|_| "media unavailable")
}
fn promise(
    rtc: &gst::Element,
    signal: &str,
    desc: Option<&gstreamer_webrtc::WebRTCSessionDescription>,
) -> Result<Option<gst::Structure>, &'static str> {
    let (sender, receiver) = mpsc::sync_channel(1);
    let p = gst::Promise::with_change_func(move |reply| {
        let _ = sender.send(reply.map(|structure| structure.map(|s| s.to_owned())));
    });
    match desc {
        Some(d) => rtc.emit_by_name::<()>(signal, &[d, &p]),
        None => rtc.emit_by_name::<()>(signal, &[&Option::<gst::Structure>::None, &p]),
    }
    let reply = match receiver.recv_timeout(NEGOTIATION_TIMEOUT) {
        Ok(Ok(reply)) => reply,
        _ => {
            p.expire();
            return Err("media negotiation failed");
        }
    };
    if reply.as_ref().and_then(|r| r.value("error").ok()).is_some() {
        return Err("media negotiation failed");
    }
    Ok(reply)
}
fn parse_description(
    kind: &str,
    sdp: &str,
) -> Result<gstreamer_webrtc::WebRTCSessionDescription, &'static str> {
    valid_sdp(sdp)?;
    let msg = gstreamer_sdp::SDPMessage::parse_buffer(sdp.as_bytes())
        .map_err(|_| "invalid description")?;
    let ty = match kind {
        "offer" => gstreamer_webrtc::WebRTCSDPType::Offer,
        "answer" => gstreamer_webrtc::WebRTCSDPType::Answer,
        _ => return Err("invalid description"),
    };
    Ok(gstreamer_webrtc::WebRTCSessionDescription::new(ty, msg))
}
fn rollback() -> gstreamer_webrtc::WebRTCSessionDescription {
    gstreamer_webrtc::WebRTCSessionDescription::new(
        gstreamer_webrtc::WebRTCSDPType::Rollback,
        gstreamer_sdp::SDPMessage::new(),
    )
}
fn create_description(
    rtc: &gst::Element,
    kind: &str,
    ice_restart: bool,
) -> Result<gstreamer_webrtc::WebRTCSessionDescription, &'static str> {
    let (signal, reply_key) = match kind {
        "offer" => ("create-offer", "offer"),
        "answer" => ("create-answer", "answer"),
        _ => return Err("invalid description"),
    };
    let options = ice_restart.then(|| {
        gst::Structure::builder("application/x-gst-webrtc-session-description")
            .field("ice-restart", true)
            .build()
    });
    let (sender, receiver) = mpsc::sync_channel(1);
    let promise = gst::Promise::with_change_func(move |reply| {
        let desc = reply.ok().and_then(|structure| {
            structure.and_then(|s| {
                s.get::<gstreamer_webrtc::WebRTCSessionDescription>(reply_key)
                    .ok()
            })
        });
        let _ = sender.send(desc);
    });
    rtc.emit_by_name::<()>(signal, &[&options, &promise]);
    let desc = match receiver.recv_timeout(NEGOTIATION_TIMEOUT) {
        Ok(Some(desc)) => desc,
        _ => {
            promise.expire();
            return Err("media negotiation failed");
        }
    };
    valid_sdp(
        &desc
            .sdp()
            .as_text()
            .map_err(|_| "media negotiation failed")?,
    )?;
    Ok(desc)
}
fn set_opus_payload(p: &mut Peer, payload: u8) {
    p.branch[4].set_property("pt", payload as u32);
    p.branch[5].set_property(
        "caps",
        gst::Caps::builder("application/x-rtp")
            .field("media", "audio")
            .field("encoding-name", "OPUS")
            .field("payload", payload as i32)
            .field("clock-rate", 48_000i32)
            .build(),
    );
    p.opus_payload = payload;
}
fn safe_write(v: &Value) -> io::Result<()> {
    let bytes = serde_json::to_vec(v)?;
    if bytes.len() + 1 > FRAME_MAX {
        return Err(io::Error::other("response too large"));
    }
    let mut stdout = io::stdout().lock();
    stdout.write_all(&bytes)?;
    stdout.write_all(b"\n")?;
    stdout.flush()
}
impl Worker {
    fn session(&mut self, v: &Value) -> Result<&mut Session, &'static str> {
        let id = identifier(v, "session")?;
        let s = self.session.as_mut().ok_or("stale session")?;
        if s.id != id {
            return Err("stale session");
        }
        Ok(s)
    }
    fn peer(&mut self, v: &Value) -> Result<&mut Peer, &'static str> {
        let id = identifier(v, "peer")?;
        let s = self.session(v)?;
        let p = s.peers.get_mut(&id).ok_or("stale peer")?;
        if p.expires_at <= now() {
            return Err("credentials expired");
        }
        Ok(p)
    }
    fn start(&mut self, v: &Value) -> Result<Value, &'static str> {
        self.start_inner(v, false)
    }
    fn start_inner(&mut self, v: &Value, synthetic: bool) -> Result<Value, &'static str> {
        let id = identifier(v, "session")?;
        if self.session.is_some() {
            return Err("session active");
        }
        let pipeline = gst::Pipeline::new();
        let source = factory(if synthetic {
            "audiotestsrc"
        } else {
            "pulsesrc"
        })?;
        if synthetic {
            source.set_property("is-live", true);
        }
        let convert = factory("audioconvert")?;
        let resample = factory("audioresample")?;
        let volume = factory("volume")?;
        let tee = factory("tee")?;
        volume.set_property("volume", if synthetic { 1.0f64 } else { 0.0f64 });
        tee.set_property("allow-not-linked", true);
        for e in [&source, &convert, &resample, &volume, &tee] {
            pipeline.add(e).map_err(|_| "media unavailable")?;
        }
        gst::Element::link_many([&source, &convert, &resample, &volume, &tee])
            .map_err(|_| "media unavailable")?;
        if pipeline.set_state(gst::State::Playing).is_err() {
            let _ = pipeline.set_state(gst::State::Null);
            return Err("media unavailable");
        }
        self.session = Some(Session {
            id,
            pipeline,
            tee,
            microphone_volume: volume,
            muted: !synthetic,
            peers: HashMap::new(),
            synthetic,
        });
        Ok(json!({}))
    }
    fn stop(&mut self) {
        if let Some(mut s) = self.session.take() {
            s.peers.clear();
            let _ = s.pipeline.set_state(gst::State::Null);
        }
    }
    fn create_peer(&mut self, v: &Value) -> Result<Value, &'static str> {
        let peer_id = identifier(v, "peer")?;
        let synthetic = self.session(v)?.synthetic;
        let (servers, expiry) = if synthetic {
            (Vec::new(), now() + 60)
        } else {
            turn_servers(v)?
        };
        let tx = self.tx.clone();
        self.next_generation += 1;
        let generation = self.next_generation;
        let s = self.session(v)?;
        if s.peers.contains_key(&peer_id) || s.peers.len() >= PEERS_MAX {
            return Err("peer limit");
        }
        let rtc = factory("webrtcbin")?;
        rtc.set_property_from_str("bundle-policy", "max-bundle");
        rtc.set_property_from_str(
            "ice-transport-policy",
            if synthetic { "all" } else { "relay" },
        );
        for server in &servers {
            let added: bool = rtc.emit_by_name("add-turn-server", &[server]);
            if !added {
                return Err("invalid credentials");
            }
        }
        let queue = factory("queue")?;
        let convert = factory("audioconvert")?;
        let resample = factory("audioresample")?;
        let enc = factory("opusenc")?;
        enc.set_property("bitrate", 32_000i32);
        let pay = factory("rtpopuspay")?;
        pay.set_property("pt", 96u32);
        let caps = factory("capsfilter")?;
        caps.set_property(
            "caps",
            gst::Caps::builder("application/x-rtp")
                .field("media", "audio")
                .field("encoding-name", "OPUS")
                .field("payload", 96i32)
                .field("clock-rate", 48_000i32)
                .build(),
        );
        let branch = vec![queue, convert, resample, enc, pay, caps];
        for e in branch.iter().chain(std::iter::once(&rtc)) {
            s.pipeline.add(e).map_err(|_| "media unavailable")?;
        }
        gst::Element::link_many(branch.iter().collect::<Vec<_>>())
            .map_err(|_| "media unavailable")?;
        branch
            .last()
            .unwrap()
            .link(&rtc)
            .map_err(|_| "media unavailable")?;
        let tee_pad = s
            .tee
            .request_pad_simple("src_%u")
            .ok_or("media unavailable")?;
        let queue_pad = branch[0].static_pad("sink").ok_or("media unavailable")?;
        tee_pad.link(&queue_pad).map_err(|_| "media unavailable")?;
        let sink_queue = factory("queue")?;
        let incoming_caps = factory("capsfilter")?;
        incoming_caps.set_property(
            "caps",
            gst::Caps::builder("application/x-rtp")
                .field("media", "audio")
                .field("encoding-name", "OPUS")
                .field("clock-rate", 48_000i32)
                .build(),
        );
        let depay = factory("rtpopusdepay")?;
        let dec = factory("opusdec")?;
        let sink_convert = factory("audioconvert")?;
        let sink_volume = factory("volume")?;
        let sink = factory(if synthetic { "fakesink" } else { "pulsesink" })?;
        sink.set_property("async", false);
        if synthetic {
            sink.set_property("sync", false);
            sink.set_property("signal-handoffs", true);
        }
        let output = vec![
            sink_queue,
            incoming_caps,
            depay,
            dec,
            sink_convert,
            sink_volume.clone(),
            sink,
        ];
        for e in &output {
            s.pipeline.add(e).map_err(|_| "media unavailable")?;
        }
        gst::Element::link_many(output.iter().collect::<Vec<_>>())
            .map_err(|_| "media unavailable")?;
        let output_pad = output[0].static_pad("sink").ok_or("media unavailable")?;
        rtc.connect_pad_added(move |_, pad| {
            // SDP permits one audio transceiver. The capsfilter enforces Opus even if
            // caps are not fixed at pad-added time.
            if !output_pad.is_linked() {
                let _ = pad.link(&output_pad);
            }
        });
        let sid = s.id.clone();
        let pid = peer_id.clone();
        let ice_tx = tx.clone();
        rtc.connect("on-ice-candidate",false,move |values|{
            let idx=values.get(1).and_then(|v|v.get::<u32>().ok()).unwrap_or(0);
            let candidate=values.get(2).and_then(|v|v.get::<String>().ok()).unwrap_or_default();
            if (synthetic && candidate.starts_with("candidate:")) || candidate_ok(&candidate){let _=ice_tx.try_send(Message::Event(json!({"v":1,"event":"ice","session":sid,"peer":pid,"candidate":{"candidate":candidate,"sdpMLineIndex":idx},"__generation":generation})));}
            None
        });
        let sid = s.id.clone();
        let pid = peer_id.clone();
        let state_tx = tx.clone();
        rtc.connect("on-negotiation-needed", false, move |_| {
            let _ = tx.try_send(Message::Event(
                json!({"v":1,"event":"negotiation","session":sid,"peer":pid,"__generation":generation}),
            ));
            None
        });
        let state_sid = s.id.clone();
        let state_pid = peer_id.clone();
        rtc.connect_notify(Some("connection-state"),move |obj,_|{
            let state=obj.property::<gstreamer_webrtc::WebRTCPeerConnectionState>("connection-state");
            let name=match state{
                gstreamer_webrtc::WebRTCPeerConnectionState::New=>"new",
                gstreamer_webrtc::WebRTCPeerConnectionState::Connecting=>"connecting",
                gstreamer_webrtc::WebRTCPeerConnectionState::Connected=>"connected",
                gstreamer_webrtc::WebRTCPeerConnectionState::Disconnected=>"disconnected",
                gstreamer_webrtc::WebRTCPeerConnectionState::Failed=>"failed",
                gstreamer_webrtc::WebRTCPeerConnectionState::Closed=>"closed",
                _=>"failed"
            };
            let _=state_tx.try_send(Message::Event(json!({"v":1,"event":"state","session":state_sid,"peer":state_pid,"state":name,"__generation":generation})));
        });
        for e in branch
            .iter()
            .chain(output.iter())
            .chain(std::iter::once(&rtc))
        {
            e.sync_state_with_parent()
                .map_err(|_| "media unavailable")?;
        }
        s.peers.insert(
            peer_id,
            Peer {
                rtc,
                branch,
                tee_pad,
                sink: output,
                volume: sink_volume,
                expires_at: expiry,
                local_candidates: 0,
                remote_candidates: 0,
                descriptions: 0,
                generation,
                turn_updates: 0,
                opus_payload: 96,
            },
        );
        Ok(json!({}))
    }
    fn close_peer(&mut self, v: &Value) -> Result<Value, &'static str> {
        let id = identifier(v, "peer")?;
        let s = self.session(v)?;
        if let Some(p) = s.peers.remove(&id) {
            s.tee.release_request_pad(&p.tee_pad);
            for e in p
                .branch
                .iter()
                .chain(p.sink.iter())
                .chain(std::iter::once(&p.rtc))
            {
                let _ = e.set_state(gst::State::Null);
                let _ = s.pipeline.remove(e);
            }
        }
        Ok(json!({}))
    }
    fn description(&mut self, v: &Value, local: bool) -> Result<Value, &'static str> {
        let p = self.peer(v)?;
        if p.descriptions >= DESCRIPTIONS_MAX {
            return Err("description limit");
        }
        if local {
            let kind = text(v, "type", 16)?;
            if !matches!(kind, "offer" | "answer") {
                return Err("invalid description");
            }
            if v.get("ice_restart").is_some()
                && v.get("ice_restart").and_then(Value::as_bool).is_none()
            {
                return Err("invalid description");
            }
            let desc = create_description(
                &p.rtc,
                kind,
                v.get("ice_restart").and_then(Value::as_bool) == Some(true),
            )?;
            let sdp = desc
                .sdp()
                .as_text()
                .map_err(|_| "media negotiation failed")?;
            valid_sdp(&sdp)?;
            promise(&p.rtc, "set-local-description", Some(&desc))?;
            p.descriptions += 1;
            Ok(json!({"type":kind,"sdp":sdp}))
        } else {
            let d = v.get("description").ok_or("invalid description")?;
            let kind = text(d, "type", 16)?;
            if kind == "rollback" {
                promise(&p.rtc, "set-local-description", Some(&rollback()))?;
                p.descriptions += 1;
                return Ok(json!({}));
            }
            let sdp = d
                .get("sdp")
                .and_then(Value::as_str)
                .ok_or("invalid description")?;
            let payload = opus_payload(sdp)?;
            let desc = parse_description(kind, sdp)?;
            if kind == "offer" {
                set_opus_payload(p, payload);
            } else if kind == "answer" && payload != p.opus_payload {
                return Err("invalid description");
            }
            promise(&p.rtc, "set-remote-description", Some(&desc))?;
            p.descriptions += 1;
            Ok(json!({}))
        }
    }
    fn ice(&mut self, v: &Value) -> Result<Value, &'static str> {
        let synthetic = self.session(v)?.synthetic;
        let p = self.peer(v)?;
        if p.remote_candidates >= CANDIDATES_MAX {
            return Err("candidate limit");
        }
        let c = v.get("candidate").ok_or("invalid candidate")?;
        let line = text(c, "candidate", ICE_MAX)?;
        if !candidate_ok(line) && !(synthetic && line.starts_with("candidate:")) {
            return Err("invalid candidate");
        }
        let idx = c
            .get("sdpMLineIndex")
            .and_then(Value::as_u64)
            .ok_or("invalid candidate")?;
        if idx != 0 {
            return Err("invalid candidate");
        }
        p.rtc
            .emit_by_name::<()>("add-ice-candidate", &[&(idx as u32), &line]);
        p.remote_candidates += 1;
        Ok(json!({}))
    }
    fn configure(&mut self, v: &Value) -> Result<Value, &'static str> {
        let (servers, expiry) = turn_servers(v)?;
        let p = self.peer(v)?;
        // webrtcbin adds TURN servers; bound refresh additions to the three
        // negotiated ICE restart allowances for this peer lifetime.
        if p.turn_updates >= 3 {
            return Err("credential refresh limit");
        }
        for server in &servers {
            let added: bool = p.rtc.emit_by_name("add-turn-server", &[server]);
            if !added {
                return Err("invalid credentials");
            }
        }
        p.expires_at = expiry;
        p.turn_updates += 1;
        Ok(json!({}))
    }
    fn handle(&mut self, v: &Value) -> Result<Value, &'static str> {
        if v.get("v").and_then(Value::as_u64) != Some(1) {
            return Err("invalid protocol");
        }
        match text(v, "op", 32)? {
            "probe" => {
                let required = [
                    "webrtcbin",
                    "pulsesrc",
                    "pulsesink",
                    "opusenc",
                    "opusdec",
                    "rtpopuspay",
                    "rtpopusdepay",
                    "tee",
                    "volume",
                    "audioconvert",
                    "audioresample",
                    "capsfilter",
                    "queue",
                    "nicesrc",
                    "nicesink",
                    "dtlssrtpenc",
                    "dtlssrtpdec",
                    "srtpenc",
                    "srtpdec",
                    "rtpbin",
                ];
                if required
                    .iter()
                    .any(|n| gst::ElementFactory::find(n).is_none())
                {
                    return Err("media unavailable");
                }
                let rtc = factory("webrtcbin")?;
                rtc.set_property_from_str("ice-transport-policy", "relay");
                Ok(
                    json!({"available":true,"backend":"gstreamer","version":gst::version_string().to_string()}),
                )
            }
            "start" => self.start(v),
            "stop" => {
                self.session(v)?;
                self.stop();
                Ok(json!({}))
            }
            "peer_create" => {
                let result = self.create_peer(v);
                if matches!(result, Err("media unavailable")) {
                    self.stop();
                }
                result
            }
            "peer_close" => self.close_peer(v),
            "local_description" | "remote_description" => {
                let result = self.description(
                    v,
                    v.get("op").and_then(Value::as_str) == Some("local_description"),
                );
                if matches!(result, Err("media negotiation failed")) {
                    let _ = self.close_peer(v);
                }
                result
            }
            "ice" => self.ice(v),
            "configure" => self.configure(v),
            "mute" => {
                let muted = bool_field(v, "muted")?;
                let s = self.session(v)?;
                s.microphone_volume
                    .set_property("volume", if muted { 0.0f64 } else { 1.0 });
                s.muted = muted;
                Ok(json!({}))
            }
            "volume" => {
                let level = v
                    .get("volume")
                    .and_then(Value::as_f64)
                    .ok_or("invalid volume")?;
                if !(0.0..=1.0).contains(&level) {
                    return Err("invalid volume");
                }
                let p = self.peer(v)?;
                p.volume.set_property("volume", level);
                Ok(json!({}))
            }
            "stats" => {
                self.peer(v)?;
                Ok(json!({"audioLevel":null}))
            }
            _ => Err("invalid operation"),
        }
    }
    fn expire(&mut self) -> Vec<Value> {
        let mut events = Vec::new();
        let ids: Vec<(String, String)> = self
            .session
            .as_ref()
            .map(|s| {
                s.peers
                    .iter()
                    .filter(|(_, p)| p.expires_at <= now())
                    .map(|(id, _)| (s.id.clone(), id.clone()))
                    .collect()
            })
            .unwrap_or_default();
        for (session, peer) in ids {
            events.push(json!({"v":1,"event":"ended","session":session,"peer":peer,"state":"credentials-expired"}));
            let fake = json!({"session":session,"peer":peer});
            let _ = self.close_peer(&fake);
        }
        events
    }
}
fn input_thread(tx: SyncSender<Message>) {
    thread::spawn(move || {
        let stdin = io::stdin();
        let mut reader = stdin.lock();
        let mut line = Vec::new();
        while let Ok(available) = reader.fill_buf() {
            if available.is_empty() {
                break;
            }
            let mut used = 0;
            let mut done = false;
            for b in available {
                used += 1;
                if line.len() >= FRAME_MAX {
                    std::process::exit(1);
                }
                line.push(*b);
                if *b == b'\n' {
                    done = true;
                    break;
                }
            }
            reader.consume(used);
            if done {
                let input = String::from_utf8(std::mem::take(&mut line));
                match input {
                    Ok(s) => {
                        if tx.try_send(Message::Input(s)).is_err() {
                            std::process::exit(1);
                        }
                    }
                    Err(_) => {
                        std::process::exit(1);
                    }
                }
            }
        }
        // Parent pipe EOF must close native media even if GStreamer has stalled
        // the main worker thread inside a promise wait.
        std::process::exit(0);
    });
}
fn run(rx: Receiver<Message>, tx: SyncSender<Message>) -> io::Result<()> {
    let mut worker = Worker {
        session: None,
        tx,
        next_generation: 0,
    };
    loop {
        let failed = worker
            .session
            .as_ref()
            .and_then(|s| s.pipeline.bus())
            .and_then(|bus| bus.pop_filtered(&[gst::MessageType::Error, gst::MessageType::Eos]))
            .is_some();
        if failed {
            if let Some(s) = worker.session.as_ref() {
                safe_write(&json!({"v":1,"event":"ended","session":s.id,"state":"media-failed"}))?;
            }
            worker.stop();
        }
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(Message::Event(mut event)) => {
                if let Some(peer) = event.get("peer").and_then(Value::as_str) {
                    let generation = event.get("__generation").and_then(Value::as_u64);
                    let session = event.get("session").and_then(Value::as_str).unwrap_or("");
                    let valid = worker
                        .session
                        .as_ref()
                        .filter(|s| s.id == session)
                        .and_then(|s| s.peers.get(peer))
                        .map(|p| Some(p.generation) == generation)
                        .unwrap_or(false);
                    if !valid {
                        continue;
                    }
                }
                if let Some(obj) = event.as_object_mut() {
                    obj.remove("__generation");
                }
                if event.get("event").and_then(Value::as_str) == Some("ice") {
                    let id = event.get("peer").and_then(Value::as_str).unwrap_or("");
                    if let Some(p) = worker.session.as_mut().and_then(|s| s.peers.get_mut(id)) {
                        if p.local_candidates >= CANDIDATES_MAX {
                            continue;
                        }
                        p.local_candidates += 1;
                    } else {
                        continue;
                    }
                }
                safe_write(&event)?;
            }
            Ok(Message::Input(raw)) => {
                let parsed: Result<Value, _> = serde_json::from_str(&raw);
                let v = parsed.unwrap_or(Value::Null);
                let id = v.get("id").and_then(Value::as_u64).unwrap_or(0);
                let response = if id == 0 || id > u32::MAX as u64 {
                    json!({"v":1,"id":id,"ok":false,"error":"invalid protocol"})
                } else {
                    match worker.handle(&v) {
                        Ok(result) => json!({"v":1,"id":id,"ok":true,"result":result}),
                        Err(error) => json!({"v":1,"id":id,"ok":false,"error":error}),
                    }
                };
                safe_write(&response)?;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(_) => break,
        }
        for event in worker.expire() {
            safe_write(&event)?;
        }
    }
    worker.stop();
    Ok(())
}
fn self_test() -> Result<(), &'static str> {
    let pipeline_text="webrtcbin name=rtc bundle-policy=max-bundle ice-transport-policy=relay audiotestsrc is-live=true wave=silence ! audioconvert ! audioresample ! opusenc bitrate=32000 ! rtpopuspay pt=96 ! application/x-rtp,media=audio,encoding-name=OPUS,payload=96,clock-rate=48000 ! rtc.";
    let mut pipelines = Vec::new();
    let test = (|| {
        for _ in 0..2 {
            let p = gst::parse::launch(pipeline_text)
                .map_err(|_| "synthetic pipeline failed")?
                .downcast::<gst::Pipeline>()
                .map_err(|_| "synthetic pipeline failed")?;
            p.set_state(gst::State::Playing)
                .map_err(|_| "synthetic pipeline failed")?;
            if p.state(gst::ClockTime::from_seconds(5)).1 != gst::State::Playing {
                return Err("synthetic pipeline failed");
            }
            pipelines.push(p);
        }
        let first = pipelines[0]
            .by_name("rtc")
            .ok_or("synthetic pipeline failed")?;
        let second = pipelines[1]
            .by_name("rtc")
            .ok_or("synthetic pipeline failed")?;
        let offer = create_description(&first, "offer", false)?;
        promise(&first, "set-local-description", Some(&offer))?;
        promise(&second, "set-remote-description", Some(&offer))?;
        let answer = create_description(&second, "answer", false)?;
        promise(&second, "set-local-description", Some(&answer))?;
        promise(&first, "set-remote-description", Some(&answer))?;
        let stable = gstreamer_webrtc::WebRTCSignalingState::Stable;
        if first.property::<gstreamer_webrtc::WebRTCSignalingState>("signaling-state") != stable
            || second.property::<gstreamer_webrtc::WebRTCSignalingState>("signaling-state")
                != stable
        {
            return Err("synthetic negotiation failed");
        }
        Ok(())
    })();
    for p in pipelines.into_iter().rev() {
        let _ = p.set_state(gst::State::Null);
        let _ = p.state(gst::ClockTime::from_seconds(3));
    }
    test
}
fn media_self_test() -> Result<(), &'static str> {
    let (tx_a, rx_a) = mpsc::sync_channel(128);
    let (tx_b, rx_b) = mpsc::sync_channel(128);
    let mut a = Worker {
        session: None,
        tx: tx_a,
        next_generation: 0,
    };
    let mut b = Worker {
        session: None,
        tx: tx_b,
        next_generation: 0,
    };
    let test = (|| {
        a.start_inner(&json!({"session":"a"}), true)?;
        b.start_inner(&json!({"session":"b"}), true)?;
        a.handle(&json!({"v":1,"op":"peer_create","session":"a","peer":"b"}))?;
        b.handle(&json!({"v":1,"op":"peer_create","session":"b","peer":"a"}))?;

        // Emulate the browser's common Opus PT 111 on the offerer. The other
        // worker must reconfigure its production sender before answering.
        set_opus_payload(a.session.as_mut().unwrap().peers.get_mut("b").unwrap(), 111);
        let hits_a = Arc::new(AtomicUsize::new(0));
        let hits_b = Arc::new(AtomicUsize::new(0));
        for (worker, peer_id, hits) in [(&a, "b", hits_a.clone()), (&b, "a", hits_b.clone())] {
            let sink = worker
                .session
                .as_ref()
                .unwrap()
                .peers
                .get(peer_id)
                .unwrap()
                .sink
                .last()
                .unwrap();
            sink.connect("handoff", false, move |_| {
                hits.fetch_add(1, Ordering::Relaxed);
                None
            });
        }
        let offer = a.handle(
            &json!({"v":1,"op":"local_description","session":"a","peer":"b","type":"offer"}),
        )?;
        let offer_sdp = offer
            .get("sdp")
            .and_then(Value::as_str)
            .ok_or("synthetic negotiation failed")?;
        if opus_payload(offer_sdp)? != 111 {
            return Err("synthetic payload mismatch");
        }
        b.handle(
            &json!({"v":1,"op":"remote_description","session":"b","peer":"a","description":offer}),
        )?;
        let answer = b.handle(
            &json!({"v":1,"op":"local_description","session":"b","peer":"a","type":"answer"}),
        )?;
        let answer_sdp = answer
            .get("sdp")
            .and_then(Value::as_str)
            .ok_or("synthetic negotiation failed")?;
        if opus_payload(answer_sdp)? != 111 {
            return Err("synthetic payload mismatch");
        }
        a.handle(
            &json!({"v":1,"op":"remote_description","session":"a","peer":"b","description":answer}),
        )?;

        let deadline = Instant::now() + Duration::from_secs(10);
        let mut candidates = [0usize; 2];
        let mut states = [String::new(), String::new()];
        while Instant::now() < deadline {
            for (side, receiver, destination, session, peer) in
                [(0, &rx_a, &mut b, "b", "a"), (1, &rx_b, &mut a, "a", "b")]
            {
                while let Ok(message) = receiver.try_recv() {
                    if let Message::Event(event) = message {
                        if event.get("event").and_then(Value::as_str) == Some("ice") {
                            candidates[side] += 1;
                            let candidate = event.get("candidate").ok_or("synthetic ICE failed")?;
                            destination.handle(&json!({"v":1,"op":"ice","session":session,"peer":peer,"candidate":candidate}))?;
                        } else if event.get("event").and_then(Value::as_str) == Some("state") {
                            states[side] = event
                                .get("state")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_owned();
                            if states[side] == "failed" {
                                return Err("synthetic ICE failed");
                            }
                        }
                    }
                }
            }
            if hits_a.load(Ordering::Relaxed) >= 10 && hits_b.load(Ordering::Relaxed) >= 10 {
                return Ok(());
            }
            while gst::glib::MainContext::default().iteration(false) {}
            thread::sleep(Duration::from_millis(20));
        }
        eprintln!(
            "synthetic media counters: {:?} candidates: {:?} states: {:?}",
            [
                hits_a.load(Ordering::Relaxed),
                hits_b.load(Ordering::Relaxed)
            ],
            candidates,
            states
        );
        for w in [&a, &b] {
            let session = w.session.as_ref().unwrap();
            let peer = session.peers.values().next().unwrap();
            eprintln!("synthetic pipeline state {:?} rtc state {:?} ICE {:?} ICE connection {:?} connection {:?}", session.pipeline.state(gst::ClockTime::from_seconds(1)).1,
                peer.rtc.state(gst::ClockTime::from_seconds(1)).1,
                peer.rtc.property::<gstreamer_webrtc::WebRTCICEGatheringState>("ice-gathering-state"),
                peer.rtc.property::<gstreamer_webrtc::WebRTCICEConnectionState>("ice-connection-state"),
                peer.rtc.property::<gstreamer_webrtc::WebRTCPeerConnectionState>("connection-state"));
            if let Some(bus) = session.pipeline.bus() {
                while let Some(msg) = bus.pop() {
                    if let gst::MessageView::Error(err) = msg.view() {
                        eprintln!("synthetic bus error {}", err.error());
                    }
                }
            }
        }
        Err("synthetic decoded audio timeout")
    })();
    a.stop();
    b.stop();
    test
}
fn main() {
    let args: Vec<String> = std::env::args().collect();
    let test_mode = args.len() == 2 && args[1] == "--self-test";
    if args.len() != 1 && !test_mode {
        std::process::exit(2);
    }
    if gst::init().is_err() {
        std::process::exit(1);
    }
    if test_mode {
        match self_test().and_then(|_| media_self_test()) {
            Ok(()) => {
                println!("PASS synthetic Opus SDP, ICE and bidirectional decoded audio");
                return;
            }
            Err(e) => {
                eprintln!("FAIL {e}");
                std::process::exit(1);
            }
        }
    }
    let (tx, rx) = mpsc::sync_channel(128);
    input_thread(tx.clone());
    if run(rx, tx).is_err() {
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn relay_candidate_only() {
        assert!(candidate_ok(
            "candidate:abc 1 udp 2122 43.204.79.244 51000 typ relay raddr 0.0.0.0 rport 0"
        ));
        for c in [
            "candidate:abc 1 udp 2122 127.0.0.1 51000 typ relay",
            "candidate:abc 1 udp 2122 10.0.0.1 51000 typ host",
            "candidate:abc 2 udp 2122 43.204.79.244 51000 typ relay",
            "candidate:abc 1 udp 2122 43.204.79.244 0 typ relay",
            "candidate:abc 1 xyz 2122 43.204.79.244 51000 typ relay",
        ] {
            assert!(!candidate_ok(c), "accepted {c}");
        }
    }
    #[test]
    fn turn_allowlist_and_expiry() {
        let expires_at = now() + 120;
        let valid = json!({"ice_servers":[{"urls":["turn:turn.amsaccess.com:3478?transport=udp","turns:43.204.79.244:5349?transport=tcp"],"username":"a:b","credential":"p@ss"}],"expires_at":expires_at});
        let (urls, _) = turn_servers(&valid).unwrap();
        assert_eq!(urls.len(), 2);
        assert!(urls[0].contains("a%3Ab:p%40ss@"));
        assert!(urls[0].ends_with("?transport=udp"));
        assert!(urls[1].ends_with("?transport=tcp"));
        let tls = json!({"ice_servers":[{"urls":"turns:turn.amsaccess.com:443?transport=tcp","username":"u","credential":"p"}],"expires_at":expires_at});
        let (tls_urls, _) = turn_servers(&tls).unwrap();
        assert!(tls_urls[0].starts_with("turns://u:p@turn.amsaccess.com:443"));
        assert!(tls_urls[0].ends_with("?transport=tcp"));
        gst::init().unwrap();
        let rtc = factory("webrtcbin").unwrap();
        for url in &urls {
            let added: bool = rtc.emit_by_name("add-turn-server", &[url]);
            assert!(added, "GStreamer rejected TURN URL");
        }
        let added: bool = rtc.emit_by_name("add-turn-server", &[&tls_urls[0]]);
        assert!(added, "GStreamer rejected deployed TLS TURN URL");
        for bad in [
            "turn:evil.example:3478",
            "stun:turn.amsaccess.com:3478",
            "turn:turn.amsaccess.com:9999",
            "turn:turn.amsaccess.com:3478?transport=evil",
            "turn:turn.amsaccess.com:443?transport=tcp",
            "turns:turn.amsaccess.com:443?transport=udp",
            "turn:turn.amsaccess.com.evil:3478",
        ] {
            let v = json!({"ice_servers":[{"urls":bad,"username":"u","credential":"p"}],"expires_at":expires_at});
            assert!(turn_servers(&v).is_err(), "accepted {bad}");
        }
        let expired = json!({"ice_servers":[{"urls":"turn:turn.amsaccess.com:3478","username":"u","credential":"p"}],"expires_at":now()-1});
        assert!(turn_servers(&expired).is_err());
    }
    #[test]
    fn sdp_audio_only_and_relay_only() {
        let base =
            "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 96\r\na=sendrecv\r\na=rtpmap:96 opus/48000\r\n";
        assert!(valid_sdp(base).is_ok());
        assert_eq!(opus_payload(base), Ok(96));
        assert!(valid_sdp(&base.replace("SAVPF 96", "SAVPF 111")).is_err());
        assert!(valid_sdp(&base.replace(" 96\r\n", " 128\r\n").replace(":96 ", ":128 ")).is_err());
        assert!(valid_sdp(&base.replace("m=audio 9", "m=audio 0")).is_err());
        assert!(valid_sdp(&base.replace("m=audio", "m=video")).is_err());
        assert!(valid_sdp(&format!(
            "{base}m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n"
        ))
        .is_err());
        assert!(valid_sdp(&format!(
            "{base}a=candidate:abc 1 udp 1 10.0.0.1 1234 typ host\r\n"
        ))
        .is_err());
    }
    #[test]
    fn remote_offer_handler_adopts_browser_opus_payload() {
        gst::init().unwrap();
        let (tx_a, _rx_a) = mpsc::sync_channel(128);
        let (tx_b, _rx_b) = mpsc::sync_channel(128);
        let mut offerer = Worker {
            session: None,
            tx: tx_a,
            next_generation: 0,
        };
        let mut answerer = Worker {
            session: None,
            tx: tx_b,
            next_generation: 0,
        };
        let result = (|| -> Result<(), &'static str> {
            offerer.start_inner(&json!({"session":"offerer"}), true)?;
            answerer.start_inner(&json!({"session":"answerer"}), true)?;
            offerer
                .handle(&json!({"v":1,"op":"peer_create","session":"offerer","peer":"answerer"}))?;
            answerer
                .handle(&json!({"v":1,"op":"peer_create","session":"answerer","peer":"offerer"}))?;
            set_opus_payload(
                offerer
                    .session
                    .as_mut()
                    .unwrap()
                    .peers
                    .get_mut("answerer")
                    .unwrap(),
                111,
            );
            let offer = offerer.handle(&json!({"v":1,"op":"local_description","session":"offerer","peer":"answerer","type":"offer"}))?;
            answerer.handle(&json!({"v":1,"op":"remote_description","session":"answerer","peer":"offerer","description":offer}))?;
            let peer = answerer
                .session
                .as_ref()
                .unwrap()
                .peers
                .get("offerer")
                .unwrap();
            assert_eq!(peer.opus_payload, 111);
            assert_eq!(peer.branch[4].property::<u32>("pt"), 111);
            let caps = peer.branch[5].property::<gst::Caps>("caps");
            assert_eq!(
                caps.structure(0).unwrap().get::<i32>("payload").unwrap(),
                111
            );
            Ok(())
        })();
        offerer.stop();
        answerer.stop();
        result.unwrap();
    }
}
