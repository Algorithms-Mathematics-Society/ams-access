import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  CandidateQuestionContractError,
  loadCandidateQuestions,
  resolveCandidateAssetURL,
} from "./candidate-question-projection.ts";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const CXX_ID = "22222222-2222-4222-8222-222222222222";
const LEGACY_ID = "33333333-3333-4333-8333-333333333333";
const ASSET_ID = "44444444-4444-4444-8444-444444444444";
const API_BASE = "https://api.example.test";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function projectionDigest(cxxprobe) {
  const document = {
    contract: "ams.candidate-question-projection",
    schema_version: 1,
    bundle_sha256: cxxprobe.bundle_sha256,
    problem_name: cxxprobe.problem_name,
    language: cxxprobe.language,
    standard: cxxprobe.standard,
    limits: cxxprobe.limits,
    statement: {
      path: cxxprobe.statement.path,
      sha256: cxxprobe.statement.sha256,
      size_bytes: cxxprobe.statement.size_bytes,
    },
    starter: cxxprobe.starter
      ? {
          path: cxxprobe.starter.path,
          language: cxxprobe.starter.language,
          sha256: cxxprobe.starter.sha256,
          size_bytes: cxxprobe.starter.size_bytes,
        }
      : null,
    assets: cxxprobe.assets.map((asset) => ({
      path: asset.path,
      media_type: asset.media_type,
      sha256: asset.sha256,
      size_bytes: asset.size_bytes,
    })),
  };
  return sha256(JSON.stringify(document));
}

function fixture() {
  const statement = "# Sum\n\n![diagram](public/diagram.jpg)\n";
  const starter = "#include <iostream>\nint main() { return 0; }\n";
  const assetBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0x00]);
  const cxxprobe = {
    bundle_sha256: "a".repeat(64),
    projection_sha256: "",
    problem_name: "A: Sum",
    language: "cpp",
    standard: "c++23",
    limits: {
      memory_bytes: 268435456,
      cpu_time_ms: 2000,
      wall_time_ms: 4000,
      max_pids: 32,
    },
    statement: {
      path: "a-sum/problem.md",
      sha256: sha256(statement),
      size_bytes: Buffer.byteLength(statement),
      content: statement,
    },
    starter: {
      path: "a-sum/public/main.cpp",
      filename: "main.cpp",
      language: "cpp",
      sha256: sha256(starter),
      size_bytes: Buffer.byteLength(starter),
      content: starter,
    },
    assets: [
      {
        id: ASSET_ID,
        path: "a-sum/public/diagram.jpg",
        filename: "diagram.jpg",
        media_type: "image/jpeg",
        sha256: sha256(assetBytes),
        size_bytes: assetBytes.byteLength,
        url: `/sessions/${SESSION_ID}/questions/${CXX_ID}/assets/${ASSET_ID}`,
      },
    ],
  };
  cxxprobe.projection_sha256 = projectionDigest(cxxprobe);
  return {
    assetBytes,
    payload: {
      contract: "ams.candidate-question-projection",
      schema_version: 1,
      session_id: SESSION_ID,
      questions: [
        {
          id: CXX_ID,
          order_index: 0,
          title: "A. Sum",
          points: 100,
          type: "code",
          judge_engine: "cxxprobe",
          cxxprobe,
        },
        {
          id: LEGACY_ID,
          order_index: 1,
          title: "B. Legacy",
          points: 50,
          type: "code",
          judge_engine: "legacy",
          legacy: {
            description: "Legacy statement",
            html_starter: "",
            css_starter: "",
            js_starter: "",
            time_limit_ms: 1000,
            memory_limit_mb: 128,
          },
        },
      ],
    },
  };
}

function options(assetBytes, overrides = {}) {
  const calls = [];
  return {
    calls,
    value: {
      expectedSessionId: SESSION_ID,
      apiBase: API_BASE,
      headers: { Authorization: "Bearer candidate", "X-Device-Id": "device" },
      createObjectURL: () => "blob:verified-diagram",
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response(assetBytes, {
          status: 200,
          headers: {
            "Content-Type": "image/jpeg",
            "Content-Length": String(assetBytes.byteLength),
          },
        });
      },
      ...overrides,
    },
  };
}

test("loads exact mixed legacy/cxxprobe projection and authenticated verified asset", async () => {
  const { payload, assetBytes } = fixture();
  const configured = options(assetBytes);
  const loaded = await loadCandidateQuestions(payload, configured.value);

  assert.equal(loaded.questions.length, 2);
  assert.equal(loaded.questions[0].judge_engine, "cxxprobe");
  assert.equal(loaded.questions[0].starter_filename, "main.cpp");
  assert.equal(loaded.questions[0].starter_code, payload.questions[0].cxxprobe.starter.content);
  assert.equal(loaded.questions[0].cxxprobe.standard, "c++23");
  assert.equal(loaded.questions[0].cxxprobe.assets[0].object_url, "blob:verified-diagram");
  assert.equal(loaded.questions[1].description, "Legacy statement");
  assert.deepEqual(loaded.objectUrls, ["blob:verified-diagram"]);
  assert.equal(
    configured.calls[0].url,
    `${API_BASE}/sessions/${SESSION_ID}/questions/${CXX_ID}/assets/${ASSET_ID}`
  );
  assert.equal(configured.calls[0].init.headers.Authorization, "Bearer candidate");
  assert.equal(configured.calls[0].init.cache, "no-store");
  assert.equal(configured.calls[0].init.redirect, "error");
});

test("rejects envelope, ownership, branch, and private-material contract drift", async () => {
  const cases = [
    (payload) => (payload.contract = "other"),
    (payload) => (payload.schema_version = 2),
    (payload) => (payload.session_id = "99999999-9999-4999-8999-999999999999"),
    (payload) => (payload.questions[0].legacy = {}),
    (payload) => (payload.questions[0].cxxprobe.storage_object = "private/archive.tar.gz"),
    (payload) => (payload.questions[0].cxxprobe.assets[0].url = "/contests/public/asset"),
  ];
  for (const mutate of cases) {
    const { payload, assetBytes } = fixture();
    mutate(payload);
    await assert.rejects(
      () => loadCandidateQuestions(payload, options(assetBytes).value),
      CandidateQuestionContractError
    );
  }
});

test("rejects text and projection metadata digest mutation before rendering", async () => {
  {
    const { payload, assetBytes } = fixture();
    payload.questions[0].cxxprobe.statement.content += "tampered";
    await assert.rejects(
      () => loadCandidateQuestions(payload, options(assetBytes).value),
      /byte length does not match/
    );
  }
  {
    const { payload, assetBytes } = fixture();
    payload.questions[0].cxxprobe.projection_sha256 = "b".repeat(64);
    await assert.rejects(
      () => loadCandidateQuestions(payload, options(assetBytes).value),
      /projection_sha256 does not match/
    );
  }
});

test("rejects asset MIME, byte-length, and SHA-256 mismatches", async () => {
  const checks = [
    async (assetBytes) =>
      new Response(assetBytes, {
        status: 200,
        headers: { "Content-Type": "image/png", "Content-Length": "4" },
      }),
    async () =>
      new Response(Uint8Array.from([0xff, 0xd8, 0xff]), {
        status: 200,
        headers: { "Content-Type": "image/jpeg", "Content-Length": "3" },
      }),
    async () =>
      new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0x01]), {
        status: 200,
        headers: { "Content-Type": "image/jpeg", "Content-Length": "4" },
      }),
  ];
  for (const fetchImpl of checks) {
    const { payload, assetBytes } = fixture();
    await assert.rejects(() =>
      loadCandidateQuestions(payload, options(assetBytes, { fetchImpl }).value)
    );
  }
});

test("resolves only exact declared relative asset paths", () => {
  const assets = [{ path: "a-sum/public/diagram.jpg", object_url: "blob:diagram" }];
  assert.equal(
    resolveCandidateAssetURL("public/diagram.jpg", "a-sum/problem.md", assets),
    "blob:diagram"
  );
  assert.equal(
    resolveCandidateAssetURL("./public/diagram.jpg", "a-sum/problem.md", assets),
    "blob:diagram"
  );
  for (const source of [
    "diagram.jpg",
    "../public/diagram.jpg",
    "/a-sum/public/diagram.jpg",
    "https://example.test/diagram.jpg",
    "//example.test/diagram.jpg",
    "public%2fdiagram.jpg",
    "public/diagram.jpg?token=secret",
    "public/diagram.jpg#fragment",
  ]) {
    assert.equal(resolveCandidateAssetURL(source, "a-sum/problem.md", assets), null, source);
  }
});
