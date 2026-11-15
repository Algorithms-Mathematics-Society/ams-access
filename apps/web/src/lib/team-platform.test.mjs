import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { supportsNativeTeamPlatform, supportsTeamDesktopWebView } from "./team-platform.ts";

test("team rooms require a supported native desktop platform", () => {
  for (const os of ["windows", "macos", "linux"]) {
    assert.equal(supportsNativeTeamPlatform(true, os), true);
    assert.equal(supportsNativeTeamPlatform(false, os), false);
  }
  for (const os of [null, undefined, "android", "ios", "Linux", ""])
    assert.equal(supportsNativeTeamPlatform(true, os), false);
});

test("desktop WebView hints exclude browser, mobile and unknown Linux", () => {
  for (const hint of ["Win32", "Win64", "MacIntel", "Linux x86_64"]) {
    assert.equal(supportsTeamDesktopWebView(true, hint), true);
    assert.equal(supportsTeamDesktopWebView(false, hint), false);
    assert.equal(supportsTeamDesktopWebView(true, hint, "Mozilla Android 15"), false);
  }
  for (const hint of ["Linux", "Linux armv8l", "Linux aarch64", "iPhone", ""])
    assert.equal(supportsTeamDesktopWebView(true, hint), false);
});

test("lobby, voice and secured setup share the supported desktop gate", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const client = read("../app/session/contest/client.tsx");
  const voice = read("../app/session/contest/components/TeamVoiceControls.tsx");
  const setup = read("../app/session/onboarding/page.tsx");
  assert.match(
    client,
    /const desktopTeamRoom =\s*entryReady &&\s*!isDryRun &&[\s\S]*?supportsTeamDesktopWebView/
  );
  assert.doesNotMatch(client, /windowsTeamRoom/);
  assert.match(voice.replace(/\s+/g, " "), /if \( !enabled \|\| !supportsTeamDesktopWebView/);
  assert.match(setup, /supportsNativeTeamPlatform\(nativeAvailable, devicePlatform\) && !dryRun/);
});
