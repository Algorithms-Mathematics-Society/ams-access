import assert from "node:assert/strict";
import test from "node:test";
import { MAX_QUESTION_WORDS, askErrorMessage, countWords } from "./docs-assistant.ts";

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
