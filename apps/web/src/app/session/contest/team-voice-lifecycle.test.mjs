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
    /loadContestPaper\( contestId, teamRoom \? teamWorkspaceLabels\(lobbyState\) : undefined \)/
  );
  assert.match(
    flat,
    /labels\.flatMap\(\(label\) => paper\.questions\.filter\(\(question\) => question\.id === label\)\)/
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
  // The probe effect: only for unsupported native clients, stopped on auth change
  // and unmount. Its retry loop (one request in flight, 8 s abort, bounded
  // backoff on "error", identity fence) is startTeamRoundProbeLoop, covered
  // behaviourally in team-lobby.test.mjs.
  const probe = flat.match(
    /useEffect\(\(\) => \{ if \(!nativeTeamUnsupported \|\| !contestId\) return;([\s\S]*?)\}, \[nativeTeamUnsupported, contestId, teamProbeRound\]\);/
  );
  assert.ok(probe, "probe effect present and keyed on the gate and contest");
  const body = probe[1];
  assert.match(body, /const stop = startTeamRoundProbeLoop\(\{/);
  assert.match(body, /round: teamProbeRound,/);
  assert.match(
    body,
    /probe: \(signal\) => probeTeamRound\(\{ apiBase: API_URL, contestUid: contestId, headers: authHeaders\(\), signal, \}\)/
  );
  assert.match(
    body,
    /isCurrent: \(\) => generation === authGeneration\(\) && token === participantToken\(\)/
  );
  assert.match(
    body,
    /onResult: \(result\) => setTeamProbe\(\{ contestId, generation, token, result \}\)/
  );
  assert.match(body, /setTimeout: \(fn, ms\) => setTimeout\(fn, ms\)/);
  assert.match(body, /clearTimeout: \(handle\) => clearTimeout\(handle\)/);
  assert.match(body, /random: Math\.random/);
  assert.match(body, /subscribeAuthChanges\(stop\)/);
  assert.match(body, /return \(\) => \{ unsubscribe\(\); stop\(\); \};/);
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
  const gate = load.indexOf(
    'if (nativeTeamUnsupported && teamProbeResult !== "solo" && teamProbeResult !== "defer") {'
  );
  assert.ok(gate > load.indexOf("if (teamRoom && !teamOwnLabel) return;"));
  assert.ok(gate < load.indexOf("getSession("));
  assert.ok(gate < load.indexOf("loadContestPaper("));
  assert.ok(gate < load.indexOf("redirectAfterRelease("));
  // A defer pass (a 401 or another definite refusal) reaches the session read,
  // but the paper fetch itself still requires "solo": the in-flight gate sits
  // after getSession, before the fetch.
  const paperGate = load.indexOf(
    'if (nativeTeamUnsupported && teamProbeResult !== "solo") { // The session is good'
  );
  assert.ok(paperGate > load.indexOf("const live = await getSession("));
  assert.ok(paperGate < load.indexOf("const paper = await loadContestPaper("));
  assert.match(
    load.slice(paperGate, load.indexOf("const paper = await loadContestPaper(")),
    /setTeamProbe\(null\); setTeamProbeRound\(\(n\) => n \+ 1\);[\s\S]*?setLoading\(true\); return; \}/
  );
  assert.match(
    load,
    /if \(nativeTeamUnsupported && teamProbeResult !== "solo" && teamProbeResult !== "defer"\) \{ if \(teamProbeResult === "team"\) \{ setLoadError\( "This is a team round\. Team rounds need the AMS Access app on Windows, macOS or Linux\. Contact your organizer\." \); setLoadRetryable\(false\); setLoading\(false\); \} return; \}/
  );
});

test("reconnecting line only shows with a last good board (#312)", () => {
  // Evaluate the real projectionMessage expression from the component source.
  const expr = ui.match(/const projectionMessage =([\s\S]*?);\n/)[1];
  const run = (projection, team) =>
    new Function("projection", "team", `return (${expr});`)(projection, team);
  assert.equal(
    run({ status: "error", board: { id: "t" } }, { id: "t" }),
    "Team status is reconnecting. Your work is safe."
  );
  assert.equal(run({ status: "error", board: null }, null), "Team status is unavailable.");
  assert.equal(run({ status: "ok", board: null }, null), null);
  assert.equal(run({ status: "unpublished", board: null }, null), null);
});

test("mute shortcut captures before editor, consumes repeats and respects lifecycle guards", () => {
  const source = ui.match(/function muteShortcut\(event: KeyboardEvent\) \{([\s\S]*?)\n    \}/)[1];
  const handler = new Function(
    "session",
    "suspended",
    "current",
    `return function(event) { ${source} };`
  );
  assert.match(ui, /addEventListener\("keydown", muteShortcut, true\)/);
  assert.match(ui, /removeEventListener\("keydown", muteShortcut, true\)/);
  let muted = true;
  let toggles = 0;
  const session = {
    current: {
      getSnapshot: () => ({ muted }),
      setMuted: (value) => {
        muted = value;
        toggles++;
      },
    },
  };
  function dispatch(overrides = {}, suspended = false, valid = true, active = session) {
    let prevented = false,
      stopped = false,
      editorCommands = 0;
    const event = {
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
      code: "KeyM",
      repeat: false,
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {
        stopped = true;
      },
      ...overrides,
    };
    handler(active, suspended, { current: () => valid })(event);
    // A target editor receives only events not stopped by the window capture handler.
    if (!stopped) editorCommands++;
    return { prevented, stopped, editorCommands };
  }
  assert.deepEqual(dispatch(), { prevented: true, stopped: true, editorCommands: 0 });
  assert.equal(muted, false);
  assert.equal(toggles, 1);
  assert.deepEqual(dispatch({ repeat: true }), {
    prevented: true,
    stopped: true,
    editorCommands: 0,
  });
  assert.equal(toggles, 1);
  for (const args of [
    [{ altKey: true }],
    [{ metaKey: true }],
    [{ ctrlKey: false }],
    [{ shiftKey: false }],
    [{ code: "KeyN" }],
    [{}, true],
    [{}, false, false],
    [{}, false, true, { current: null }],
  ]) {
    assert.deepEqual(dispatch(...args), { prevented: false, stopped: false, editorCommands: 1 });
  }
  assert.equal(toggles, 1);
});
