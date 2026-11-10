import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const ui = readFileSync(new URL("./components/TeamVoiceControls.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("./client.tsx", import.meta.url), "utf8");
test("Desktop adapter retains lifecycle boundaries and mandatory overlay priority", () => {
  assert.match(
    ui.replace(/\s+/g, " "),
    /!supportsTeamDesktopWebView\( Boolean\(window\.__TAURI__\), navigator.platform, navigator.userAgent \)/
  );
  assert.match(ui, /generation === authGeneration\(\).*token === participantToken\(\)/);
  assert.match(ui, /subscribeAuthChanges\(terminate\)/);
  assert.match(ui, /addEventListener\("pagehide", terminate\)/);
  assert.match(ui, /addEventListener\("beforeunload", terminate\)/);
  assert.match(ui, /if \(!available\) \{[\s\S]*?session.current\?\.stop\(\)/);
  assert.doesNotMatch(ui, /pollVoiceTeam/);
  assert.match(ui, /voiceProjectionDecision\(\{[\s\S]*?status: projection.status/);
  assert.match(ui, /decision === "keep"\) return;/);
  assert.match(ui, /inert=\{suspended/);
  assert.match(
    client.replace(/\s+/g, " "),
    /enabled=\{ entryReady && Boolean\(sessionId\) && !isDryRun && !bellRung && !sessionEnded && contestPhase !== "ended" \}/
  );
});

test("missing WebRTC blocks connection before session creation or microphone capture", async () => {
  // Execute the actual connect body, with the closed capability branch and spies
  // for resources that must never be acquired on unsupported WebViews.
  const body = ui
    .match(/async function connect\(\) \{([\s\S]*?)\n  \}\n\n  connectCurrent/)[1]
    .replaceAll("lifecycle!", "lifecycle");
  let sessions = 0;
  let microphones = 0;
  const messages = [];
  const run = new Function(
    "supportsRtc",
    "current",
    "lifecycleAbort",
    "open",
    "setMessage",
    "createTeamVoiceSession",
    "acquireVoiceMicrophone",
    `return (async function () { ${body} })();`
  );
  await run(
    false,
    { current: () => true },
    { current: {} },
    { current: true },
    (message) => messages.push(message),
    () => {
      sessions += 1;
    },
    () => {
      microphones += 1;
    }
  );
  assert.equal(sessions, 0);
  assert.equal(microphones, 0);
  assert.deepEqual(messages, [
    "Team voice is unavailable in this installed app because WebRTC support is missing.",
  ]);
  assert.match(ui, /const supportsRtc = typeof RTCPeerConnection === "function"/);
  assert.match(
    ui,
    /!supportsRtc\s*\? "Voice unavailable · WebRTC support is missing in this installed app"/
  );
  assert.match(ui, /isDisabled=\{!supportsRtc \|\| busy \|\| !open.current\}/);
});

test("team paper load never gates on a team status and fails closed without a label", () => {
  const flat = client.replace(/\s+/g, " ");
  assert.doesNotMatch(flat, /desktopTeamRoom && lobbyState\.status === "team"/);
  assert.match(flat, /const teamRoom = desktopTeamRoom && lobbyState\.status !== "solo";/);
  assert.match(flat, /if \(teamRoom && !teamOwnLabel\) return;/);
  assert.match(
    flat,
    /loadContestPaper\( contestId, teamRoom \? \(teamOwnLabel \?\? undefined\) : undefined \)/
  );
  assert.match(
    flat,
    /teamRoom \? paper\.questions\.filter\(\(question\) => question\.id === teamOwnLabel\)/
  );
  assert.match(ui, /Team status is reconnecting\. Your work is safe\./);
});

test("unsupported native clients probe the round before any paper fetch and block team rounds", () => {
  const flat = client.replace(/\s+/g, " ");
  // Same native gate as desktopTeamRoom, inverted: Tauri required, team WebView rejected.
  assert.match(
    flat,
    /const nativeTeamUnsupported = entryReady && !isDryRun && typeof window !== "undefined" && Boolean\(window\.__TAURI__\) && !supportsTeamDesktopWebView\(Boolean\(window\.__TAURI__\), navigator\.platform, navigator\.userAgent\);/
  );
  // A result is honoured only for the contest and auth identity that probed.
  assert.match(
    flat,
    /teamProbe && teamProbe\.contestId === contestId && teamProbe\.generation === authGeneration\(\) && teamProbe\.token === participantToken\(\) \? teamProbe\.result : null/
  );
  // The probe effect: only for unsupported native clients, aborted on auth change
  // and unmount, one request in flight, bounded backoff on "error".
  const probe = flat.match(
    /useEffect\(\(\) => \{ if \(!nativeTeamUnsupported \|\| !contestId\) return;([\s\S]*?)\}, \[nativeTeamUnsupported, contestId\]\);/
  );
  assert.ok(probe, "probe effect present and keyed on the gate and contest");
  const body = probe[1];
  assert.match(
    body,
    /probeTeamRound\(\{ apiBase: API_URL, contestUid: contestId, headers: authHeaders\(\), signal: controller\.signal, \}\)/
  );
  assert.match(body, /subscribeAuthChanges\(stop\)/);
  assert.match(body, /active\?\.abort\(\)/);
  assert.match(body, /if \(stopped \|\| !current\(\)\) return;/);
  assert.match(body, /attempt < 3 \? 2000 \* 2 \*\* attempt : 15_000/);
  assert.ok(
    body.indexOf("if (stopped || !current()) return;") < body.indexOf("setTeamProbe("),
    "stale identity is fenced before the result is stored"
  );
  assert.doesNotMatch(body, /setInterval/);

  // The paper load: the probe gate sits after the existing early returns and
  // before the first network call of the effect.
  const start = flat.indexOf("useEffect(() => { if (!entryReady || showTeamLobby) return;");
  assert.ok(start > 0);
  const end = flat.indexOf(
    "}, [ contestId, loadAttempt, entryReady, showTeamLobby, teamOwnLabel, nativeTeamUnsupported, teamProbeResult, ]);",
    start
  );
  assert.ok(end > start, "load effect re-runs when the probe resolves");
  const load = flat.slice(start, end);
  const gate = load.indexOf('if (nativeTeamUnsupported && teamProbeResult !== "solo") {');
  assert.ok(gate > load.indexOf("if (teamRoom && !teamOwnLabel) return;"));
  assert.ok(gate < load.indexOf("getSession("));
  assert.ok(gate < load.indexOf("loadContestPaper("));
  assert.ok(gate < load.indexOf("redirectAfterRelease("));
  assert.match(
    load,
    /if \(nativeTeamUnsupported && teamProbeResult !== "solo"\) \{ if \(teamProbeResult === "team"\) \{ setLoadError\( "This is a team round\. Team rounds need the AMS Access app on Windows or Linux\. Contact your organizer\." \); setLoadRetryable\(false\); setLoading\(false\); \} return; \}/
  );
});
