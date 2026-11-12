import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const check = fileURLToPath(
  new URL("../../../../scripts/check-linux-rtc-media.sh", import.meta.url)
);
const launcher = fileURLToPath(new URL("check-linux-dev-rtc.mjs", import.meta.url));

function fixture(run) {
  const directory = mkdtempSync(path.join(tmpdir(), "ams-rtc-prerequisites-"));
  const calls = path.join(directory, "calls");
  writeFileSync(calls, "");
  const executable = (name, body) =>
    writeFileSync(path.join(directory, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  executable("timeout", 'printf "timeout %s\\n" "$*" >> "$AMS_CALLS"\nshift\nexec "$@"');
  executable(
    "gst-inspect-1.0",
    'printf "inspect %s\\n" "$1" >> "$AMS_CALLS"\ncase " $AMS_MISSING " in *" $1 "*) exit 1;; esac'
  );
  executable(
    "gst-launch-1.0",
    'printf "pipeline %s\\n" "$*" >> "$AMS_CALLS"\nexit "${AMS_PIPELINE_EXIT:-0}"'
  );
  try {
    run({
      directory,
      calls: () => readFileSync(calls, "utf8"),
      env: { ...process.env, PATH: directory, AMS_CALLS: calls },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test(
  "collects missing WebRTC/DTLS/SRTP factories and stops before the media pipeline",
  { skip: process.platform === "win32" },
  () => {
    fixture(({ env, calls }) => {
      const result = spawnSync("/bin/sh", [check], {
        env: { ...env, AMS_MISSING: "webrtcbin dtlssrtpenc srtpenc" },
        encoding: "utf8",
      });
      assert.equal(result.status, 1);
      for (const element of ["webrtcbin", "dtlssrtpenc", "srtpenc"]) {
        assert.match(result.stderr, new RegExp(`unavailable: ${element}`));
      }
      assert.match(result.stderr, /gst-plugins-bad/);
      assert.match(result.stderr, /Restart the desktop app/);
      assert.doesNotMatch(calls(), /pipeline/);
    });
  }
);

test(
  "checks every factory with a timeout before running the bounded Opus/RTP pipeline",
  { skip: process.platform === "win32" },
  () => {
    fixture(({ env, calls }) => {
      const result = spawnSync("/bin/sh", [check], { env, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(calls().match(/^inspect /gm).length, 12);
      assert.equal(calls().match(/^timeout 10 /gm).length, 12);
      assert.match(calls(), /timeout 20 gst-launch-1.0/);
      assert.match(calls(), /opusenc ! rtpopuspay ! rtpopusdepay ! opusdec ! fakesink sync=false/);
      assert.match(result.stdout, /round trip available/);
    });
  }
);

test(
  "fails when a tool is missing or the media pipeline fails",
  { skip: process.platform === "win32" },
  () => {
    fixture(({ directory, env }) => {
      const pipeline = spawnSync("/bin/sh", [check], {
        env: { ...env, AMS_PIPELINE_EXIT: "1" },
        encoding: "utf8",
      });
      assert.equal(pipeline.status, 1);
      assert.doesNotMatch(pipeline.stdout, /round trip available/);
      rmSync(path.join(directory, "timeout"));
      const missing = spawnSync("/bin/sh", [check], { env, encoding: "utf8" });
      assert.equal(missing.status, 1);
      assert.match(missing.stderr, /prerequisite missing: timeout/);
    });
  }
);

test(
  "Linux development launcher propagates a failed host prerequisite check",
  { skip: process.platform !== "linux" },
  () => {
    fixture(({ directory, env }) => {
      writeFileSync(path.join(directory, "sh"), '#!/bin/sh\nexec /bin/sh "$@"\n', { mode: 0o755 });
      const result = spawnSync(process.execPath, [launcher], {
        env: { ...env, AMS_MISSING: "webrtcbin" },
        encoding: "utf8",
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /unavailable: webrtcbin/);
    });
  }
);
