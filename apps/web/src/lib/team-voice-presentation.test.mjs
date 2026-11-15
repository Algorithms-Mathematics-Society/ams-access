import { test } from "node:test";
import assert from "node:assert/strict";
import { voiceErrorAdvice, voiceStatusText } from "./team-voice-presentation.ts";

test("voice statuses explain terminal and connected states", () => {
  for (const status of [
    "idle",
    "connecting",
    "connected",
    "reconnecting",
    "unavailable",
    "closed",
    "replaced",
  ]) {
    assert.notEqual(voiceStatusText(status), status);
    assert.ok(voiceStatusText(status));
  }
  assert.match(voiceStatusText("replaced"), /another window or device/);
});
test("only denied microphones get permission advice; unknown engine details stay private", () => {
  assert.match(voiceErrorAdvice("Microphone access was denied."), /system settings/);
  for (const reason of [
    "Team voice relay is unavailable.",
    "Voice relay credentials expired.",
    "Voice connection could not be restored.",
    "private backend detail",
  ]) {
    assert.doesNotMatch(voiceErrorAdvice(reason), /microphone|system settings|private backend/);
    assert.match(voiceErrorAdvice(reason), /Retry voice/);
  }
  assert.match(voiceErrorAdvice("No microphone was found."), /Connect a microphone/);
});
