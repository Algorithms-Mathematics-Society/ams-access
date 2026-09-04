# Linux: "Cannot reach the exam server"

Root-cause analysis and the Linux production-readiness backlog behind it.

Author: platform engineering · Investigated against `main` @ `1d2bad3` (tag `v2.0.8`)
Host: Ubuntu 24.04, GNOME, x86_64 · Investigated 2026-09-04

---

## Status · re-verified against `main` @ `7f9b424`

Six findings were fixed in `d6cb843`, `3240141` and `7f9b424`. Each was
re-checked in source, not taken from the commit message. Rust gates on the
merged tree: **75 tests pass** (up from 71), clippy `-D warnings` clean, fmt
clean.

| Fixed | What landed                                                                                                                                                                                                                                     |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L5    | Backup moved to `$XDG_STATE_HOME/ams-access/kb-backup`. Legacy `/tmp` path read once for migration and deleted on restore. `/tmp` write survives only as a fallback if the state dir cannot be created.                                         |
| L6    | Resolvers travel in their own `resolvers` field and get `udp/53`, `tcp/53`, `tcp/853` only. Critically they are **excluded from the wide `ips` set** (`helper.rs:596`), or the unrestricted rule would win and the scoping would be decorative. |
| P2    | An unsupported desktop now returns `unsupported(...)` through the tri-state rather than `Fail`, so Xfce/Cinnamon/Mint candidates are warned and admitted. A mechanism that exists and did not engage still blocks; tests cover both directions. |
| P4    | `xdotool` removed from `RESTRICTED`, with a comment recording why.                                                                                                                                                                              |
| P5    | Nine dependencies declared for `.deb`, twelve for `.rpm` (which previously declared none). `libayatana-appindicator3-1` dropped as unused.                                                                                                      |
| P8    | CI now installs the package on a clean `ubuntu:22.04` with `--no-install-recommends`, checks the binary, the udev rule and each runtime tool, then removes it and checks `prerm`.                                                               |

That CI job paid for itself immediately: it caught `postinst` aborting under
`set -e` on a minimal image with no `/etc/udev/rules.d`, which is `7f9b424`.
Both maintainer scripts also gained the `case "$1"` guard, which downgrades the
P8 sub-point I had already corrected down.

**Still open, all re-confirmed in source at the line numbers below:** L1, L2,
L3, L4, L7, L8, L9, L10, P1, P3, P6, P7, and F1 through F5. `apps/web/` has
**zero** changed files across the three commits, so every frontend finding
stands untouched. The `prerm` gap (helper, unit and pin not removed) is
acknowledged as outstanding in `7f9b424`'s own message.

**The login bug was reproduced live on the merged code**, in the real app, by
driving the GUI: welcome screen, sign-in, credentials, submit, and
"Cannot reach the exam server." F1 is unchanged.

---

## 0. Verdict, up front

**The screenshot is not a backend outage, not a network fault, and not a Linux
lockdown bug.** It is `pnpm dev` doing exactly what it is written to do: the
webview is served from `http://localhost:3000`, so `resolveApiBase()` returns
`http://localhost:8080`, and nothing is listening on 8080. The candidate-facing
string is the honest report of a connection refused to a dev API that was never
started.

Proven by control: the **same credentials from the screenshot**, sent to
`https://api.amsaccess.com` (what an installed build resolves to), return
**HTTP 200** with a valid token for "Test Candidate" on contest "Test Round 1".

So the bug is not "login is broken". The bugs are:

1. There is **no supported way to point a dev build at a real API**, so the
   normal rehearsal loop dead-ends here. (§3, F1)
2. The error message **names the wrong remedy** and hides the one fact that
   would have ended this in five seconds: which host was actually called. On
   exam day this costs an invigilator the exam window. (§3, F2)
3. The "Get help" escape hatch offered on that very screen **posts to the same
   unreachable host**, so the lifeline fails silently whenever it is needed.
   (§3, F3)

Items 2 and 3 are candidate-facing and ship today.

**And then the investigation found worse.** Sweeping the Linux lockdown
lifecycle and packaging for the same class of defect turned up items that
outrank the login bug by a wide margin: a crash plus a reboot **permanently
disables the candidate's keyboard and touchpad** with no recovery path (L5); the
egress lockdown can be **defeated by editing one file** while reporting itself
engaged (L6); every Xfce, Cinnamon and Linux Mint candidate is **hard-blocked
from entering the contest** (P2); and the keyboard lockdown **reports success
without checking that any of it applied** (P1).

If you read one section, read §8. If you read one finding, read L5.

---

## 1. Evidence chain

Collected before any hypothesis was committed to. Each line eliminates at least
one candidate cause.

| #   | Observation                                            | Command                                                                   | Result                                                                                          |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| E1  | Backend is healthy                                     | `curl -X POST https://api.amsaccess.com/participant/login`                | `HTTP/2 401`, JSON body, 1.08 s, `server: uvicorn`, `via: 1.1 Caddy`                            |
| E2  | DNS resolves                                           | `getent hosts api.amsaccess.com`                                          | `65.2.229.179`                                                                                  |
| E3  | TLS chain valid                                        | `openssl s_client -connect api.amsaccess.com:443`                         | `issuer=C=US, O=Let's Encrypt, CN=YE2`, `Verify return code: 0 (ok)`                            |
| E4  | WebKitGTK TLS backend present on this host             | `ls /usr/lib/x86_64-linux-gnu/gio/modules/`                               | `libgiognutls.so` present, `glib-networking 2.80.0` installed                                   |
| E5  | A dev stack is running                                 | `ps -eo pid,etime,args`                                                   | `turbo run dev` → `next dev` (25 min) and `tauri dev` → `target/debug/ams-access` (PID 1424195) |
| E6  | Dev server is on 3000                                  | `ss -ltnp`                                                                | `LISTEN *:3000 next-server`                                                                     |
| E7  | **Nothing is on 8080**                                 | `curl http://localhost:8080/participant/login`                            | `curl: (7) Failed to connect to localhost port 8080`                                            |
| E8  | The resolver picks 8080 for that origin                | `apiBaseForLocation({protocol:"http:",hostname:"localhost",port:"3000"})` | `http://localhost:8080`                                                                         |
| E9  | Reproduction                                           | real `fetch` to the resolved base                                         | `TypeError \| ECONNREFUSED`                                                                     |
| E10 | **Control**                                            | same credentials → `https://api.amsaccess.com`                            | `HTTP 200`, token issued, contest returned                                                      |
| E11 | Only one GUI process exists, and it is the debug build | `ps`                                                                      | installed `/usr/bin/ams-access` is **not running**                                              |

E9 and E10 together are the confirmation: identical request, identical
credentials, the only variable is the base URL.

### The exact path

```
tauri.conf.json  devUrl: "http://localhost:3000"
        │
        ▼
window.location = { protocol:"http:", hostname:"localhost", port:"3000" }
        │
        ▼
apps/web/src/lib/api-base.ts:38  apiBaseForLocation()
        isDevServer === true   ->   DEV_API_URL = "http://localhost:8080"
        │
        ▼
apps/web/src/lib/proctor-api.ts:199  fetch(`${API}/participant/login`)
        ECONNREFUSED  ->  TypeError
        │
        ▼
proctor-api.ts:206-214   catch: controller.signal.aborted === false
        throw new ProctorApiError("Cannot reach the exam server.", 0, "UNREACHABLE")
        │
        ▼
apps/web/src/app/login/page.tsx:65   if (caught.status === 0)
        "Cannot reach the exam server. Check the network, or ask an invigilator."
```

CSP is **not** involved. `devCsp` allows `http://localhost:*`, so the request
was permitted and failed at the TCP layer. Confirmed by E7.

---

## 2. Why the safeguards missed it

Five questions, per root-cause discipline.

**What happened.** A dev build called a dev API that was not running.

**Why it happened.** `apiBaseForLocation` hard-codes `http://localhost:8080` as
the only possible dev target, and `resolveApiBase` deliberately refuses to read
`NEXT_PUBLIC_API_URL`. That refusal is correct and well earned: a stale
repository secret baked a dead Cloud Run host into every v2.0.0 installer and
produced _this identical error string_ on a healthy API
(`RELEASE.md` §"The API host is not configurable, deliberately"). But the fix
removed the override without replacing it, so the supported set of dev targets
went from "anything" to "exactly one, which you must also run yourself".

**Why safeguards failed.** They didn't, technically. `api-base.test.mjs`
asserts `DEV_SERVER → DEV` and that is the behaviour observed. The guard tests
pin the _decision_; nothing pins the _outcome_ of that decision being useful.
There is no test, and no runtime check, that anything answers at the chosen
base.

**Why undetected.** The failure surfaces only when a human runs `pnpm dev`
without the Go API, which CI never does and which no test can see.

**The broken assumption.** "Dev always means a local backend on 8080." That was
true when the Go API ran locally. It is false the moment anyone rehearses a UI
change against the real contest API, which is now the common case, because the
backend moved off localhost and the desktop UI is the thing being iterated on.

---

## 3. Fixes

Ranked by exam-day value per unit of risk.

### F1 · Give dev a supported target, without reopening the v2.0.0 hole

**Problem.** No way to run `tauri dev` against a real API.

**Constraint that governs the design.** Two production outages came from
build-time env vars silently overriding the production host. Any override must
be _structurally_ incapable of affecting a release build, not merely
discouraged by a comment.

**The key property.** A release bundle is served from `tauri://localhost`
(Linux/macOS) or `http://tauri.localhost` (Windows). Neither has port `3000`.
So an override read **inside** the `isDevServer` branch is unreachable from
every shipping origin, even if a rogue CI secret bakes it into the bundle.

`apps/web/src/lib/api-base.ts`:

```ts
/**
 * Where a DEV BUILD points. Release builds never read this.
 *
 * `NEXT_PUBLIC_API_URL` stays banned: it short-circuited before the origin
 * check, so it could and did override production. This one is consulted only
 * after `apiBaseForLocation` has already established we are on the Next dev
 * server (protocol http/https, host localhost, port 3000): an origin no
 * shipped bundle can have. Baking it into a release build is therefore inert,
 * which is the property `NEXT_PUBLIC_API_URL` lacked.
 */
export function apiBaseForLocation(location: LocationLike | null, devApiUrl?: string): string {
  const isDevServer =
    location !== null &&
    (location.protocol === "http:" || location.protocol === "https:") &&
    (location.hostname.toLowerCase() === "localhost" || location.hostname === "127.0.0.1") &&
    location.port === DEV_SERVER_PORT;

  // Release origins resolve to one constant, with nothing else consulted.
  if (!isDevServer) return PROD_API_URL;

  const override = devApiUrl?.trim();
  return override && override.length > 0 ? override : DEV_API_URL;
}

export function resolveApiBase(): string {
  return normalize(
    apiBaseForLocation(
      typeof window === "undefined" ? null : window.location,
      process.env.NEXT_PUBLIC_DEV_API_URL
    )
  );
}
```

**Immediate unblock, no code change required:**

```bash
NEXT_PUBLIC_DEV_API_URL=https://api.amsaccess.com \
  pnpm --filter @ams/desktop dev      # after F1 lands
```

`devCsp` already allows `https://api.amsaccess.com`
(`csp-allows-api-base.test.mjs` asserts it), so this needs no CSP change. An
override pointing anywhere _else_ is blocked by `devCsp`, which is a useful
accident: the override cannot silently redirect a dev session to an arbitrary
host.

**Until F1 lands**, either run the Go API on `:8080`, or temporarily edit
`DEV_API_URL`. Do not set `NEXT_PUBLIC_API_URL`; it is ignored.

**Test-suite consequence.** `csp-allows-api-base.test.mjs:92` is named
"the API host cannot be overridden by the environment at all". After F1 that
name overclaims. It still passes (it runs under Node, where `window` is
undefined, so it takes the production branch), but rename it to
"the production branch cannot be overridden by the environment" and add:

```ts
test("a tauri origin ignores the dev override even when it is set", () => {
  assert.equal(apiBaseForLocation(TAURI_UNIX, "https://somewhere-else.example"), PROD);
  assert.equal(apiBaseForLocation(TAURI_WINDOWS, "https://somewhere-else.example"), PROD);
});

test("the dev server honours the override, and falls back without one", () => {
  assert.equal(
    apiBaseForLocation(DEV_SERVER, "https://api.amsaccess.com"),
    "https://api.amsaccess.com"
  );
  assert.equal(apiBaseForLocation(DEV_SERVER, "   "), DEV);
  assert.equal(apiBaseForLocation(DEV_SERVER, undefined), DEV);
});
```

Both fail on the un-fixed code (the second argument does not exist), which is
the bar.

**Risk:** Low. The production branch returns before the override is read.

---

### F2 · Say which host failed, and stop conflating timeout with refused

**Problem.** `login/page.tsx:65` collapses `TIMEOUT` and `UNREACHABLE` into one
sentence, and that sentence tells the reader to check the network, which in this
incident was perfect. Nothing anywhere records the URL that was attempted. An
invigilator handed this message has no way to distinguish a wrong host, a dead
DNS, a stale firewall allowlist, and an actual outage.

This is the highest-value fix in the document. It does not prevent a single
failure; it converts every future one from a 20-minute misdiagnosis into a
5-second read.

**Carry the base on the error.** `proctor-api.ts` already has a `detail` field
typed `Record<string, unknown> | null`, currently unused on this path:

```ts
} catch (err) {
  const aborted = controller.signal.aborted;
  throw new ProctorApiError(
    aborted ? "The server did not respond in time." : "Cannot reach the exam server.",
    0,
    aborted ? "TIMEOUT" : "UNREACHABLE",
    // Which host, and how long we waited. Without this the message names a
    // remedy ("check the network") that is wrong more often than it is right.
    { api_base: API, path, timeout_ms: timeoutMs }
  );
}
```

**Surface it without alarming the candidate.** Keep the calm sentence, add a
quiet monospace diagnostic line beneath it. `login/page.tsx`:

```ts
if (caught.status === 0) {
  const host =
    typeof caught.detail?.api_base === "string"
      ? new URL(caught.detail.api_base).host
      : "the exam server";
  setError(
    caught.code === "TIMEOUT"
      ? "The exam server did not respond in time. Wait a moment and try again, or ask an invigilator."
      : "Cannot reach the exam server. Ask an invigilator."
  );
  setDiagnostic(`${host} · ${caught.code}`); // rendered small + monospace
  return;
}
```

The host is not a secret: it is in the binary, in the CSP, and in the DNS. What
it buys is that `localhost:8080 · UNREACHABLE` and
`api.amsaccess.com · TIMEOUT` are different sentences, and the second one is
the only one where "check the network" is sound advice.

Note the wording change: drop "Check the network" from the UNREACHABLE case.
A refused connection to a host that resolves is not a network problem, and
sending an invigilator to the router is the specific waste this incident
demonstrates.

**Leave a trace.** Login failures currently produce no record anywhere: no
console line, no violation, no proctoring event (verified: `login/page.tsx` and
`proctor-api.ts` contain no logging calls at all). Add one:

```ts
void invoke("log_proctoring_event", {
  kind: "api_unreachable",
  detail: `${caught.code} calling ${host}`,
  payload: { api_base: caught.detail?.api_base, code: caught.code, phase: "login" },
}).catch(() => {});
```

`log_proctoring_event` needs no session (`lib.rs:1687` writes straight to the
JSONL spool), so this works pre-login and is uploaded later once
`configure_event_stream` arms the uploader.

**Separate TLS failure from unreachable, and stop letting readiness contradict
the login screen.** Two additions that belong with this fix:

1. A `TypeError` whose message mentions `SSL`, `TLS` or `certificate` should
   surface as code `TLS_BROKEN`, not `UNREACHABLE`, with copy naming the actual
   remedy. On the `.rpm` and AppImage this is a live case (P5, P6): a missing
   `ca-certificates` or `glib-networking` breaks every webview HTTPS call while
   leaving the machine perfectly online.
2. The readiness network probe does not use the stack the exam uses. `lib.rs:1316-1345`
   opens raw `tokio::net::TcpStream` sockets to ports 443/80/53, and the only
   TLS call goes through `pinned_http_client_builder()`, which is statically
   linked **rustls** with roots compiled into the binary. It never touches
   glib-networking, GnuTLS, or `/etc/ssl/certs`. So on a machine with a broken
   system trust store, readiness reports "network reachable with excellent
   quality" in green **while login fails every time**. The invigilator opens a
   browser, the internet works, and there is no path from that symptom to the
   cause.

   Fix: have Stage 11 issue one webview `fetch()` to the API and report _that_
   result alongside the TCP probe. A proctoring client should test the path the
   exam actually uses.

**Risk:** Low. Presentation, one extra spool write, one extra request.

---

### F3 · The escape hatch calls the server it exists to escape

**Problem.** `HelpRequestModal` posts to
`${API_URL}/participant/support-incidents` (`HelpRequestModal.tsx:68`), where
`API_URL = resolveApiBase()` (line 7). On the login screen it is offered as
"Can't sign in? Get help" **specifically underneath a "cannot reach the server"
error**. The only remedy presented to a candidate whose client cannot reach the
API is a request routed through the API they cannot reach.

This is not theoretical. It fires in exactly the state where the candidate
needs it most, and it fails without explaining why.

**Fix.** Detect the unreachable case and degrade honestly rather than
pretending to submit:

- When the last error was a status-0, do not present the modal as "we will
  notify your organizer". Present it as _"show this to your invigilator"_: a
  copyable block containing login id, app version, the attempted host, the
  error code, and a timestamp.
- Write the same block to the local proctoring spool so it survives the
  session and reaches the organizer once connectivity returns.
- Keep the network submit as a best-effort attempt behind it, not as the
  promise.

**Risk:** Low. It only widens behaviour in a state that currently fails 100%.

---

### F4 · Preflight the API before the candidate types anything

**Problem.** Reachability is discovered at the moment of highest cost: after a
candidate has entered credentials, usually with a queue behind them.

**Fix.** At app start, issue one cheap `GET ${api_base}/health` from the
**pinned Rust client** and record the outcome. The machinery already exists:
`measure_clock_skew` (`lib.rs:1414`) performs precisely this request and reads
the `Date` header. Extend it to also report reachability, emit a proctoring
event, and expose a quiet status indicator on the login screen
("Exam server: reachable · clock in sync").

Use `/health`, not the bare base. Verified today: `GET /health` returns **200**,
while `GET /` returns **404**. A 404 still proves reachability and still carries
a `Date` header, which is why `measure_clock_skew` works as written, but a
health check that reads as a 404 is one refactor away from being "fixed" into a
failure signal.

This is the difference between a proctoring client and a web app. The client
should know whether it can do its job before a candidate is depending on it.

Second benefit: because it runs through the pinned client, a TLS interception
box on an exam-centre network is detected at launch rather than mid-contest.

**Risk:** Medium-low. One request at startup; must be non-blocking and must
never gate launch on its own.

---

### F5 · The documented "start everything" command starts two dev servers · High

**Found while re-checking this report, not during the original investigation.**
It does not cause the login error, but it was running the whole time and it
explains an anomaly I had set aside as a curl artifact.

`curl http://localhost:3000/` and `/login/` both return **HTTP 500**, while the
app renders the page correctly. The reason:

```
:3000  next-server pid 1424137   <- parent: turbo run dev  ->  @ams/web dev
:3001  next-server pid 1424297   <- parent: tauri dev -> beforeDevCommand -> @ams/web dev
```

Root `pnpm dev` is `turbo run dev`, which runs the `dev` task in **every**
workspace package: `@ams/web` (`next dev`) and `@ams/desktop` (`tauri dev`). And
`tauri.conf.json`'s `beforeDevCommand` is
`pnpm --filter @ams/desktop prepare:helper && pnpm --filter @ams/web dev`, which
starts `next dev` a **second** time. The second instance finds 3000 taken and
falls back to 3001.

Both compile into the same `apps/web/.next` directory. Two Next compilers
writing one build directory corrupt each other's manifests, which is what
produces the 500s. Tauri's `devUrl` points at 3000, so the webview loads from
the server being corrupted by the other one.

`markdowns/CLAUDE.md` documents `pnpm dev # start everything (Tauri + Next.js
hot reload)`. That command is the bug.

**Fix**, cheapest first:

1. Document `pnpm --filter @ams/desktop dev` as the single entry point. It
   already starts the web server exactly once via `beforeDevCommand`.
2. Better, make the wrong command impossible: remove the `dev` script from
   `apps/web/package.json` and give it a differently-named one that
   `beforeDevCommand` calls, so `turbo run dev` has only `@ams/desktop` to run.
3. Or set `"dev": { "persistent": true, "cache": false }` with an explicit
   filter in the root script: `turbo run dev --filter=@ams/desktop`.

**Why this matters beyond tidiness.** A dev loop that intermittently 500s is a
loop where a real regression looks like flakiness and gets retried instead of
investigated. It also cost time in this very investigation: I nearly wrote the
500 off as a Pages-Router quirk.

---

## 4. Linux production-readiness findings

These are independent of the login incident. They were found by sweeping the
Linux lockdown lifecycle, and every claim below was verified against source
before being written here.

**The theme: Linux is the only platform with no startup firewall
reconciliation, and its recovery paths were written for macOS.** Windows
(`lib.rs:2437-2439`) and macOS (`lib.rs:2488-2490`) both spawn a
`disable_network_lockdown` thread at launch. Linux deliberately does not
(`lib.rs:2423-2427`), delegating to the helper, which reconciles only on **its
own** startup. The helper is a long-lived systemd unit that never learns the
app died. That single gap is the root of L1, L2 and L3.

### L1 · A crash strands the candidate behind the previous session's firewall · Critical

`firewall_enable` writes `/run/ams-proctor.lock` and builds the chain
(`helper.rs:559-571`). If the app then dies without a catchable signal, the
kernel keeps the rules and the marker persists in tmpfs. Reachable via SIGKILL,
an OOM kill, or a WebKitGTK `SIGSEGV`/`SIGABRT`: note that `lib.rs:2405-2408`
installs handlers for SIGINT/SIGTERM/SIGQUIT/SIGHUP only, so a fault signal runs
the default action and no teardown at all. (I have not measured this app's
memory ceiling, so treat the OOM path as plausible rather than demonstrated;
SIGKILL and the fault signals stand on the code alone.)

On relaunch, nothing touches the firewall. If the API IP and DNS servers are
unchanged the next successful stage-13 silently overwrites the chain and it
self-heals. If **either** changed, which is exactly what happens when a
candidate tethers to a phone or the API is redeployed, login itself is blocked
and there is no path forward short of a reboot.

**Fix:** store the owning client PID in the `Marker` (`helper.rs:78-82`) and
have the helper check on each accept, plus a 5s liveness thread, whether that
PID is alive with the pinned exe. If not, flush and drop the marker.

### L2 · The disable token dies with the process, so recovery is structurally impossible · Critical

```rust
static SESSION_TOKEN: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);   // linux/mod.rs:1171
```

Verified: `disable_network_lockdown` sends `unwrap_or_default()`, i.e. `""`
(`linux/mod.rs:1272-1277`), and `authorize_disable` rejects an empty token
against a live marker (`helper.rs:122-130`). A relaunched process therefore
**cannot ever** lift its predecessor's lockdown. Only a reboot clears it, and
nothing in the product says so.

**Fix:** persist the token to a 0600 file under `/run/user/<uid>/ams-access/`
(same boot scope as the marker) and read it back when `SESSION_TOKEN` is
`None`. The helper already authenticates the peer by pinned exe path, so this
does not weaken the control.

### L3 · The only recovery UI tells a Linux candidate to restart their Mac · Critical

Verified verbatim at `SettingsPanel.tsx:190-193`:

> "Some settings could not be restored automatically. Relaunch AMS Access, it
> re-runs recovery on startup, or restart your Mac."

Both halves are wrong on Linux. Relaunching re-runs **keyboard** recovery only
(`lib.rs:2426-2427`); the firewall is untouched. And the machine is not a Mac.
This is the single recovery affordance in the product, and on the platform with
the worst stranding behaviour it gives instructions that cannot work.

**Fix:** platform-branch the copy, and offer a real escape: a `force_disable`
authorised by the pinned exe path rather than the session token.

### L4 · Teardown reports success while the rules are still applied · Critical

```rust
Err(e) if e.starts_with(HELPER_CONNECT_ERR_PREFIX) => Ok(()),   // linux/mod.rs:1284
```

The comment reasons that an unreachable helper means nothing to flush. That is
false: iptables rules live in the kernel and outlive the daemon. A stopped,
masked, or uninstalled helper leaves `AMS_PROCTOR` hooked into `OUTPUT`
permanently, and every caller reports success. The window-destroy path discards
the result (`lib.rs:2659`), the signal handler discards it (`lib.rs:2378`), and
`SettingsPanel` then prints "network access **has been restored**"
(`SettingsPanel.tsx:196-198`) when it has not.

Compounded by `debian/prerm`, verified: it removes **only** the udev rule. Not
the helper binary, not the systemd unit, not the pinned client config. So
`apt remove ams-access` leaves a root daemon running against a deleted binary.

**Fix:** return a distinct `Err("helper_unreachable_rules_may_persist")`, and
surface a copyable manual flush
(`pkexec iptables -D OUTPUT -j AMS_PROCTOR; iptables -F AMS_PROCTOR; iptables -X AMS_PROCTOR`,
plus the ip6tables equivalent). Add helper, unit and pin removal to `prerm`.

### L5 · A reboot permanently destroys the candidate's desktop settings · Critical

The sole record of the candidate's pre-exam GSettings, including the touchpad
`send-events` value (`linux/mod.rs:686-697`), is:

```rust
const BACKUP_PATH: &str = "/tmp/ams_access_kb_backup";   // linux/mod.rs:267
```

The values it restores live in **dconf, which is permanent**. Verified on this
host: `/usr/lib/tmpfiles.d/tmp.conf:11` is `D /tmp 1777 root root 30d`, and
systemd-tmpfiles runs `--create --remove --boot`, so the `D` directive **empties
`/tmp` at every boot**.

Sequence: app is SIGKILLed mid-exam, candidate reboots to recover, backup is
gone, `recover_keyboard_if_crashed` finds nothing. Super, Alt+Tab, Alt+F4,
screenshot, hot corners and the touchpad stay disabled **permanently**, with no
remaining in-app recovery. On a laptop with no external mouse that is an
unusable machine, caused by our exam software, after the exam is over.

This is the finding I would fix first. It is the only one whose blast radius
outlives the contest.

**Fix:** move the backup to `$XDG_STATE_HOME/ams-access/kb-backup` (fallback
`~/.local/state/ams-access/`), which shares dconf's persistence. Read the old
`/tmp` path once for migration. Ship a `--restore-desktop` CLI flag so recovery
does not require the GUI to start.

### L6 · Resolver allowlisting is a full egress bypass · Critical (security)

Verified: `build_chain` emits `-A AMS_PROCTOR -d <ip> -j ACCEPT`
(`helper.rs:779`) with **no protocol or port scoping**, and `lib.rs:1777-1780`
explicitly declines to port-scope resolvers ("We add the resolver _host_ ...
rather than port-scoping"). `parse_resolv_nameservers` accepts any IP literal
(`lib.rs:1809-1823`).

A candidate installing at home is root on their own laptop. Writing
`nameserver 203.0.113.7` into `/etc/resolv.conf` before launch allowlists an
arbitrary internet host on **every port and protocol**. SSH, WireGuard, or a
plain HTTP proxy all work through it. The lockdown is defeated end to end while
the UI reports "engaged" and the readiness report records a pass.

This is the most serious finding in the document on its own merits. Every other
item costs a candidate their exam; this one costs the contest its integrity.

**Fix:** emit resolver entries as two scoped rules per address
(`-p udp --dport 53`, `-p tcp --dport 53`, optionally 853), never a bare `-d`.
Log a `suspicious_resolver` proctoring event when a resolver is neither
loopback, RFC1918, nor on a known-public-resolver list.

### L7 · The allowlist is a one-time DNS snapshot · High

There is no re-resolution anywhere. Consequences:

- **Roaming breaks name resolution, and that is enough.** The new network's
  resolvers are not in the snapshot, so every lookup is DROPped and the app
  cannot find the API even though the API's IP is still allowlisted. The
  candidate has working Wi-Fi, a working internet connection for any other
  device, and an exam client that cannot resolve a hostname.

  **Correction to an earlier draft of this document, which claimed DHCP itself
  was blocked. It is not.** The chain filters `filter/OUTPUT`, which hooks
  locally-generated packets at the IP layer. NetworkManager's internal DHCP
  client (this host: NetworkManager active, no `dhclient`) sends DISCOVER and
  REQUEST over **AF_PACKET raw sockets**, which inject below the IP layer and
  bypass that hook entirely. Address acquisition therefore still works. Only
  the T1 unicast renewal uses an ordinary UDP socket and would be dropped, and
  that falls back to a broadcast rebind at T2 over raw sockets again. ARP is
  link-layer and unaffected.

  What _is_ additionally dropped: **IPv6 NDP**, since neighbour and router
  solicitation are ICMPv6 and the v6 chain is built whenever the stack exists
  (`helper.rs:856-858`). Arguably intended, given v6 egress is meant to be
  blocked, but it makes dual-stack failures slow (happy-eyeballs timeouts)
  rather than clean.

- **An API IP change is a hang, not an error.** The terminal rule is `DROP`,
  not `REJECT`, so the candidate sees autosave spinners that never resolve
  rather than a fast failure. Note the API is documented as Cloudflare DNS-only
  (`api-base.ts:4-7`); the day the orange cloud is enabled, the snapshot
  becomes one anycast member and this breaks for everyone within minutes.

**Fix:** spawn a 30s re-resolve thread that re-runs `to_socket_addrs` on the
allowlist hosts **and** `resolv_conf_nameservers()`, and re-sends `enable` with
the same token when the resolved set changes. `firewall_enable` is already
idempotent and teardown-first (`helper.rs:876-879`), so this is safe to repeat.
Re-reading `resolv.conf` on each pass is what makes roaming survivable, and it
is the part that matters. Changing `DROP` to `REJECT --reject-with
icmp-admin-prohibited` would additionally turn silent hangs into fast, legible
failures.

### L8 · The pinned client path is a single value with no fallback · High (live on this machine)

`authorize_client` strong mode requires an exact match and deliberately does
not fall back to the basename allowlist (`helper.rs:419-429`). The pin is one
path, overwritten by whichever build last ran the installer. So alternating
between an installed package and a dev build re-prompts for an admin password
every launch, and `cargo clean` bricks the helper for every client.

The candidate-visible result is worth stating precisely, because it is
misleading: stage 11 shows an amber "Network lockdown helper unavailable" and
**passes anyway**, then stage 13 blocks with "We couldn't secure your network
for the exam ... the proctoring network component may not be installed or still
needs your permission", with no retry button. The real reason, a path mismatch,
appears only in a proctoring-event payload.

**Fix:** make the pin a newline-separated allowlist that `install_network_helper`
appends to. Map `unauthorized client:` to a distinct error code and give
`network-gate.ts` a block variant that says the app is not the build this
machine was set up for, with a button that invokes `install_network_helper`.
Surface `network_helper_status()`'s reason string in the stage-11 line.

### L9 · The signal handler is not async-signal-safe and can deadlock into a SIGKILL · High

`handle_sigterm` (`lib.rs:2370-2389`) runs the **entire teardown inside the
signal handler**: `unlock_desktop` (`linux/mod.rs:1014`) plus
`disable_network_lockdown`, which between them allocate, take a
`std::sync::Mutex`, fork and exec `gsettings`/`kwriteconfig5`/`xinput`, and do
socket I/O.

The always-true hazard is that **none of those are async-signal-safe**. A signal
delivered while the interrupted thread is inside `malloc` and then calling
`malloc` again from the handler is a self-deadlock, and that window is open for
most of the process's life. `Command::spawn` between `fork` and `exec` is the
same class of problem.

There is also a narrower, concrete instance: `disable_keyboard_intercept`
(`:1020`) takes the non-reentrant `SAVED_BINDINGS` mutex, and
`enable_keyboard_intercept` holds it at `:569`. A signal delivered to that
specific thread inside that window self-deadlocks;
`unwrap_or_else(|e| e.into_inner())` handles poisoning, not self-deadlock.

**Correction to an earlier draft**, which implied `unlock_desktop` always takes
that lock. It does not: `set_touchpad_enabled(true)` skips the lock entirely,
because the backup is only written on the disable path (`:686-697`). Only
`disable_keyboard_intercept` locks. That makes the lock race narrow; it does not
make the handler safe, because the allocator hazard is not narrow.

Either way the session manager escalates to SIGKILL after its grace period,
landing the machine in L1 plus L5.

**Fix:** the handler writes one byte to a self-pipe and returns; a pre-spawned
thread does the teardown and `_exit`s. One thread, standard pattern, and it
removes the whole class rather than the one instance.

### L10 · Two smaller correctness gaps · Medium

- **Timeout inversion.** The JS wrapper allows 8s (`page.tsx:459-465`) while
  `helper_send` allows 10s (`linux/mod.rs:1202-1204`), and JS cannot cancel a
  Tauri invoke. A slow-but-successful enable therefore lands after the UI has
  already decided "blocked": the candidate is stopped by a banner saying their
  network could not be secured while their internet has in fact just been cut.
  Force-quitting from there is precisely the L1/L2 strand. Fix: raise the JS
  timeout above the Rust one (12s). An earlier draft also suggested bounding
  `helper_connect`; that is not worth doing, because `UnixStream::connect` on a
  filesystem socket either succeeds immediately or fails immediately, so there
  is no meaningful connect timeout to add. The 10s **read** timeout in
  `helper_send` is the only clock that matters here.
- **The `"localhost"` allowlist fallback.** `getNetworkLockdownAllowlistHost()`
  returns `"localhost"` if `new URL(API_URL)` throws
  (`support.ts:16-21`, duplicated in `home/components/utils.ts:93-98`). That
  resolves to `127.0.0.1`, a valid IP, so the empty-allowlist guard
  (`helper.rs:872-874`) does not fire and the chain is built allowing loopback
  only, while `enable_network_lockdown` returns `Ok` and the gate reports
  "engaged". Unreachable today because `API_URL` is a constant. **It becomes
  reachable the moment F1 lands**, so F1 must delete the fallback and throw.

### Teardown coverage

| Exit path                                 | Firewall                        | Keyboard bindings         | Touchpad                  |
| ----------------------------------------- | ------------------------------- | ------------------------- | ------------------------- |
| Clean quit / emergency exit               | restored                        | restored                  | restored                  |
| Window `Destroyed` (`lib.rs:2650-2660`)   | restored, but see L4            | restored                  | restored                  |
| SIGTERM/INT/QUIT/HUP (`lib.rs:2370-2389`) | restored unless L9 deadlocks    | same                      | same                      |
| **SIGSEGV / SIGABRT / SIGBUS**            | **not restored** (no handler)   | not until next launch     | not until next launch     |
| SIGKILL / OOM kill                        | **not restored**                | not until next launch     | not until next launch     |
| Power loss / hard reboot                  | restored (tmpfs + kernel clear) | **permanently lost (L5)** | **permanently lost (L5)** |

---

## 4B. Packaging, dependencies and desktop coverage

A premise correction first, because it was mine and it was wrong. I assumed
`glib-networking` (the GIO TLS module WebKitGTK needs for HTTPS) was only a
`Recommends` of libsoup and could therefore be absent under
`--no-install-recommends`. It is not. Verified:

```
libwebkit2gtk-4.1-0  Depends: ... libsoup-3.0-0 (>= 3.0.3)
libsoup-3.0-0        Depends: glib-networking, ...
```

apt cannot satisfy the webview without it, so the `.deb` is safe. The TLS
exposure is real only for the `.rpm` and the AppImage, plus `ca-certificates`,
which genuinely appears in no dependency chain at all (P5).

### P1 · The keyboard lockdown reports success without checking anything · Critical

`enable_keyboard_intercept` ends both the GNOME and KDE branches with an
unconditional `active: true` (`linux/mod.rs:590`, `:646`). Nothing is counted.
`gsettings_set` (`:498`) returns `()` and silently early-returns; both
`kwriteconfig_set` (`:532`) and `kde_reconfigure` (`:546`) are `let _ = ...`.
`lock_desktop` (`:1011`) returns that same fabricated boolean.

It flows straight into policy: `core-rs:673-679` passes whenever
`keyboard.active`, and `Stage3_KeyboardLockdown.tsx:71-78` gates on it. The
comment at `lib.rs:730-741` calls this a "transactional probe" that "proves the
intercept can engage". It proves nothing.

**Candidate symptom:** Stage 3 shows four green "Ready" badges, the readiness
modal is green, the organizer's record is green, and Alt+Tab works normally for
the whole exam. Worse than a visible failure, because both sides believe it.

**Fix:** have `gsettings_set` return `bool` (exit status **and** a read-back
`gsettings_get` matching the written value), count applications, set
`active = applied > 0`, and report `method: "gsettings/x11 (7/21 applied)"` so a
partial apply is legible rather than binary.

### P2 · Xfce, Cinnamon, MATE, LXQt and every tiling WM are hard-blocked · Critical

```rust
let is_gnome = desktop.contains("gnome") || desktop.contains("ubuntu");   // :565
let is_kde   = desktop.contains("kde")   || desktop.contains("plasma");   // :566
```

`XDG_CURRENT_DESKTOP` is `XFCE`, `X-Cinnamon`, `MATE`, `LXQt`, `sway`, `i3` or
`Pantheon` on those desktops. None match, so `:652-656` returns
`active: false, method: "unsupported"`. `core-rs:302` downgrades
`KeyboardLockdown` to advisory only when `is_macos`, so Linux under
`strict_contest` keeps `required + Block`, and `evaluate_requirement` turns it
into a blocking `KeyboardLockdownUnavailable`.

**Candidate symptom:** Linux Mint (Cinnamon is its default), Xubuntu, MX Linux,
Manjaro Xfce and any tiling-WM user cannot start the contest at all. Readiness
says "keyboard lockdown unavailable on linux (method: unsupported)" and offers
"Retry scan", which fails identically forever, and "Contact organizer". Stage 3
only warns, so the block lands at the home readiness modal: after install, after
login, minutes before the contest.

This is the highest-probability candidate-facing defect in the document. Mint
alone is a large share of desktop Linux.

**Fix, two parts, both needed.** (1) Give these desktops a generic X11 path:
`XGrabKey` on the root window for Alt+Tab / Super / PrintScreen, or at minimum
`_NET_WM_STATE_FULLSCREEN` + `_NET_WM_STATE_ABOVE` plus the focus watchdog,
reported as `method: "x11-grab"`. (2) Until that exists, mirror the macOS
carve-out at `core-rs:302` for unsupported Linux desktops so the candidate is
admitted onto the invigilator's warning list instead of locked out. Being
under-proctored and visible beats being excluded.

### P3 · On GNOME Wayland the only native signal is one the candidate can suppress · Critical

Both watchdogs gate on `std::env::var("DISPLAY").is_err()` (`:820`, `:942`).
That is the wrong signal: XWayland sets `DISPLAY` on GNOME and KDE Wayland, so
the threads spawn, poll `xdotool search --pid` against a native Wayland window
that has no X11 id, and return silently at the 10 s deadline (`:846`, `:955`).
The comment at `:803-807` asserts no watchdog is needed on Wayland because
gsettings covers it. That is true on GNOME and KDE and false everywhere else.

What an exam actually enforces:

| Session                  | Keyboard                  | Workspace switch     | Focus loss    | Touchpad             |
| ------------------------ | ------------------------- | -------------------- | ------------- | -------------------- |
| GNOME / X11              | gsettings (unverified P1) | needs xdotool+wmctrl | needs xdotool | gsettings            |
| GNOME / Wayland          | gsettings (unverified P1) | **none**             | **none**      | gsettings            |
| KDE / X11                | kwriteconfig5 if present  | needs xdotool+wmctrl | needs xdotool | xinput if present    |
| KDE / Wayland            | kwriteconfig5 if present  | **none**             | **none**      | unverified KDED DBus |
| **Xfce/Cinnamon/MATE**   | **none**, blocked (P2)    | none                 | none          | xinput on X11 only   |
| **sway / Hyprland / i3** | **none**, blocked (P2)    | none                 | none          | none                 |

On GNOME Wayland, the most common modern Linux desktop, the only native
proctoring signal is the webview `blur`/`visibilitychange` handler, which is
precisely the one a candidate can suppress from the page. The `/proc`-based
process scan and VM detection are the only checks that genuinely work
everywhere.

**Fix:** replace both `DISPLAY` gates with `detect_display_server() == "x11"`;
the function already exists at `:243`. For Wayland focus loss use
`org.gnome.Shell.Introspect` over DBus (GNOME) or
`zwlr_foreign_toplevel_manager_v1` (wlroots). Correct the comment at `:803-807`.

### P4 · The kill shield SIGKILLs the app's own watchdog helper, then files it as a candidate violation · High

`"xdotool"` is entry 15 of `RESTRICTED` (`linux/mod.rs:29`). The app itself
spawns `xdotool` from five sites (`:810, :832, :878, :923, :969`), every 250 ms
from the workspace watchdog and every 500 ms from the focus watchdog.
`spawn_kill_shield` (`:781-800`) scans `/proc` each second and `kill -9`s
anything whose identity matches. `Command::new("xdotool")` sets both argv[0] and
`/proc/<pid>/exe` basename to `xdotool`, so it matches. `lock_desktop` (`:1005`)
starts all three threads in the same call.

It then gets reported: `client.tsx:2068` runs `scan_processes` every 5 s and
`:1980-2032` raises `blocked_app_started`, sets `proctoringOk = false`, and
POSTs an incident.

**Candidate symptom:** on exactly the X11 machines where the watchdogs are meant
to work, a "blocked application detected: xdotool" banner appears at random
through the exam, proctoring goes red, and the organizer's feed fills with
incident pairs the candidate did not cause. Meanwhile the shield kills the
watchdog's probe mid-flight, so the workspace guard skips checks at random.

**Fix:** remove `"xdotool"` from `RESTRICTED`. It is a 40 KB input-synthesis
utility, not a cheating vector, and the app depends on it. If it must stay,
record spawned child PIDs in a set and skip them in both `scan_restricted_pids`
and the shield, and replace the per-poll `Command::spawn` with a persistent
`x11rb` connection so no child process exists to match.

### P5 · Seven runtime dependencies are undeclared, and their absence is silent · High

Declared: `libwebkit2gtk-4.1-0`, `libgtk-3-0`, `libayatana-appindicator3-1`.
That is all. Verified **not installed on this stock Ubuntu 24.04 desktop**:
`xdotool`, `wmctrl`, `qdbus`.

| Binary                    | Needed for                         | Package                         | In dep chain? |
| ------------------------- | ---------------------------------- | ------------------------------- | ------------- |
| `gsettings`               | the entire GNOME keyboard lockdown | `libglib2.0-bin`                | **no**        |
| `xdotool`, `wmctrl`       | workspace + focus watchdogs        | same names                      | **no**        |
| `xinput`                  | touchpad off, non-GNOME            | `xinput`                        | **no**        |
| `pgrep` / `kill`          | `close_apps`, kill shield          | `procps`                        | **no**        |
| `iptables` / `kmod`       | the entire network lockdown        | same names                      | **no**        |
| `ca-certificates`         | webview TLS trust                  | same name                       | **no**        |
| `kwriteconfig5` / `qdbus` | the entire KDE keyboard lockdown   | `libkf5config-bin`, `qdbus-qt5` | **no**        |

Every one degrades silently: the call sites are `let _ = ...` or
`let Ok(x) = ... else { return; }`.

Two consequences worth naming individually:

- **`close_apps` lies when `pgrep` is missing.** `linux_process_alive` (`:1432`)
  maps ENOENT to "not alive" via `unwrap_or(false)`, so `close_apps` reports
  every app closed and none failed. The candidate clicks "Close these apps" at
  Stage 5, is told it worked, and Discord and Zoom run all contest. Because
  `scan_processes` reads `/proc` directly and stays honest, the 5 s contest scan
  re-flags them, producing a loop where closing always succeeds and the apps are
  always still there.
- **Plasma 6 renamed the KDE tools.** Kubuntu 24.04+, Fedora KDE 40+ and current
  openSUSE ship `kwriteconfig6`/`kreadconfig6`; `kwriteconfig5` is often absent.
  Every call ENOENTs, `let _ =` swallows it, and `:646` still returns
  `active: true`. And without `qdbus` the KDE writes never take effect at all,
  because `kwriteconfig5` only edits `kglobalshortcutsrc`; `qdbus` is what makes
  KWin reload it.

**Fix.** Consolidated dependency block:

```json
"linux": {
  "deb": {
    "depends": [
      "libwebkit2gtk-4.1-0", "libgtk-3-0",
      "libglib2.0-bin",                 // gsettings
      "ca-certificates",                // webview TLS trust
      "xdotool", "wmctrl", "xinput",    // watchdogs + touchpad
      "procps",                         // pgrep / kill
      "policykit-1 | polkitd",          // pkexec, helper install
      "iptables", "kmod"                // helper firewall
    ],
    "postInstallScript": "debian/postinst",
    "preRemoveScript": "debian/prerm"
  },
  "rpm": {
    "depends": [
      "webkit2gtk4.1", "gtk3", "glib-networking", "ca-certificates",
      "glib2", "xdotool", "wmctrl", "xorg-x11-server-utils",
      "procps-ng", "polkit", "iptables", "kmod"
    ]
  }
}
```

KDE tools stay _recommends_, not depends: their absence should flip
`active: false`, not block installation. Probe `kwriteconfig6` then
`kwriteconfig5`, and `qdbus6`/`qdbus-qt6`/`qdbus` in order.

Independently, make absence loud. Probe each binary once in `lock_desktop`
(`:1005`) and `emit_lockdown_event("watchdog_unavailable", "xdotool missing")`
so it reaches the violation log instead of nowhere.

Also drop `libayatana-appindicator3-1`: `Cargo.toml:23` is
`features = []`, so the tray-icon feature that links it is not enabled and the
app never loads it. On Ubuntu it lives in **universe**, so a managed image with
only `main` enabled fails to install over a tray library the app does not use.

### P6 · The `.rpm` and AppImage ship effectively untested, and the AppImage weakens the helper · High

- **The `.rpm` declares zero dependencies.** `tauri.conf.json:33` lists `"rpm"`
  in `bundle.targets`, but `bundle.linux` has a `deb` block only. Tauri's RPM
  bundler emits `Requires:` solely from config; no `find-requires` equivalent
  runs. `release.yml:203` uploads it anyway. Result: `dnf install` succeeds,
  launching does nothing, and from a terminal it is
  `libwebkit2gtk-4.1.so.0: cannot open shared object file`. Note the deb names
  would not help even if copied over: Fedora's package is `webkit2gtk4.1`.
- **The AppImage can never install the network helper.** `lib.rs:1133` checks
  `helper_binary.exists()` **as the user**, which succeeds, then hands the
  `/tmp/.mount_*` path to `pkexec`, whose first action runs `install` as **root**
  (`linux/mod.rs:1331`). AppImage's squashfuse mount has no `allow_other`, so
  the kernel denies root. `set -e` aborts. The candidate enters their admin
  password correctly, gets a generic failure, retries, fails identically, and
  then **proceeds into the contest with unrestricted egress**, because
  `CheckKind::Network` is advisory on every profile (`core-rs:285`).
- **An AppImage run permanently downgrades a `.deb` machine's helper
  authorization.** Verified at `linux/mod.rs:1314-1340`: for an ephemeral path
  `client_pin` is `""`, and the root script's else branch is
  `rm -f "$CONFIG_DEST"`. That deletes `/etc/ams-access/network-helper-client.conf`,
  which is the helper's strong-mode pin. `helper.rs:432-445` then falls back to
  accepting **any** local binary whose exe basename is `ams-access`, including
  one that sends `{"cmd":"disable"}` to lift the exam firewall. Permanent until
  the `.deb` app re-runs its install.

**Fix:** stage the helper binary and unit out of the mount to
`/var/tmp/ams-access-install-<pid>/` before invoking `pkexec`. Never delete an
existing pin: replace the `else` branch with a no-op and refuse an ephemeral
client rather than accommodating it. Add `rpm.depends` as above, or drop `"rpm"`
from `bundle.targets` and stop shipping an artifact nobody has installed. Ship a
`LINUX-INSTALL.md` (there is a `WINDOWS-INSTALL.md` and no Linux equivalent)
stating the `.deb` is the supported artifact for proctored contests.

### P7 · Two stale comments assert an enforcement the policy does not implement · Medium

`lib.rs:747-751` and `lib.rs:1793-1798` both state that the readiness policy
"hard-blocks a strict contest" when the network helper is unavailable.
`core-rs:285` sets `CheckKind::Network => (false, BlockingSeverity::Warning)` on
**every** profile, and `:625-641` documents that a down helper "never blocks
contest entry". The comments describe an older design.

This matters beyond tidiness: it is why the AppImage case above reads as
acceptable to someone auditing the code. Either fix the comments or make
`Network` blocking under `strict_contest`, but the two must stop disagreeing.

### P8 · CI builds a `.deb` and never installs or launches it · High, meta

`ci.yml:239-249` is the entire verification: glob for `*.deb`, assert
non-empty, print OK. No `dpkg -i`, no `apt-get install`, no launch. The `.rpm`
and `.AppImage` are not even globbed.

Classes of failure that can therefore only be found by a candidate, every one
of them a finding above: dependency resolution (P5, P6), missing runtime
binaries (P4, P5), display-server behaviour (P1, P2, P3), and startup panics
(`lib.rs:2555` is an `.expect` inside `setup()`, so any environment where
`with_webview` fails aborts at launch with no window and no message).

**The dependency floor, with direct evidence.** The stale `0.1.0` package
installed on this host lets us read what Tauri actually emitted:

```
$ dpkg -s ams-access | grep Depends
Depends: libwebkit2gtk-4.1-0, libgtk-3-0, libayatana-appindicator3-1,
         libwebkit2gtk-4.1-0, libgtk-3-0
```

That is the three from config plus Tauri's own two, duplicated, and **nothing
else**. No `libc6`, no `libgcc-s1`, no version bounds on anything. This is
direct proof that the bundler emits `Depends:` verbatim and runs no
`dpkg-shlibdeps` equivalent, so the glibc floor is entirely undeclared: built on
ubuntu-22.04 (glibc 2.35), the package installs happily on an older host and
then dies with `version 'GLIBC_2.35' not found`.

**One claim from an earlier draft, corrected down.** `debian/postinst` does
genuinely lack a `case "$1" in configure)` guard and is `set -e`, so it runs on
`abort-upgrade` and `abort-remove` too. But the concrete harm is small: all it
does is rewrite a udev rule file as root, which is harmless on those paths. It
is a packaging-policy defect worth fixing for correctness, not an exam-day risk,
and it should not have been listed alongside the others.

**Fix.** One job, roughly twenty lines, catches about half the list:

```yaml
deb-install-smoke:
  runs-on: ubuntu-22.04
  container: ubuntu:22.04 # clean, none of the CI build deps
  steps:
    - run: apt-get update && apt-get install -y ./AMS*.deb --no-install-recommends
    - run: dpkg -l | grep -q ams-access && test -f /etc/udev/rules.d/70-ams-access-camera.rules
    - run: xvfb-run -a timeout 30 /usr/bin/ams-access --version || test $? -eq 124
    - run: apt-get remove -y ams-access && test ! -f /etc/udev/rules.d/70-ams-access-camera.rules
```

`--no-install-recommends` is the load-bearing flag: it is what proves the
`depends` array is complete rather than accidentally satisfied.

---

## 5. This machine, specifically

State found on the investigation host that would matter during a rehearsal:

| Finding                                                                                    | Evidence                                                                                                      | Consequence                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A stale package `ams-access 0.1.0` is installed at `/usr/bin/ams-access`, built 2026-06-20 | `dpkg -S`, `dpkg -l`                                                                                          | Pre-`v1.1.0` build. If anyone launches it by mistake it is several security fixes and one API-host migration old. Remove it: `sudo apt remove ams-access`.                                                                                                                                |
| The helper's pinned client path is a **debug binary**                                      | `/etc/ams-access/network-helper-client.conf` = `/home/user/AccessSoftware/ams-access/target/debug/ams-access` | The installed package can never authorise to the helper: `authorize_client` compares `/proc/<pid>/exe` against this exact string and fails closed. Network lockdown is unavailable to any build except that one debug binary. Re-run helper install from whichever build is being tested. |
| Helper socket is `0666`                                                                    | `srw-rw-rw- root root /run/ams-proctor.sock`                                                                  | Intentional and documented (`helper.rs:295`), but the doc comment on `authorize_client` (`helper.rs:377`) still claims a `0600` socket "blocks non-root users at the filesystem layer". It does not. Correct the comment; the exe-path pin is the only gate.                              |
| No lockdown marker present                                                                 | `/run/ams-proctor.lock` absent                                                                                | No stale firewall right now. Good.                                                                                                                                                                                                                                                        |
| Node on `PATH` is v18.19.1                                                                 | `node --version`                                                                                              | Repo needs ≥22.6. `pnpm test` cannot run at all. `nvm use` (`.nvmrc` = 24) before any gate.                                                                                                                                                                                               |

---

## 6. Verification plan

Each fix must be demonstrated failing before it is demonstrated passing.

**F1**

1. With the fix reverted, add the two new tests → both fail to compile/assert.
2. Apply F1 → `pnpm --filter @ams/web test` green, including the existing
   `api-base.test.mjs` and `csp-allows-api-base.test.mjs` unchanged in behaviour.
3. `NEXT_PUBLIC_DEV_API_URL=https://api.amsaccess.com pnpm --filter @ams/desktop dev`
   → sign in with a real slip → reaches `/home`.
4. Build a release bundle **with** `NEXT_PUBLIC_DEV_API_URL` set to a junk host,
   install it, confirm it still calls `api.amsaccess.com`. This is the test that
   the v2.0.0 class of bug cannot recur.

**F2**

1. Point the dev base at a closed port → confirm the UI reads
   `localhost:8080 · UNREACHABLE`.
2. Point it at a host that blackholes (e.g. an unroutable IP) → confirm
   `TIMEOUT` and the different sentence.
3. `cat ~/.local/share/com.ams.access/proctoring/proctoring-events.jsonl` →
   confirm an `api_unreachable` row exists for both.

**F3** Trigger a status-0, open "Get help", confirm the copyable block renders
and the spool row is written even with the API down.

**F4** Start the app with the API host blackholed in `/etc/hosts`; confirm the
login screen reports the server as unreachable _before_ credentials are typed,
and that launch is not blocked.

---

## 7. Confidence

**Root cause of the screenshot: High.** Reproduced end to end (E9) with a
passing control on identical credentials (E10), and every competing hypothesis
eliminated by direct evidence: backend healthy (E1), DNS fine (E2), TLS fine
(E3), WebKitGTK TLS backend present (E4), CSP permits the call (devCsp allows
`http://localhost:*`), no stale firewall marker (§5).

**That the fixes are the right ones: High for F2 and F3, Medium-High for F1 and
F4.** F1 rests on one assumption, flagged: that no shipping origin can ever
present port 3000. That holds for Tauri's `tauri://localhost` and
`http://tauri.localhost` schemes today and is pinned by the new test, but it is
a property of Tauri's asset protocol rather than a guarantee we own. If Tauri
ever serves the bundle from a localhost HTTP server on a configurable port, F1
must be revisited; the test above is what will catch it.

**What would change my mind.** If the screenshot was in fact taken from the
installed `/usr/bin/ams-access` rather than the running dev build, the analysis
changes completely and the cause is the ancient `0.1.0` package. Evidence
against: only one GUI process exists and it is `target/debug/ams-access` (E11,
E5), and the installed binary was not running. If you took that screenshot on a
different machine or from the installed package, say so and I will re-open.

**On the Linux findings: High for everything cited with a line number**, because
each was read in source rather than inferred.

### Corrections log

A second review pass re-verified every claim that had not been checked
first-hand. Four were wrong or overstated and have been corrected in place
rather than quietly edited out, because the reasoning that produced them is
worth seeing:

| Claim, as first written                                               | What is actually true                                                                                                                                                                                |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `glib-networking` may be absent from the `.deb`, breaking webview TLS | It is a hard `Depends` of `libsoup-3.0-0`, which is a hard `Depends` of the webview. The `.deb` is safe. Only `.rpm` and AppImage are exposed. **My error.**                                         |
| Roaming blocks DHCP, so the candidate never gets an IP (L7)           | NetworkManager's internal client uses AF_PACKET raw sockets, which bypass `filter/OUTPUT`. Acquisition works. **DNS** is what breaks, which is sufficient.                                           |
| The signal handler deadlocks on the `SAVED_BINDINGS` mutex (L9)       | `unlock_desktop` only takes that lock via `disable_keyboard_intercept`; the touchpad restore path skips it. The lock race is narrow. The **allocator** hazard is the real one, and it is not narrow. |
| `debian/postinst`'s missing `configure` guard can wedge apt (P8)      | The guard is genuinely missing, but all the script does is rewrite a udev rule as root, which is harmless on the abort paths. Policy defect, not exam-day risk.                                      |

Two further calibration notes:

- The runtime-binary findings (P5) were confirmed against _this_ host, where
  `xdotool`, `wmctrl` and `qdbus` are all absent on a stock Ubuntu 24.04
  desktop. That is one machine, not a survey. The claim that matters does not
  depend on the survey: nothing in the declared dependency chain pulls them, so
  their presence is luck on every machine. The `dpkg -s` output quoted in P8 is
  the direct proof.
- **F5 was missed entirely on the first pass.** Two Next dev servers were
  running for the whole investigation and I recorded the resulting HTTP 500 as a
  probable curl artifact instead of chasing it. It was not. The lesson is the
  ordinary one: an anomaly set aside without an explanation is a finding you
  have not made yet.

Untested by me, and worth an actual machine before anyone relies on it: P2 and
P3 were derived from source, not run on Xfce, Cinnamon or a Wayland session.
The reasoning is direct (a string match that cannot match, a `DISPLAY` gate that
XWayland satisfies), but one afternoon with a Mint VM and a GNOME Wayland
session would convert them from High to Certain, and would probably find more.

---

## 8. Order of work

Ranked by expected candidate-harm per hour of engineering, not by severity
label. Blast radius that outlives the contest ranks above blast radius inside
it.

| #   | Item                                                                                     | Why it is here                                                                                                                | Size                       |
| --- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 1   | **L5** move the keyboard backup off `/tmp`                                               | Only finding that permanently damages a candidate's machine after the exam ends                                               | 1 line                     |
| 2   | **L6** port-scope the resolver allowlist                                                 | Only finding that lets a candidate defeat the lockdown entirely, silently                                                     | ~10 lines                  |
| 3   | **P2** stop hard-blocking Xfce/Cinnamon/Mint                                             | Highest probability of hitting a real candidate on real hardware                                                              | ~5 lines for the carve-out |
| 4   | **P4** remove `xdotool` from `RESTRICTED`                                                | The app attacks its own watchdog and blames the candidate                                                                     | 1 line                     |
| 5   | **P1** make the keyboard intercept tell the truth                                        | The headline guarantee currently reports green while doing nothing possible                                                   | ~30 lines                  |
| 6   | **L2/L3/L4** Linux crash recovery + honest teardown                                      | A crashed session is currently unrecoverable without a reboot, and the UI says "restart your Mac"                             | ~80 lines                  |
| 7   | **F2/F3** name the host, fix the escape hatch                                            | Converts every future incident of this class from 20 minutes to 5 seconds                                                     | ~40 lines                  |
| 8   | **P5** declare the seven missing dependencies                                            | Cheap, and turns six silent degradations into install-time errors                                                             | config                     |
| 9   | **P8** one `apt-get install --no-install-recommends` CI job                              | Catches roughly half of §4B forever                                                                                           | ~20 lines                  |
| 10  | **F1 + F5** supported dev API target, and stop double-starting `next dev`                | Unblocks and de-flakes the loop that produced this report. F1 must delete the `"localhost"` fallback in the same change (L10) | ~15 lines + config         |
| 11  | **L7/L9/P6/P7** allowlist re-resolution, signal safety, AppImage staging, stale comments | Correctness debt with real but narrower exposure                                                                              | larger                     |

Items 1 through 4 are four small, independent, individually shippable changes
that between them remove the two worst outcomes in this document. I would do
those before anything else, including the bug that started this investigation.

### Not in this document, but in the same class

The desktop sends `X-AMS-Client-Version` from
`process.env.NEXT_PUBLIC_APP_VERSION ?? "2.0.0"` (`proctor-api.ts:24`), and that
variable is set nowhere in the repo: not `.env.local`, not `release.yml`, not
`ci.yml`, not `next.config.mjs`. Every build ships claiming **2.0.0** while the
workspace is at 2.0.8. `RELEASE.md:87` names this header as the entire
version-skew mechanism, so the first time anyone raises `AMS_MIN_CLIENT_VERSION`
above 2.0.0, every candidate is 426'd at login, including candidates on the
newest installer. `check-versions.mjs` does not cover it because it compares
manifest versions, not this constant.

Not a Linux issue, which is why it is a footnote here rather than a finding. It
is the same failure shape as the one that opened this report: login fails, and
the message does not lead to the cause.
