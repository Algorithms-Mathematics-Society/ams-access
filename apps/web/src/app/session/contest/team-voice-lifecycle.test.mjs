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
