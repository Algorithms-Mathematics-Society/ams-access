import assert from "node:assert/strict";
import test from "node:test";
import { sortHomeContests } from "./home-contest-presentation.ts";

const contest = (id, phase, overrides = {}) => ({
  id,
  phase,
  title: id,
  start_at: "2026-10-01T12:00:00Z",
  end_at: "2026-10-01T13:00:00Z",
  ...overrides,
});
const order = (items) => sortHomeContests(items, (item) => item.phase).map((item) => item.id);

test("home prioritizes graded live and upcoming contests over practice and inactive records", () => {
  assert.deepEqual(order([
    contest("draft", "draft"),
    contest("practice", "live", { is_practice: true }),
    contest("ended", "ended"),
    contest("unavailable", "metadata_unavailable"),
    contest("upcoming", "too_early"),
    contest("live", "live"),
  ]), ["live", "upcoming", "practice", "unavailable", "ended", "draft"]);
});

test("urgent live contests and nearest upcoming contests lead their groups", () => {
  assert.deepEqual(order([
    contest("upcoming-later", "too_early", { start_at: "2026-10-02T12:00:00Z" }),
    contest("live-later", "live", { end_at: "2026-10-01T15:00:00Z" }),
    contest("verification", "verification_open"),
    contest("live-sooner", "live"),
  ]), ["live-sooner", "live-later", "verification", "upcoming-later"]);
});

test("sorting preserves source data and stable order for equal priority", () => {
  const items = Object.freeze([contest("b", "live"), contest("a", "live")]);
  const result = sortHomeContests(items, (item) => item.phase);
  assert.deepEqual(result.map((item) => item.id), ["b", "a"]);
  assert.notEqual(result, items);
  assert.equal(result[0], items[0]);
});

test("a boundary phase change reorders only presentation", () => {
  const items = [contest("previously-upcoming", "live"), contest("previously-live", "ended")];
  assert.deepEqual(order(items), ["previously-upcoming", "previously-live"]);
  assert.equal(items[1].phase, "ended");
});

test("unavailable dates retain stable order and never override authoritative phases", () => {
  assert.deepEqual(order([
    contest("missing-1", "metadata_unavailable", { start_at: "", end_at: "" }),
    contest("practice", "live", { is_practice: true, start_at: "", end_at: "" }),
    contest("missing-2", "metadata_unavailable", { start_at: "bad", end_at: "bad" }),
  ]), ["practice", "missing-1", "missing-2"]);
});
