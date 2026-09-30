// What a candidate types to sign in.
//
// They have `ayush.s-kqmwd@access` in an email and are about to sit an exam.
// Every way the field can fight them is a support ticket during a live
// contest, so this shapes input as they type rather than validating afterwards
// and telling them they got it wrong.
//
// The handle replaced a printed slip id (`AMS-7K3M-QR9T`). Two things changed
// that these pin: it is lowercase, not uppercase — the old formatter
// upper-cased, which for a handle matches nothing — and `@access` is dropped,
// because the field shows it as a fixed suffix and they will paste the whole
// string from the email regardless.

import test from "node:test";
import assert from "node:assert/strict";

import { formatHandle, formatPassword, HANDLE_SUFFIX } from "./slip-format.ts";

test("a handle types through unchanged", () => {
  assert.equal(formatHandle("ayush.s-kqmwd"), "ayush.s-kqmwd");
});

test("capitals are folded, not preserved", () => {
  // The old slip formatter upper-cased. Carrying that over would mean no
  // handle ever matched, because they are stored lowercase.
  assert.equal(formatHandle("Ayush.S-KQMWD"), "ayush.s-kqmwd");
  assert.equal(formatHandle("AYUSH.S-KQMWD"), "ayush.s-kqmwd");
});

test("a pasted handle keeps only the part before @access", () => {
  // The normal case, not the exceptional one: the email shows the whole
  // thing, so that is what gets pasted.
  assert.equal(formatHandle("ayush.s-kqmwd@access"), "ayush.s-kqmwd");
  assert.equal(formatHandle("ayush.s-kqmwd@access.amsaccess.com"), "ayush.s-kqmwd");
  assert.equal(formatHandle("Ayush.S-Kqmwd@Access"), "ayush.s-kqmwd");
});

test("a half-typed @access does not eat the handle", () => {
  // They type the @ themselves out of habit; the field must not blank.
  assert.equal(formatHandle("ayush.s-kqmwd@"), "ayush.s-kqmwd");
  assert.equal(formatHandle("ayush.s-kqmwd@acc"), "ayush.s-kqmwd");
});

test("spaces and stray punctuation are dropped rather than rejected", () => {
  assert.equal(formatHandle("  ayush.s-kqmwd  "), "ayush.s-kqmwd");
  assert.equal(formatHandle("ayush.s_kqmwd"), "ayush.skqmwd");
});

test("digits are dropped, because no handle contains one", () => {
  // That is the property that makes 0/o and 1/l unambiguous when a handle is
  // read aloud across a room.
  assert.equal(formatHandle("ayush.s-kqmw0"), "ayush.s-kqmw");
});

test("dots and hyphens survive, since handles are built from them", () => {
  assert.equal(formatHandle("anne.d-vtbnr"), "anne.d-vtbnr");
  assert.equal(formatHandle("madonna-hvyeb"), "madonna-hvyeb");
});

test("a partial handle is left alone while it is being typed", () => {
  // No reformatting mid-word: nothing here should move the caret.
  assert.equal(formatHandle("ay"), "ay");
  assert.equal(formatHandle("ayush."), "ayush.");
  assert.equal(formatHandle("ayush.s-"), "ayush.s-");
});

test("an absurdly long paste is bounded", () => {
  assert.equal(formatHandle("a".repeat(200)).length, 64);
});

test("the suffix shown beside the field is the one that gets stripped", () => {
  // If these ever disagree, the field would display one thing and accept
  // another.
  assert.equal(formatHandle(`ayush.s-kqmwd${HANDLE_SUFFIX}`), "ayush.s-kqmwd");
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
