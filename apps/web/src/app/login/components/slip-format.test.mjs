// Slip transcription.
//
// Someone is copying two grouped codes off a printed slip, by hand, about to
// sit an exam. Every way the field can fight them is a support ticket during
// a live contest — which is exactly why the server's alphabet has no 0/O or
// 1/I/L in it, and why this formats as they type rather than validating
// afterwards and telling them they got it wrong.

import test from "node:test";
import assert from "node:assert/strict";

import { formatLoginId, formatPassword } from "./slip-format.ts";

test("a login id types out grouped", () => {
  assert.equal(formatLoginId("AMS7K3MQR9T"), "AMS-7K3M-QR9T");
});

test("the hyphens a candidate types themselves are absorbed", () => {
  assert.equal(formatLoginId("AMS-7K3M-QR9T"), "AMS-7K3M-QR9T");
});

test("lowercase becomes uppercase, because the slip is uppercase", () => {
  assert.equal(formatLoginId("ams-7k3m-qr9t"), "AMS-7K3M-QR9T");
});

test("the AMS prefix is added rather than demanded", () => {
  // A candidate reading "7K3M-QR9T" off the slip and skipping the prefix
  // should not be told their credentials are wrong.
  assert.equal(formatLoginId("7K3MQR9T"), "AMS-7K3M-QR9T");
});

test("spaces and stray punctuation are dropped", () => {
  assert.equal(formatLoginId("AMS 7K3M QR9T"), "AMS-7K3M-QR9T");
  assert.equal(formatLoginId("AMS–7K3M–QR9T"), "AMS-7K3M-QR9T");
});

test("a partial login id formats as far as it goes", () => {
  assert.equal(formatLoginId("AMS7K"), "AMS-7K");
  assert.equal(formatLoginId("AMS7K3M"), "AMS-7K3M");
  assert.equal(formatLoginId("AMS7K3MQ"), "AMS-7K3M-Q");
});

test("backspacing to empty does not strand a dangling prefix", () => {
  assert.equal(formatLoginId(""), "");
});

test("a password types out in three groups", () => {
  assert.equal(formatPassword("ABCDEFGHJKMN"), "ABCD-EFGH-JKMN");
  assert.equal(formatPassword("abcd-efgh-jkmn"), "ABCD-EFGH-JKMN");
});

test("a partial password formats as far as it goes", () => {
  assert.equal(formatPassword("ABC"), "ABC");
  assert.equal(formatPassword("ABCDE"), "ABCD-E");
});

test("overtyping past the password length is ignored rather than accepted", () => {
  // Better to stop at twelve than to send a thirteenth character the server
  // will reject with a message that says nothing about which one was extra.
  assert.equal(formatPassword("ABCDEFGHJKMNPQRS"), "ABCD-EFGH-JKMN");
});
