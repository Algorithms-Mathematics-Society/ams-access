// The CSP and the API base are set in two different files, in two different
// languages, and nothing connects them. When they drift, every network call in
// a *release* build is blocked — and `tauri dev` does not reproduce it, because
// `devCsp` is permissive. That is exactly how the app shipped pointing at a
// Cloud Run host that no longer exists.
//
// This test is the connection.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { resolveApiBase } from "./api-base.ts";

const CONFIG_PATH = fileURLToPath(
  new URL("../../../desktop/src-tauri/tauri.conf.json", import.meta.url)
);

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));

/** The `connect-src` sources from a CSP string, in order. */
function connectSrc(csp) {
  const directive = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("connect-src"));
  assert.ok(directive, "CSP has no connect-src directive");
  return directive.split(/\s+/).slice(1);
}

// Node has no `window`, so with NEXT_PUBLIC_API_URL unset this is the
// production branch.
//
// It was NOT, however, "the one the shipped bundle takes" — which is what
// this comment used to claim, and what made the test blind to the very bug it
// was written for. The release workflow set NEXT_PUBLIC_API_URL from a
// repository secret, so release builds baked whatever that secret held while
// this test happily checked the constant nobody was using. The secret
// predated the move off Cloud Run, and v2.0.0 shipped calling a dead host:
// "Cannot reach the exam server", on a working API, with valid credentials.
//
// The workflow no longer sets it. The test below makes that permanent.
const apiOrigin = new URL(resolveApiBase()).origin;

test("the release CSP allows the production API origin", () => {
  const sources = connectSrc(config.app.security.csp);
  assert.ok(
    sources.includes(apiOrigin),
    `release CSP connect-src ${JSON.stringify(sources)} does not allow ${apiOrigin}`
  );
});

test("the dev CSP allows the production API origin too", () => {
  // A developer pointing a dev build at production must not hit a CSP wall
  // that production itself would not have.
  const sources = connectSrc(config.app.security.devCsp);
  assert.ok(
    sources.includes(apiOrigin),
    `dev CSP connect-src ${JSON.stringify(sources)} does not allow ${apiOrigin}`
  );
});

test("no retired backend hosts remain in either CSP", () => {
  // `https://*.run.app` outlived the Cloud Run backend by several releases.
  // A wildcard host that nothing uses is a hole nobody is watching.
  for (const [name, csp] of [
    ["csp", config.app.security.csp],
    ["devCsp", config.app.security.devCsp],
  ]) {
    assert.ok(!csp.includes("run.app"), `${name} still allows the retired Cloud Run wildcard`);
  }
});

test("connect-src does not allow arbitrary hosts", () => {
  // The point of pinning the origin is lost if a wildcard is sitting next to
  // it. localhost is permitted in devCsp only.
  const allowed = new Set(["'self'", apiOrigin]);
  const devExtra = new Set(["http://localhost:*", "ws://localhost:*"]);

  for (const source of connectSrc(config.app.security.csp)) {
    assert.ok(allowed.has(source), `release CSP allows unexpected connect-src ${source}`);
  }
  for (const source of connectSrc(config.app.security.devCsp)) {
    assert.ok(
      allowed.has(source) || devExtra.has(source),
      `dev CSP allows unexpected connect-src ${source}`
    );
  }
});

test("an overriding NEXT_PUBLIC_API_URL would still have to be CSP-allowed", () => {
  // The guard for the day someone reintroduces the override. A build-time
  // origin that connect-src does not list is not a misconfiguration you find
  // in testing — devCsp is permissive, so it only appears in a shipped
  // installer, as a network error with no explanation.
  const override = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (!override) return; // the supported case: no override at all

  const sources = connectSrc(config.app.security.csp);
  assert.ok(
    sources.includes(new URL(override).origin),
    `NEXT_PUBLIC_API_URL=${override} is not in release CSP connect-src ` +
      `${JSON.stringify(sources)} — every request from the shipped app would be blocked`
  );
});
