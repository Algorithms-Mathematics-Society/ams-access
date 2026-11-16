// Check the release's reviewed pin; DNS must never supply firewall exceptions.
import { Resolver } from "node:dns/promises";
import { readFileSync } from "node:fs";
import { isIPv4 } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function checkTurnDns(source, lookup) {
  const pins = [...source.matchAll(/^pub const REVIEWED_VOICE_RELAY_IP: &str = "([^"]+)";/gm)];
  if (pins.length !== 1 || !isIPv4(pins[0][1])) {
    throw new Error("Release source must contain exactly one reviewed IPv4 relay literal");
  }
  const expected = pins[0][1];
  const addresses = new Set(await lookup("turn.amsaccess.com"));
  if (addresses.size !== 1 || !addresses.has(expected)) {
    throw new Error(
      `turn.amsaccess.com resolves to ${JSON.stringify([...addresses].sort())}, expected only ${expected}; ` +
        "restore DNS or coordinate the reviewed firewall pin with a desktop release"
    );
  }
  return expected;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    // cwd is the immutable tagged source, even when this script is release repair tooling.
    const source = readFileSync("apps/desktop/src-tauri/src/network_allowlist.rs", "utf8");
    const resolver = new Resolver({ timeout: 5000, tries: 2 });
    const expected = await checkTurnDns(source, (host) => resolver.resolve4(host));
    console.log(`TURN DNS matches reviewed desktop relay ${expected}`);
  } catch (error) {
    console.error(`TURN DNS preflight failed: ${error.message}`);
    process.exitCode = 1;
  }
}
