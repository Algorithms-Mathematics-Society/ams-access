// The editor's C++ standard-library completions.
//
// The list was 38 hand-written names. Typing `std::era` — reaching for
// `erase` — offered `unordered_map`, `next_permutation` and `prev_permutation`,
// because `erase` was not in the list and those were the closest fuzzy
// matches. A candidate cannot tell "this name does not exist" from "this name
// is not in our list", so a short list is worse than none: it teaches them to
// distrust the editor in the middle of an exam.
//
// The contest compiles as C++23, so these assert the modern surface is
// actually reachable, not just the C++11 subset somebody happened to type out.

import test from "node:test";
import assert from "node:assert/strict";

import { cppStdlibCompletions } from "./cpp-stdlib.ts";

const labels = new Set(cppStdlibCompletions.map((c) => c.label));

test("the name that started this is present", () => {
  assert.ok(labels.has("erase"));
  assert.ok(labels.has("erase_if"));
});

test("every entry has a label, a type and an owning header", () => {
  // `detail` carries the header because "which header do I include" is the
  // question a candidate in a locked room cannot look up.
  for (const c of cppStdlibCompletions) {
    assert.ok(c.label, "missing label");
    assert.ok(c.type, `${c.label} has no type`);
    assert.ok(c.detail, `${c.label} has no header`);
  }
});

test("there are no duplicate labels", () => {
  // CodeMirror renders duplicates as separate rows, and two identical labels
  // in a popup is worse than one imprecise header.
  assert.equal(labels.size, cppStdlibCompletions.length);
});

test("it is substantially larger than the list it replaced", () => {
  assert.ok(cppStdlibCompletions.length > 300, `only ${cppStdlibCompletions.length}`);
});

test("C++20 is reachable", () => {
  for (const name of ["popcount", "bit_width", "format", "span", "ranges", "views", "midpoint"]) {
    assert.ok(labels.has(name), name);
  }
});

test("C++23 is reachable — the standard this contest compiles as", () => {
  for (const name of ["print", "println", "expected", "flat_map", "zip", "to_underlying"]) {
    assert.ok(labels.has(name), name);
  }
});

test("the competitive-programming staples are all there", () => {
  for (const name of [
    "sort",
    "lower_bound",
    "upper_bound",
    "accumulate",
    "gcd",
    "lcm",
    "priority_queue",
    "unordered_map",
    "next_permutation",
    "__int128",
    "mt19937",
    "numeric_limits",
    "bitset",
    "iota",
    "nth_element",
  ]) {
    assert.ok(labels.has(name), name);
  }
});

test("headers are named in a form a candidate can type", () => {
  const headers = new Set(cppStdlibCompletions.map((c) => c.detail));
  assert.ok([...headers].some((h) => h.startsWith("<algorithm>")));
  assert.ok([...headers].some((h) => h.includes("C++23")));
});
