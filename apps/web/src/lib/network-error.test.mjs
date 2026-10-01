// What a candidate and an invigilator are told when there is no HTTP response
// at all.
//
// This exists because the single sentence "Cannot reach the exam server. Check
// the network, or ask an invigilator." was shown for two different failures
// and named a remedy that was wrong for both of the cases we have actually
// hit. In the incident that produced this module the network was perfect and
// the app was calling http://localhost:8080, which nothing was serving. An
// invigilator reading that message goes and checks the router.
//
// Two things fix it: distinguish a timeout from a refused connection, and say
// which host was called.

import test from "node:test";
import assert from "node:assert/strict";

import { describeUnreachable } from "./network-error.ts";

test("a refused connection does not tell anyone to check the network", () => {
  // The specific wording regression this guards. A connection refused by a
  // host that resolved is not a network problem, and sending an invigilator
  // to the router is the waste this module exists to stop.
  const { message } = describeUnreachable({
    code: "UNREACHABLE",
    apiBase: "https://api.amsaccess.com",
  });
  assert.match(message, /cannot reach the exam server/i);
  assert.doesNotMatch(message, /check the network/i);
});

test("a timeout says wait, not that the server is unreachable", () => {
  const { message } = describeUnreachable({
    code: "TIMEOUT",
    apiBase: "https://api.amsaccess.com",
  });
  assert.match(message, /did not respond in time/i);
  assert.doesNotMatch(message, /cannot reach/i);
});

test("the diagnostic names the host that was actually called", () => {
  // The one fact that ends the diagnosis, and the one nothing recorded.
  assert.equal(
    describeUnreachable({ code: "UNREACHABLE", apiBase: "https://api.amsaccess.com" }).diagnostic,
    "api.amsaccess.com · UNREACHABLE"
  );
});

test("the dev misconfiguration is visible on sight", () => {
  // The exact incident: a dev build calling a local API nothing is serving.
  // "localhost:8080 · UNREACHABLE" is a five-second diagnosis; the old
  // message was a twenty-minute one.
  assert.equal(
    describeUnreachable({ code: "UNREACHABLE", apiBase: "http://localhost:8080" }).diagnostic,
    "localhost:8080 · UNREACHABLE"
  );
});

test("a port is kept only when there is one", () => {
  assert.equal(
    describeUnreachable({ code: "TIMEOUT", apiBase: "https://api.amsaccess.com:443" }).diagnostic,
    "api.amsaccess.com · TIMEOUT"
  );
});

test("an unusable base degrades to the code alone rather than throwing", () => {
  // This runs inside a catch block on the login screen. It must never be the
  // thing that breaks the error path.
  assert.equal(describeUnreachable({ code: "UNREACHABLE" }).diagnostic, "UNREACHABLE");
  assert.equal(
    describeUnreachable({ code: "UNREACHABLE", apiBase: "not a url" }).diagnostic,
    "UNREACHABLE"
  );
  assert.equal(describeUnreachable({ code: "UNREACHABLE", apiBase: 42 }).diagnostic, "UNREACHABLE");
});

test("an unknown code still produces something an invigilator can read", () => {
  const { message, diagnostic } = describeUnreachable({
    code: "",
    apiBase: "https://api.amsaccess.com",
  });
  assert.match(message, /cannot reach the exam server/i);
  assert.equal(diagnostic, "api.amsaccess.com");
});
