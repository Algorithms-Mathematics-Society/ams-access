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

import { allowlistHostFor, apiBaseForLocation } from "./api-base.ts";

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

// ── The dev override (F1) ────────────────────────────────────────────────
//
// A dev build has exactly one possible API target and it is a port nothing is
// necessarily serving, so `tauri dev` against a real backend is impossible
// without editing source. The override that fixes that must be STRUCTURALLY
// unable to reach a release build: `NEXT_PUBLIC_API_URL` was read before the
// origin was known, so a stale CI secret overrode production in every
// installer. This one is read only after the origin has been established as
// the dev server, which is an origin no shipped bundle can have.

test("the dev server honours the override when one is set", () => {
  assert.equal(
    apiBaseForLocation(DEV_SERVER, "https://api.amsaccess.com"),
    "https://api.amsaccess.com"
  );
});

test("the dev server falls back to the local API when the override is absent or blank", () => {
  assert.equal(apiBaseForLocation(DEV_SERVER, undefined), DEV);
  assert.equal(apiBaseForLocation(DEV_SERVER, ""), DEV);
  assert.equal(apiBaseForLocation(DEV_SERVER, "   "), DEV);
});

test("a tauri origin ignores the dev override even when it is set", () => {
  // The whole safety property. If this ever fails, a repository secret can
  // redirect a shipped installer again, which is exactly the v2.0.0 outage.
  for (const origin of [TAURI_UNIX, TAURI_WINDOWS]) {
    assert.equal(apiBaseForLocation(origin, "https://somewhere-else.example"), PROD);
  }
});

test("server-side rendering ignores the dev override", () => {
  assert.equal(apiBaseForLocation(null, "https://somewhere-else.example"), PROD);
});

// ── The lockdown allowlist host (L10) ────────────────────────────────────
//
// `getNetworkLockdownAllowlistHost()` returned the literal "localhost" when
// the base could not be parsed. That resolves to 127.0.0.1, which IS a valid
// IP, so the helper's empty-allowlist guard never fires and it builds a
// loopback-only chain: total egress blackout, reported to the candidate as
// "engaged". Unreachable while the base was a constant. The override above
// makes it reachable, so it has to go in the same change.

test("the allowlist host is the API's hostname", () => {
  assert.equal(allowlistHostFor("https://api.amsaccess.com"), "api.amsaccess.com");
  assert.equal(allowlistHostFor("http://localhost:8080"), "localhost");
});

test("an unparseable base throws instead of silently becoming localhost", () => {
  // Returning "localhost" here builds a chain that blocks the exam API while
  // reporting success. Failing loudly is the only safe answer: the callers
  // are inside try/catch and fail closed.
  assert.throws(() => allowlistHostFor("not a url"));
  assert.throws(() => allowlistHostFor(""));
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
