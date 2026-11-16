import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { checkTurnDns } from "./check-turn-dns.mjs";

const source = 'pub const REVIEWED_VOICE_RELAY_IP: &str = "43.204.79.244";';

for (const addresses of [["43.204.79.244"], ["43.204.79.244", "43.204.79.244"]]) {
  test(`accepts the exact reviewed address set: ${addresses}`, async () => {
    assert.equal(
      await checkTurnDns(source, async (host) => {
        assert.equal(host, "turn.amsaccess.com");
        return addresses;
      }),
      "43.204.79.244"
    );
  });
}

for (const addresses of [[], ["192.0.2.1"], ["43.204.79.244", "192.0.2.1"]]) {
  test(`rejects mismatched addresses: ${addresses}`, async () => {
    await assert.rejects(
      checkTurnDns(source, async () => addresses),
      /expected only 43.204.79.244/
    );
  });
}

for (const invalid of ["", source + "\n" + source, source.replace("43.204.79.244", "::1")]) {
  test(`rejects missing or ambiguous IPv4 pin: ${invalid}`, async () => {
    await assert.rejects(
      checkTurnDns(invalid, () => assert.fail("must validate before querying DNS")),
      /exactly one reviewed IPv4/
    );
  });
}

test("DNS errors reject the release", async () => {
  await assert.rejects(
    checkTurnDns(source, async () => {
      throw new Error("DNS unavailable");
    }),
    /DNS unavailable/
  );
});

test("checks the supplied release pin, not a hardcoded copy in the checker", async () => {
  assert.equal(
    await checkTurnDns(source.replace("43.204.79.244", "192.0.2.2"), async () => ["192.0.2.2"]),
    "192.0.2.2"
  );
});

test("the checked-in native pin is readable by the release gate", async () => {
  const native = readFileSync(
    new URL("../apps/desktop/src-tauri/src/network_allowlist.rs", import.meta.url),
    "utf8"
  );
  assert.equal(await checkTurnDns(native, async () => ["43.204.79.244"]), "43.204.79.244");
});
