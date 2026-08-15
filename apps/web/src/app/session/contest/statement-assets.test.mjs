import assert from "node:assert/strict";
import test from "node:test";

import { resolveCandidateAssetURL } from "./candidate-question-projection.ts";

// How the pieces actually line up once a pack is loaded. The statement is
// authored at `statement/problem.md` inside the problem directory and refers
// to its images as siblings, so both paths carry the label and the
// `statement/` directory. Get either wrong and every image silently misses —
// no error, no warning, just a broken-image icon at the exam.
const STATEMENT_PATH = "A/statement/problem.md";
const ASSETS = [
  { path: "A/statement/figure.png", object_url: "blob:figure" },
  { path: "A/statement/diagrams/tree.png", object_url: "blob:tree" },
];

test("a sibling image referenced by bare filename resolves", () => {
  // The overwhelmingly common case: `![](figure.png)` next to the statement.
  assert.equal(resolveCandidateAssetURL("figure.png", STATEMENT_PATH, ASSETS), "blob:figure");
});

test("an image in a subdirectory of statement/ resolves", () => {
  assert.equal(resolveCandidateAssetURL("diagrams/tree.png", STATEMENT_PATH, ASSETS), "blob:tree");
});

test("an explicit ./ prefix resolves the same way", () => {
  assert.equal(resolveCandidateAssetURL("./figure.png", STATEMENT_PATH, ASSETS), "blob:figure");
});

test("a statement path at the problem root would miss every image", () => {
  // Why `statement.path` must name the real authored location. With the old
  // `A/statement.md`, `figure.png` resolves to `A/figure.png` — and the asset
  // is at `A/statement/figure.png`, so nothing matches and nothing complains.
  assert.equal(resolveCandidateAssetURL("figure.png", "A/statement.md", ASSETS), null);
});

test("an image belonging to another problem is not reachable", () => {
  const foreign = [{ path: "B/statement/figure.png", object_url: "blob:other" }];
  assert.equal(resolveCandidateAssetURL("figure.png", STATEMENT_PATH, foreign), null);
});

test("a parent-directory traversal is refused", () => {
  // A statement is setter-supplied content rendered inside the exam shell.
  assert.equal(resolveCandidateAssetURL("../../etc/passwd", STATEMENT_PATH, ASSETS), null);
});

test("an absolute path is refused", () => {
  assert.equal(resolveCandidateAssetURL("/etc/passwd", STATEMENT_PATH, ASSETS), null);
});

test("a remote or scheme-bearing source is refused", () => {
  for (const source of [
    "https://example.test/a.png",
    "http://example.test/a.png",
    "data:image/png;base64,AAAA",
    "javascript:alert(1)",
    "blob:http://evil/x",
  ]) {
    assert.equal(resolveCandidateAssetURL(source, STATEMENT_PATH, ASSETS), null, source);
  }
});

test("an image the pack does not carry resolves to nothing rather than a guess", () => {
  // The candidate sees a gap in a statement they can still read and still
  // solve — not a failed page.
  assert.equal(resolveCandidateAssetURL("missing.png", STATEMENT_PATH, ASSETS), null);
});

test("an empty source is refused", () => {
  assert.equal(resolveCandidateAssetURL("", STATEMENT_PATH, ASSETS), null);
});

test("no assets at all resolves to nothing", () => {
  assert.equal(resolveCandidateAssetURL("figure.png", STATEMENT_PATH, []), null);
});
