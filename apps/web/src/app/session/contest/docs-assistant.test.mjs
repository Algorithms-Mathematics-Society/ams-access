import assert from "node:assert/strict";
import test from "node:test";
import { MAX_QUESTION_WORDS, askErrorMessage, countWords, sourceInfo } from "./docs-assistant.ts";

test("words are counted the way the server counts them", () => {
  assert.equal(countWords(""), 0);
  assert.equal(countWords("   \n "), 0);
  assert.equal(countWords("  how does\tstd::lower_bound\nwork  "), 4);
  assert.equal(countWords("word ".repeat(MAX_QUESTION_WORDS)), 200);
});

test("errors explain the limit, outage and rejected questions", () => {
  assert.match(
    askErrorMessage({ status: 429, detail: { retry_after: 61 } }),
    /Try again in 2 minutes/
  );
  assert.match(askErrorMessage({ status: 429, detail: { retry_after: 30 } }), /1 minute\./);
  assert.match(askErrorMessage({ status: 429 }), /Try again later/);
  assert.match(askErrorMessage({ status: 503 }), /unavailable/);
  assert.equal(
    askErrorMessage({ status: 422, message: "Value error, questions are limited to 200 words" }),
    "Value error, questions are limited to 200 words"
  );
  assert.match(askErrorMessage({ status: 0 }), /connection/);
});

test("each documentation source gets a name and badge", () => {
  assert.deepEqual(sourceInfo("cppreference"), { name: "cppreference", mark: "C++" });
  assert.deepEqual(sourceInfo("nlohmann-json"), { name: "nlohmann/json", mark: "{ }" });
  assert.deepEqual(sourceInfo("Boost"), { name: "Boost", mark: "B" });
  assert.deepEqual(sourceInfo("other-docs"), { name: "other-docs", mark: "Doc" });
  assert.deepEqual(sourceInfo(""), { name: "Documentation", mark: "Doc" });
});
