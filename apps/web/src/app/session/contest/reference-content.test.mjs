import test from "node:test";
import assert from "node:assert/strict";
import { resolveReferenceAsset, referenceContent } from "./reference-content.ts";

test("reference images resolve only inside the bundled asset namespace", () => {
  const from = "reference/en/cpp/language/functions.html";
  assert.equal(
    resolveReferenceAsset("../../../common/logo.png", from),
    "/cppref/assets/reference/common/logo.png"
  );
  assert.equal(
    resolveReferenceAsset("/cppref/assets/reference/common/site.png", from),
    "/cppref/assets/reference/common/site.png"
  );
});

test("reference image URLs reject network, traversal, query and malformed sources", () => {
  const from = "/cppref/reference/en/cpp.html";
  for (const source of [
    "https://attacker.invalid/image.png",
    "//attacker.invalid/image.png",
    "data:image/svg+xml,<svg/>",
    "../../../outside.png",
    "/cppref/assets/reference/../../secret.png",
    "/cppref/assets/reference/image.png?track=1",
    "/cppref/assets/reference/image.png#fragment",
    "%ZZ",
  ]) {
    assert.equal(resolveReferenceAsset(source, from), null, source);
  }
});

test("sanitizer fails closed when called without a browser DOM", () => {
  assert.equal(referenceContent("<p>offline</p>", "/cppref/reference/en/cpp.html"), "");
});
