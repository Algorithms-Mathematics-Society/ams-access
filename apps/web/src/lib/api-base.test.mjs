// Which server the shipped app calls.
//
// This has now been wrong in production twice, in two different ways, and
// both times the symptom was identical: "Cannot reach the exam server" on a
// healthy backend with valid credentials. Neither was reproducible in `tauri
// dev`, because the dev origin IS localhost:3000 and devCsp is permissive.
//
// The origins below are the real ones Tauri serves from. They are the whole
// point of the file.

import test from "node:test";
import assert from "node:assert/strict";

import { apiBaseForLocation } from "./api-base.ts";

const PROD = "https://api.amsaccess.com";
const DEV = "http://localhost:8080";

/** `tauri://localhost` — how Tauri serves the bundle on Linux and macOS. */
const TAURI_UNIX = { protocol: "tauri:", hostname: "localhost", port: "" };
/** `http://tauri.localhost` — the same thing on Windows. */
const TAURI_WINDOWS = { protocol: "http:", hostname: "tauri.localhost", port: "" };
/** `next dev` in a browser. */
const DEV_SERVER = { protocol: "http:", hostname: "localhost", port: "3000" };

test("the installed app on Linux and macOS calls production", () => {
  // The bug: `tauri://localhost` has hostname "localhost", so a bare
  // hostname check sent every installed Linux and macOS client at a dev API
  // on port 8080 that nothing was serving.
  assert.equal(apiBaseForLocation(TAURI_UNIX), PROD);
});

test("the installed app on Windows calls production", () => {
  assert.equal(apiBaseForLocation(TAURI_WINDOWS), PROD);
});

test("the dev server still gets the dev API", () => {
  // The case the localhost branch exists for, and the only one.
  assert.equal(apiBaseForLocation(DEV_SERVER), DEV);
});

test("the dev API is chosen by port, not by hostname", () => {
  // The port is the one thing a Tauri origin cannot have, which is why the
  // decision hangs on it.
  assert.equal(apiBaseForLocation({ ...DEV_SERVER, port: "" }), PROD);
  assert.equal(apiBaseForLocation({ ...DEV_SERVER, port: "1420" }), PROD);
  assert.equal(apiBaseForLocation({ ...DEV_SERVER, hostname: "127.0.0.1" }), DEV);
});

test("a tauri: origin never gets the dev API, whatever its port", () => {
  assert.equal(apiBaseForLocation({ ...TAURI_UNIX, port: "3000" }), PROD);
});

test("server-side rendering, with no location at all, gets production", () => {
  assert.equal(apiBaseForLocation(null), PROD);
});

test("an ordinary web origin gets production", () => {
  assert.equal(
    apiBaseForLocation({ protocol: "https:", hostname: "amsaccess.com", port: "" }),
    PROD
  );
});

test("no origin resolves to something the release CSP would block", async () => {
  // The failure mode both bugs actually produced. connect-src lists exactly
  // one remote origin; anything else is a network error the candidate cannot
  // act on.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const config = JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../../../desktop/src-tauri/tauri.conf.json", import.meta.url)),
      "utf8"
    )
  );
  const allowed = config.app.security.csp
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith("connect-src"))
    .split(/\s+/)
    .slice(1);

  for (const [name, loc] of [
    ["linux/macos", TAURI_UNIX],
    ["windows", TAURI_WINDOWS],
  ]) {
    const origin = new URL(apiBaseForLocation(loc)).origin;
    assert.ok(allowed.includes(origin), `${name} resolves to ${origin}, not in ${allowed}`);
  }
});
