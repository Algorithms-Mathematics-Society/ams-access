/** Team-round UI verification against the real contest page, fixtures only.
 * Run: start `next dev -p 3210` in apps/web, then
 *   PLAYWRIGHT_MODULE=<playwright> node scripts/team-round-ui-verify.mjs http://127.0.0.1:3210 --file TeamLobby
 * Each scene is audited for page overflow, unnamed or overlapping controls,
 * small targets, clipped text and WCAG AA contrast; screenshots go to a temp dir.
 * Entry follows the app's own path (stored session, setup handoff, POST
 * /participant/sessions, native lockdown probe); nothing reaches a real API.
 */
import assert from "node:assert/strict";
import { parseTeamLobby } from "../apps/web/src/lib/team-lobby.ts";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = new URL(process.argv[2] || "http://127.0.0.1:3210");
assert(["127.0.0.1", "localhost"].includes(base.hostname), "Local preview required");
const out = path.resolve(
  // Screenshots stay out of the repository unless a directory is chosen explicitly.
  process.env.TEAM_UI_EVIDENCE_DIR || path.join(tmpdir(), "ams-team-round-ui"),
  new Date().toISOString().replace(/[:.]/g, "-")
);
await mkdir(out, { recursive: true });

const CONTEST = "6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
const SESSION = "7a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const ATTEMPT = "8b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
const T0 = Date.parse("2026-12-01T10:00:00Z");
const iso = (ms) => new Date(ms).toISOString();

/** A lobby projection in the shape team-lobby.ts parses (see team-lobby.test.mjs). */
export function lobbyBoard({
  phase = "choosing",
  now = T0 + 5 * 60_000,
  claims = [null, null, null, null],
  me = 0,
  ready = [false, false, false, false],
  locked = false,
  names,
  titles,
} = {}) {
  const members = claims.map((part, i) => ({
    member_uid: `m${i}`,
    display_name: names?.[i] ?? ["Asha Verma", "Ben Okafor", "Chen Li", "Dina Haddad"][i],
    is_me: i === me,
    part_label: part,
    assigned_by: part ? "claim" : null,
    ready: ready[i],
    ready_at: ready[i] ? iso(now - 30_000) : null,
  }));
  const holders = new Map(claims.map((p, i) => [p, i]));
  return {
    team: { uid: "team-1", number: 7, name: "Team Seven" },
    members,
    parts: claims
      .map((_, index) => String(index + 1))
      .map((label) => ({
        label,
        problem_label: `P${label}`,
        ...(titles
          ? {
              title: titles[Number(label) - 1],
              summary:
                "Implements the shared interface; see the statement for the exact contract and limits.",
            }
          : {}),
        holder: holders.has(label) ? members[holders.get(label)].display_name : null,
        holder_is_me: holders.get(label) === me,
        revision: null,
        submission_status: null,
        verdict: null,
      })),
    phase: {
      name: phase,
      voice_open: true,
      selection_opens_at: iso(T0),
      claims_open_at: iso(T0 + 120_000),
      prompt: "Discuss with your team and choose the part that best fits your skills.",
      discussion_seconds: 120,
    },
    allocation: { locked, locks_at: iso(T0 + 15 * 60_000) },
    readiness_supported: true,
    readiness: {
      ready: ready.filter(Boolean).length,
      needed: members.length,
      mine: ready[me],
      can_ready: claims[me] !== null && !ready[me],
    },
    server_time: iso(now),
  };
}

/** A locked board after the contest started, plus vote/integration fields (team-vote.ts). */
export function workspaceBoard({
  now = T0 + 40 * 60_000,
  parts = {},
  vote = {},
  names,
  ...rest
} = {}) {
  const lobby = lobbyBoard({
    phase: "locked",
    locked: true,
    claims: ["1", "2", "3", "4"],
    now,
    names,
  });
  return {
    ...lobby,
    phase: { ...lobby.phase, name: "locked", starts_at: iso(T0 + 20 * 60_000) },
    parts: lobby.parts.map((part) => ({ ...part, ...(parts[part.label] ?? {}) })),
    revision: 2,
    vote: {
      votes: 1,
      needed: 4,
      mine: false,
      deadline: iso(T0 + 3 * 3600_000 - 10 * 60_000),
      ...vote,
    },
    submitted_revision: null,
    submitted_by: null,
    integration: null,
    last_result: null,
    ...rest,
  };
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const report = { scenes: [], unknownApi: new Set(), unknownInvoke: new Set(), errors: [] };

/** Opens the contest page in a fresh context and enters it through the real gate. */
export async function openScene(
  name,
  {
    team,
    viewport = { width: 1366, height: 768 },
    theme = "dark",
    platform,
    voice = false,
    extra = {},
  }
) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on("pageerror", (e) => report.errors.push(`${name}: ${e.message}`));
  page.on(
    "console",
    (m) => m.type() === "error" && report.errors.push(`${name}: console ${m.text().slice(0, 300)}`)
  );
  await page.addInitScript(
    ({ CONTEST, SESSION, ATTEMPT, theme, platform }) => {
      if (platform) Object.defineProperty(navigator, "platform", { value: platform });
      localStorage.setItem("ams_theme", theme);
      localStorage.setItem("ams_participant_token_v5", "team-ui-fixture-not-a-real-token");
      localStorage.setItem(
        "ams_participant_token_expires_at_v5",
        String(Date.now() + 12 * 3600_000)
      );
      localStorage.setItem("ams_display_name", "Asha Verma");
      localStorage.setItem(
        "ams_active_session",
        JSON.stringify({ id: SESSION, contest_id: CONTEST, contest_title: "Round 2 fixture" })
      );
      sessionStorage.setItem(
        "ams_setup_entry_attempt",
        JSON.stringify({ contestId: CONTEST, id: ATTEMPT })
      );
      sessionStorage.setItem(
        "ams_completed_setup_handoff",
        JSON.stringify({ contestId: CONTEST, sessionId: SESSION, entryAttemptId: ATTEMPT })
      );
      window.__invokes = [];
      const answers = {
        is_lockdown_engaged: true,
        set_escape_blocked: null,
        ...(window.__fixtureInvokes ?? {}),
      };
      window.__TAURI_INTERNALS__ = {
        transformCallback: () => Math.floor(Math.random() * 1e9),
        invoke: (command, args) => window.__TAURI__.core.invoke(command, args),
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      };
      window.__TAURI__ = {
        core: {
          invoke: (command, args) => {
            window.__invokes.push(command);
            if (command in answers) return Promise.resolve(answers[command]);
            return new Promise(() => {});
          },
        },
        event: { listen: () => Promise.resolve(() => {}) },
      };
    },
    { CONTEST, SESSION, ATTEMPT, theme, platform }
  );
  const now = team?.server_time ? Date.parse(team.server_time) : T0;
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    const local =
      u.origin === base.origin &&
      !u.pathname.includes("/participant/") &&
      !u.pathname.startsWith("/api/");
    if (local) return route.continue();
    if (u.origin !== base.origin && !u.pathname.includes("/participant/")) return route.abort();
    const json = (data, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" },
        body: JSON.stringify(data),
      });
    if (route.request().method() === "OPTIONS")
      return route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Allow-Methods": "*",
        },
      });
    const p = u.pathname;
    const handler = extra[p.replace(/^.*\/participant/, "")];
    if (handler) return handler(route, json);
    if (p.endsWith("/participant/sessions") && route.request().method() === "POST")
      return json({
        uid: SESSION,
        status: "active",
        contest_uid: CONTEST,
        entry_attempt_id: ATTEMPT,
        started_at: iso(now),
        server_time: iso(now),
        remaining_ms: 3 * 3600_000,
        ends_at: iso(T0 + 3 * 3600_000),
        phase: "running",
      });
    if (p.endsWith(`/participant/contests/${CONTEST}/team`))
      return team ? json(team) : json({ detail: "not a team round" }, 404);
    const problem = p.match(/\/problems\/(P[1-4])$/);
    if (problem)
      return json({
        problem: {
          label: problem[1],
          title: `Part ${problem[1].slice(1)} service`,
          score: 100,
          schema_version: 2,
          language: "cpp",
          standard: "c++23",
          limits: { cpu_time_ms: 1000, wall_time_ms: 2000, memory_mb: 256 },
          statement: {
            markdown:
              "Implement the interface in `part.hpp`.\n\n## Constraints\n- 1 <= n <= 100000",
            sha256: "fixture",
            size_bytes: 80,
          },
          starter: {
            source: '#include "part.hpp"\n\nint solve(int n) {\n    return n;\n}\n',
            filename: "part.cpp",
            sha256: "fixture",
            size_bytes: 60,
          },
          samples: [{ label: "Example 1", input: "3", output: "3" }],
          assets: [],
          families: {
            io: { graded: true, weight: 100, count: 1 },
            behavior: { graded: false, weight: 0, count: 0, present: false },
            symbolic: { graded: false, gate: true, rules: [], count: 0 },
          },
        },
      });
    if (p.endsWith("/drafts") || p.endsWith("/submissions") || p.includes("overrides"))
      return json([]);
    if (p.endsWith(`/participant/contests/${CONTEST}`))
      return json({
        uid: CONTEST,
        title: "Round 2 fixture",
        description: "",
        status: "ACTIVE",
        starts_at: iso(T0),
        ends_at: iso(T0 + 3 * 3600_000),
        is_practice: false,
        frozen: false,
        organization_name: "AMS",
        problems: ["P1", "P2", "P3", "P4"].map((label, i) => ({
          label,
          title: `Part ${i + 1} service`,
          score: 100,
          time_limit_ms: 2000,
          memory_limit_mb: 256,
        })),
        server_time: iso(now),
        remaining_ms: 3 * 3600_000,
        phase: "running",
      });
    if (p.includes(`/participant/sessions/${SESSION}`))
      return json({
        uid: SESSION,
        contest_uid: CONTEST,
        status: "active",
        started_at: iso(now),
        ended_at: null,
        violation_count: 0,
        resume_count: 0,
        server_time: iso(now),
        remaining_ms: 3 * 3600_000,
        ends_at: iso(T0 + 3 * 3600_000),
        phase: "running",
      });
    report.unknownApi.add(`${route.request().method()} ${p}`);
    return json({ detail: "No team-round UI fixture", path: p }, 503);
  });
  // Every socket remains local to the fixture; never connect to a real voice relay.
  await page.routeWebSocket("**/*", (socket) => {
    if (!voice) return socket.close();
    socket.onMessage((message) => {
      if (JSON.parse(String(message)).type === "ping")
        socket.send(JSON.stringify({ type: "pong" }));
    });
    setTimeout(
      () =>
        socket.send(
          JSON.stringify({
            type: "welcome",
            me: "m0",
            peers: [],
            ice_servers: [{ urls: "turn:127.0.0.1:9", username: "fixture", credential: "fixture" }],
            expires_at: now / 1000 + 3600,
          })
        ),
      100
    );
  });
  await page.clock.install({ time: now });
  await page.goto(`${base.origin}/session/contest/?contestId=${CONTEST}`);
  return { page, context };
}

export async function capture(page, name) {
  const file = path.join(out, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  report.scenes.push(name);
  return file;
}

/** Objective layout and accessibility findings for whatever is on screen. */
export async function audit(page, scope = "body") {
  return page.evaluate((scope) => {
    // An open modal owns the screen; controls behind its backdrop are covered on purpose.
    const modal = [...document.querySelectorAll("dialog[open],[role=dialog][aria-modal=true]")].at(
      -1
    );
    const root = modal ?? document.querySelector(scope) ?? document.body;
    const findings = [];
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return (
        r.width > 0 &&
        r.height > 0 &&
        s.visibility !== "hidden" &&
        s.display !== "none" &&
        !el.closest("[aria-hidden=true],nextjs-portal")
      );
    };
    if (document.documentElement.scrollWidth > innerWidth + 1)
      findings.push(
        `page overflows horizontally (${document.documentElement.scrollWidth} > ${innerWidth})`
      );
    const controls = [
      ...root.querySelectorAll(
        "button,a[href],input,select,textarea,[role=button],[role=switch],[role=tab]"
      ),
    ].filter(visible);
    for (const c of controls) {
      const name = (
        c.getAttribute("aria-label") ||
        c.textContent ||
        c.getAttribute("title") ||
        c.labels?.[0]?.textContent ||
        ""
      ).trim();
      const r = c.getBoundingClientRect();
      if (r.width <= 1 && r.height <= 1) continue; // visually hidden until focused
      if (!name) findings.push(`control without accessible name: ${c.outerHTML.slice(0, 120)}`);
      // Small targets with a clear 24px surrounding area satisfy the spacing exception.
      const padded = {
        left: r.left - Math.max(0, 24 - r.width) / 2,
        right: r.right + Math.max(0, 24 - r.width) / 2,
        top: r.top - Math.max(0, 24 - r.height) / 2,
        bottom: r.bottom + Math.max(0, 24 - r.height) / 2,
      };
      const crowded = controls.some((other) => {
        if (other === c || c.contains(other) || other.contains(c)) return false;
        const b = other.getBoundingClientRect();
        return (
          b.left < padded.right &&
          b.right > padded.left &&
          b.top < padded.bottom &&
          b.bottom > padded.top
        );
      });
      if ((r.width < 24 || r.height < 24) && crowded)
        findings.push(
          `small target ${Math.round(r.width)}x${Math.round(r.height)}: ${name.slice(0, 40)} ${c.outerHTML.slice(0, 200)}`
        );
    }
    for (let i = 0; i < controls.length; i++)
      for (let j = i + 1; j < controls.length; j++) {
        if (controls[i].contains(controls[j]) || controls[j].contains(controls[i])) continue;
        const a = controls[i].getBoundingClientRect();
        const b = controls[j].getBoundingClientRect();
        const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (x > 2 && y > 2)
          findings.push(
            `overlapping controls: "${controls[i].textContent.trim().slice(0, 30)}" / "${controls[j].textContent.trim().slice(0, 30)}"`
          );
      }
    const texty = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    for (const el of root.querySelectorAll("*")) {
      if (!visible(el) || !texty(el) || el.getBoundingClientRect().width <= 1) continue;
      const s = getComputedStyle(el);
      if (
        (s.overflow === "hidden" || s.textOverflow === "ellipsis") &&
        el.scrollWidth > el.clientWidth + 1 &&
        !el.title &&
        !el.getAttribute("aria-label")
      )
        findings.push(
          `clipped text without full-text access: "${el.textContent.trim().slice(0, 50)}"`
        );
    }
    const ctx = document.createElement("canvas").getContext("2d");
    const rgba = (c) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data].map((v, i) => (i === 3 ? v / 255 : v));
    };
    const mix = (f, b) =>
      f
        .slice(0, 3)
        .map((c, i) => c * f[3] + b[i] * (1 - f[3]))
        .concat(1);
    const lum = (c) =>
      c
        .slice(0, 3)
        .map((v) => ((v /= 255), v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i], 0);
    for (const el of root.querySelectorAll("*")) {
      if (!visible(el) || !texty(el) || el.closest("button:disabled,[aria-disabled=true]"))
        continue;
      const stack = [];
      let anc = el;
      let opacity = 1;
      while (anc) {
        const st = getComputedStyle(anc);
        stack.push(rgba(st.backgroundColor));
        opacity *= Number(st.opacity);
        anc = anc.parentElement;
      }
      if (opacity < 0.99) continue;
      let bg = [255, 255, 255, 1];
      for (const c of stack.reverse()) bg = mix(c, bg);
      const st = getComputedStyle(el);
      const fg = mix(rgba(st.color), bg);
      const ratio = (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05);
      const large =
        parseFloat(st.fontSize) >= 24 ||
        (parseFloat(st.fontSize) >= 18.66 && Number(st.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5))
        findings.push(`low contrast ${ratio.toFixed(2)}: "${el.textContent.trim().slice(0, 50)}"`);
    }
    return [...new Set(findings)];
  }, scope);
}

const LONG = [
  "Aaradhya Venkataraman-Subramaniam Krishnamurthy",
  "Bartholomew Oluwaseun Adeyemi-Okonkwo",
  "Chen Li",
  "Dinah Haddad-Al-Rashidi Montgomery-Fitzgerald",
];
/** Scenes grouped by the component file they exercise. */
const completedResult = (revision, extra = {}) => ({
  revision,
  status: "completed",
  verdict: "WA",
  integration_verdict: "WA",
  passed_count: 3,
  total_count: 5,
  failing_parts: ["2"],
  project_failure: false,
  substitutions: [],
  fallbacks: {},
  parts: {
    1: { verdict: "AC", passed_count: 2, total_count: 2, origin: "submission" },
    2: { verdict: "WA", passed_count: 1, total_count: 3, origin: "submission" },
    3: { verdict: "AC", passed_count: 2, total_count: 2, origin: "submission" },
    4: {
      verdict: "AC",
      passed_count: 2,
      total_count: 2,
      origin: "reference",
      substituted: "reference",
    },
  },
  ...extra,
});
const submittedParts = {
  1: { revision: 3, submission_status: "completed", verdict: "AC" },
  2: { revision: 2, submission_status: "completed", verdict: "WA" },
  3: { revision: 1, submission_status: "in_progress", verdict: null },
};
const liveScene = (body, status = 200, options = {}) => ({
  team: workspaceBoard(),
  enter: true,
  click: ["Team progress", "Live board"],
  extra: { [`/contests/${CONTEST}/team/board`]: (route, json) => json(body, status) },
  ...options,
});
const benchmarkRun = {
  uid: "11111111-1111-1111-1111-111111111111",
  revision: 2,
  status: "ok",
  median_ns: 100,
  iqr_ns: 5,
  repetitions: 7,
  instructions: 400,
  has_profile: true,
  parts_profile: [{ owner: "1", share: 0.5, top_symbols: [["solve", 40]] }],
};
const benchmarkScene = (body, status = 200, options = {}) => ({
  team: workspaceBoard(),
  enter: true,
  click: ["Team progress", "Benchmarks"],
  extra: {
    [`/contests/${CONTEST}/team/benchmarks`]: (route, json) => json(body, status),
    [`/contests/${CONTEST}/team/benchmarks/${benchmarkRun.uid}/flamegraph`]: (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="80"><rect width="600" height="80" fill="orange"/><text x="12" y="40">solve (fixture)</text></svg>',
      }),
  },
  ...options,
});
const voiceScene = (click, options = {}) => ({
  team: workspaceBoard({ names: LONG }),
  enter: true,
  platform: "Win32",
  voice: true,
  click,
  ...options,
});
// Exercise actual tab stops and Enter activation, without invoking React handlers.
async function keyboardActivate(page, control) {
  await control.waitFor({ state: "visible" });
  for (let tabs = 0; tabs < 120; tabs++) {
    if (await control.evaluate((element) => element === document.activeElement)) {
      await page.keyboard.press("Enter");
      return;
    }
    await page.keyboard.press("Tab");
  }
  assert.fail("Pagination control was not reachable by keyboard");
}
const largeHistory = Array.from({ length: 61 }, (_, index) => ({
  ...benchmarkRun,
  uid: `11111111-1111-1111-1111-${String(index).padStart(12, "0")}`,
  revision: 61 - index,
  has_profile: false,
}));
const largeStandings = {
  teams: Array.from({ length: 121 }, (_, index) => ({
    uid: index === 110 ? "team-1" : `other-team-${index}`,
    name: `Pagination team ${index + 1}`,
    rank: index + 1,
    score: 121 - index,
    solved: 1,
    integration_passed: true,
  })),
};
async function verifyBenchmarkPaging({ page }) {
  const pager = page.getByRole("navigation", { name: "Benchmark history pages" });
  const rows = page.getByText(/^Revision \d+ · Measured$/, { exact: true });
  await pager.waitFor();
  assert.equal(await rows.count(), 25);
  assert.equal(await page.getByText("Revision 61 · Measured", { exact: true }).count(), 1);
  await keyboardActivate(page, pager.getByRole("button", { name: "Go to next page", exact: true }));
  await page.getByText("Revision 36 · Measured", { exact: true }).waitFor();
  assert.equal(await rows.count(), 25);
  await keyboardActivate(page, pager.getByRole("button", { name: "Go to next page", exact: true }));
  await page.getByText("Revision 11 · Measured", { exact: true }).waitFor();
  assert.equal(await rows.count(), 11);
  assert.equal(
    await pager.getByRole("button", { name: "Go to next page", exact: true }).isDisabled(),
    true
  );
  await keyboardActivate(
    page,
    pager.getByRole("button", { name: "Go to previous page", exact: true })
  );
  await page.getByText("Revision 36 · Measured", { exact: true }).waitFor();
  assert.equal(await rows.count(), 25);
  await pager.scrollIntoViewIfNeeded();
}
async function verifyLiveBoardPaging({ page }) {
  const pager = page.getByRole("navigation", { name: "Live team standings pages" });
  const rows = page.getByText(/^\d+\. Pagination team \d+( · Your team)?$/, { exact: true });
  await pager.waitFor();
  assert.equal(await rows.count(), 50);
  await keyboardActivate(page, pager.getByRole("button", { name: "Go to next page", exact: true }));
  await page.getByText("51. Pagination team 51", { exact: true }).waitFor();
  assert.equal(await rows.count(), 50);
  await keyboardActivate(page, page.getByRole("button", { name: "Show your team", exact: true }));
  await page.getByText("111. Pagination team 111 · Your team", { exact: true }).waitFor();
  assert.equal(await rows.count(), 21);
  assert.equal(
    await pager.getByRole("button", { name: "Go to next page", exact: true }).isDisabled(),
    true
  );
  await keyboardActivate(
    page,
    pager.getByRole("button", { name: "Go to previous page", exact: true })
  );
  await page.getByText("51. Pagination team 51", { exact: true }).waitFor();
  assert.equal(await rows.count(), 50);
  await pager.scrollIntoViewIfNeeded();
}
/** A mutable team endpoint for scenes that change between polls. `fail` is an
 * HTTP status or "offline" (no response at all); `hold` parks GETs until released. */
function teamFixture(board, mutations = {}) {
  const fx = { board, fail: null, hold: null, gets: 0, posts: [] };
  fx.extra = {
    [`/contests/${CONTEST}/team`]: async (route, json) => {
      fx.gets += 1;
      if (fx.hold) await fx.hold;
      if (fx.fail === "offline") return route.abort("internetdisconnected");
      if (fx.fail) return json({ detail: "Team service is restarting." }, fx.fail);
      return json(fx.board);
    },
  };
  for (const [action, next] of Object.entries(mutations))
    fx.extra[`/contests/${CONTEST}/team/${action}`] = (route, json) => {
      fx.posts.push(action);
      fx.board = next(fx, JSON.parse(route.request().postData() || "null"));
      return json(fx.board);
    };
  return fx;
}
/** Runs page timers far enough for at least one ordinary board poll (3 to 5 s). */
const nextPoll = (page) => page.clock.runFor(5_500);
const shown = (page, text) => page.getByText(text, { exact: true }).first().waitFor();
const absent = async (page, text) =>
  assert.equal(await page.getByText(text, { exact: true }).count(), 0, `unexpected: ${text}`);
const isDisabled = (page, name) =>
  page.getByRole("button", { name, exact: true }).first().isDisabled();
/** Countdown text as whole seconds, e.g. "Parts lock in 09:58" -> 598. */
async function countdownSeconds(page, prefix) {
  const text = await page
    .getByText(new RegExp(`^${prefix} \\d\\d:\\d\\d$`))
    .first()
    .textContent();
  const [m, s] = text
    .slice(prefix.length + 1)
    .split(":")
    .map(Number);
  return m * 60 + s;
}
const lockedBoard = (options = {}, startsAt = iso(T0 + 20 * 60_000)) => {
  const board = lobbyBoard({
    phase: "locked",
    locked: true,
    claims: ["1", "2", "3", "4"],
    ...options,
  });
  return { ...board, phase: { ...board.phase, name: "locked", starts_at: startsAt } };
};
/** Waits until the lobby's own feedback region reads exactly `text` ("" = empty). */
async function lobbyFeedback(page, text) {
  const region = page.locator(".team-lobby-feedback");
  for (let i = 0; i < 50; i++) {
    if ((await region.innerText()).trim() === text) return;
    await page.waitForTimeout(100);
  }
  assert.equal((await region.innerText()).trim(), text, "lobby feedback");
}
const RAW_FETCH = /Failed to fetch|Load failed|NetworkError/;
export const SCENES = {
  VoiceEndedNotice: [
    [
      "window-closed",
      voiceScene([], {
        after: async ({ page, team }) => {
          team.phase.voice_open = false;
          await page.clock.runFor(5500);
          await page
            .locator('[role="status"]:visible')
            .filter({ hasText: /^Voice has ended for this round$/ })
            .waitFor();
        },
      }),
    ],
  ],
  TeamResultsView: [
    [
      "section-switch",
      {
        team: workspaceBoard({ last_result: completedResult(2) }),
        enter: true,
        click: ["Team progress", "Integration", "Progress", "Integration"],
      },
    ],
  ],

  TeamVoiceControls: [
    [
      "unbroken-name-narrow",
      voiceScene(["Join voice"], {
        team: workspaceBoard({ names: ["X".repeat(200), "Ben", "Chen", "Dinah"] }),
        resize: { width: 390, height: 640 },
      }),
    ],

    ["join-confirmation", voiceScene(["Join voice"])],
    ["connected-settings", voiceScene(["Join voice", "Confirm join voice"])],
    ["cancel-light", voiceScene(["Join voice", "Cancel"], { theme: "light" })],
  ],
  TeamVoicePresentation: [
    [
      "escape-join-confirmation",
      voiceScene(["Join voice"], {
        after: async ({ page }) => {
          await page.keyboard.press("Escape");
          assert.equal(
            await page.getByRole("button", { name: "Confirm join voice", exact: true }).isVisible(),
            false
          );
          assert(
            await page
              .getByRole("button", { name: "Join voice", exact: true })
              .first()
              .evaluate((el) => el === document.activeElement)
          );
        },
      }),
    ],

    ["unavailable", { team: workspaceBoard({ names: LONG }), enter: true, click: ["Audio issue"] }],
    ["connected-toolbar", voiceScene(["Join voice", "Confirm join voice", "Voice"])],
  ],
  LeaveTeamVoice: [
    [
      "confirmation-narrow-light",
      voiceScene(["Join voice", "Confirm join voice", "Leave voice"], {
        theme: "light",
        resize: { width: 390, height: 640 },
      }),
    ],

    ["confirmation", voiceScene(["Join voice", "Confirm join voice", "Leave voice"])],
    ["stay", voiceScene(["Join voice", "Confirm join voice", "Leave voice", "Stay in voice"])],
    [
      "leave",
      voiceScene(["Join voice", "Confirm join voice", "Leave voice", "Confirm leave voice"]),
    ],
  ],

  TeamLiveBoard: [
    ["large-keyboard", liveScene(largeStandings, 200, { after: verifyLiveBoardPaging })],
    [
      "large-keyboard-narrow",
      liveScene(largeStandings, 200, {
        resize: { width: 390, height: 640 },
        after: verifyLiveBoardPaging,
      }),
    ],
    [
      "narrow-long-names",
      liveScene(
        {
          teams: [
            {
              uid: "team-1",
              name: "The Extraordinarily Long-Named Algorithmic Collective of Team Seven",
              rank: 1,
              score: 100,
              solved: 4,
              integration_passed: true,
            },
          ],
        },
        200,
        { resize: { width: 390, height: 640 } }
      ),
    ],

    ["empty", liveScene({ teams: [] })],
    [
      "long-names",
      liveScene({
        benchmark: {},
        teams: [
          {
            uid: "team-1",
            name: "The Extraordinarily Long-Named Algorithmic Collective of Team Seven",
            rank: 1,
            score: 100,
            solved: 4,
            integration_passed: true,
            performance: { score: 1, median_ns: 100, iqr_ns: 5, revision: 2, pending: true },
          },
        ],
      }),
    ],
    ["denied-light", liveScene({}, 403, { theme: "light" })],
    ["retrying", liveScene({}, 503)],
  ],
  TeamBenchmarks: [
    ["large-keyboard", benchmarkScene(largeHistory, 200, { after: verifyBenchmarkPaging })],
    [
      "large-keyboard-narrow",
      benchmarkScene(largeHistory, 200, {
        resize: { width: 390, height: 640 },
        after: verifyBenchmarkPaging,
      }),
    ],
    [
      "flamegraph",
      benchmarkScene([benchmarkRun], 200, {
        click: ["Team progress", "Benchmarks", "View flamegraph for revision 2"],
        expectText: "Flamegraph · revision 2",
      }),
    ],

    ["empty", benchmarkScene([])],
    ["measured", benchmarkScene([benchmarkRun])],
    [
      "pending-light",
      benchmarkScene([{ ...benchmarkRun, pending_remeasurement: true, status: "noisy" }], 200, {
        theme: "light",
      }),
    ],
    ["error", benchmarkScene({}, 503)],
  ],

  TeamVotePanel: [
    [
      "submitted-without-reason",
      {
        team: workspaceBoard({ submitted_revision: 2 }),
        enter: true,
        click: ["Team progress"],
        expectText: "Revision 2 submitted.",
      },
    ],
    [
      "deadline-confirmed",
      {
        team: workspaceBoard({
          submitted_revision: 2,
          submitted_by: "deadline",
          vote: { deadline: iso(T0) },
        }),
        enter: true,
        click: ["Team progress"],
        expectText: "Revision 2 submitted at the deadline.",
        after: async ({ page }) => {
          assert.equal(
            await page
              .getByText("Deadline reached. Waiting for server confirmation.", { exact: true })
              .count(),
            0
          );
        },
      },
    ],

    ["hours", { team: workspaceBoard(), enter: true, click: ["Team progress"] }],
    [
      "approved-light",
      {
        team: workspaceBoard({ vote: { mine: true } }),
        theme: "light",
        enter: true,
        click: ["Team progress"],
      },
    ],
    [
      "deadline",
      {
        team: workspaceBoard({ vote: { deadline: iso(T0) } }),
        enter: true,
        click: ["Team progress"],
      },
    ],
    [
      "revision-zero",
      { team: workspaceBoard({ revision: 0 }), enter: true, click: ["Team progress"] },
    ],
  ],
  TeamIntegrationResult: [
    [
      "unbroken-substitution-reason",
      {
        team: workspaceBoard({
          last_result: completedResult(2, {
            substitutions: [{ label: "4", reason: "Y".repeat(400), origin: "reference" }],
          }),
        }),
        enter: true,
        click: ["Team progress", "Integration"],
        resize: { width: 390, height: 480 },
        after: async ({ page }) => {
          await capture(page, "integration-unbroken-reason");
          assert(
            await page.getByText(/Reason: Y{400}/).evaluate((el) => {
              const boundary = el.closest("dialog").getBoundingClientRect();
              const range = document.createRange();
              range.selectNodeContents(el);
              return [...range.getClientRects()].every(
                (r) => r.left >= boundary.left && r.right <= boundary.right
              );
            }),
            "Substitution reason extends outside the integration dialog"
          );
        },
      },
    ],

    ["empty", { team: workspaceBoard(), enter: true, click: ["Team progress", "Integration"] }],
    [
      "substituted",
      {
        team: workspaceBoard({ last_result: completedResult(2) }),
        enter: true,
        click: ["Team progress", "Integration"],
      },
    ],
    [
      "pending-and-previous",
      {
        team: workspaceBoard({
          integration: { revision: 2, status: "running", verdict: null },
          last_result: completedResult(1),
        }),
        theme: "light",
        enter: true,
        click: ["Team progress", "Integration"],
      },
    ],
    [
      "missing-details",
      {
        team: workspaceBoard({ last_result: { revision: 2, status: "completed", verdict: "AC" } }),
        enter: true,
        click: ["Team progress", "Integration"],
      },
    ],
  ],

  TeamWorkspacePanel: [
    [
      "unbroken-holder-short-window",
      {
        team: workspaceBoard({ names: ["Asha", "X".repeat(200), "Chen", "Dinah"] }),
        enter: true,
        click: ["Team progress"],
        resize: { width: 390, height: 480 },
        after: async ({ page }) => {
          await capture(page, "workspace-unbroken-holder");
          const fits = await page
            .getByText("P2 · Held by " + "X".repeat(200), { exact: true })
            .evaluate((el) => {
              const boundary = el.closest("dialog").getBoundingClientRect();
              const range = document.createRange();
              range.selectNodeContents(el);
              return [...range.getClientRects()].every(
                (r) => r.left >= boundary.left && r.right <= boundary.right
              );
            });
          assert(fits, "Unbroken holder name extends outside Team progress");
          const footer = page.getByText("Your submissions: open Attempts below the editor.", {
            exact: true,
          });
          await footer.scrollIntoViewIfNeeded();
          assert(
            await footer.evaluate((el) => {
              const r = el.getBoundingClientRect(),
                d = el.closest("dialog").getBoundingClientRect();
              return r.top >= d.top && r.bottom <= d.bottom;
            }),
            "Short dialog cannot scroll to its footer"
          );
        },
      },
    ],

    [
      "narrow-light",
      {
        team: workspaceBoard({ names: LONG }),
        enter: true,
        click: ["Team progress"],
        theme: "light",
        resize: { width: 390, height: 640 },
      },
    ],

    ["fresh", { team: workspaceBoard(), enter: true, click: ["Team progress"] }],
    [
      "submitted-and-judged",
      {
        team: workspaceBoard({
          parts: submittedParts,
          submitted_revision: 2,
          submitted_by: "vote",
          last_result: completedResult(2),
        }),
        enter: true,
        click: ["Team progress"],
      },
    ],
    [
      "long-holder-names",
      {
        team: workspaceBoard({
          parts: submittedParts,
          names: LONG,
          last_result: completedResult(1),
        }),
        enter: true,
        click: ["Team progress"],
      },
    ],
    [
      "submitted-1280x720",
      {
        team: workspaceBoard({ parts: submittedParts }),
        enter: true,
        click: ["Team progress"],
        viewport: { width: 1280, height: 720 },
      },
    ],
  ],
  TeamLobby: [
    [
      "five-members-long-names",
      {
        team: lobbyBoard({
          claims: ["1", null, "3", null, "5"],
          names: [...LONG, "Z".repeat(200)],
          ready: [false, false, false, false, false],
        }),
        viewport: { width: 1280, height: 600 },
      },
    ],

    [
      "narrow-light",
      {
        team: lobbyBoard({ claims: ["1", null, "3", null], names: LONG }),
        theme: "light",
        viewport: { width: 390, height: 640 },
      },
    ],
    [
      "narrow-320",
      {
        team: lobbyBoard({ claims: ["1", null, "3", null], names: LONG }),
        viewport: { width: 320, height: 640 },
      },
    ],

    ["waiting", { team: lobbyBoard({ phase: "waiting", now: T0 - 5 * 60_000 }) }],
    [
      "waiting-invalid-schedule",
      {
        team: {
          ...lobbyBoard({ phase: "waiting", now: T0 - 5 * 60_000 }),
          phase: { ...lobbyBoard().phase, name: "waiting", selection_opens_at: null },
        },
        invalidProjection: true,
        expectText: "Team status unavailable. Reconnecting…",
      },
    ],
    ["discussion", { team: lobbyBoard({ phase: "discussion", now: T0 + 60_000 }) }],
    ["choosing-empty", { team: lobbyBoard() }],
    ["choosing-mine", { team: lobbyBoard({ claims: ["1", null, "3", null] }) }],
    [
      "choosing-partly-ready",
      { team: lobbyBoard({ claims: ["1", "2", "3", "4"], ready: [true, false, true, false] }) },
    ],
    [
      "choosing-all-ready",
      { team: lobbyBoard({ claims: ["1", "2", "3", "4"], ready: [true, true, true, true] }) },
    ],
    [
      "locked-before-start",
      {
        team: {
          ...lobbyBoard({ phase: "locked", locked: true, claims: ["1", "2", "3", "4"] }),
          phase: { ...lobbyBoard().phase, name: "locked", starts_at: iso(T0 + 20 * 60_000) },
        },
      },
    ],
    [
      "long-names",
      {
        team: {
          ...lobbyBoard({ claims: ["1", "2", null, "4"], names: LONG }),
          team: {
            uid: "team-1",
            number: 7,
            name: "The Extraordinarily Long-Named Algorithmic Collective of Team Seven",
          },
        },
      },
    ],
    [
      "long-part-titles",
      {
        team: lobbyBoard({
          claims: ["1", null, null, null],
          titles: [
            "Distributed rate limiter with sliding-window counters and token buckets",
            "Parser",
            "Consistent hashing ring with virtual nodes for shard placement",
            "Report",
          ],
        }),
      },
    ],
    [
      "no-board-error",
      {
        team: null,
        extra: {
          [`/contests/${CONTEST}/team`]: (route, json) =>
            json({ detail: "Team service is restarting." }, 503),
        },
      },
    ],
    [
      "choosing-1280x720",
      {
        team: lobbyBoard({ claims: ["1", null, "3", null] }),
        viewport: { width: 1280, height: 720 },
      },
    ],
    [
      "choosing-1920x1080",
      {
        team: lobbyBoard({ claims: ["1", null, "3", null] }),
        viewport: { width: 1920, height: 1080 },
      },
    ],
    // Edge scenes for the 1 Dec team round (flaky networks, skewed clocks, races).
    (() => {
      const fx = teamFixture(lobbyBoard({ claims: [null, "2", null, null] }));
      return [
        "poll-5xx-stale-board-recovers",
        {
          team: fx.board,
          extra: fx.extra,
          after: async ({ page }) => {
            fx.fail = 503;
            await nextPoll(page);
            // The lobby says it itself: the voice panel may be showing a voice notice instead.
            await lobbyFeedback(page, "Team service is restarting. Reconnecting…");
            assert(await isDisabled(page, "Claim part 1"), "stale board must not accept claims");
            await capture(page, "TeamLobby-poll-5xx-stale");
            fx.fail = null;
            await nextPoll(page);
            await page
              .getByRole("button", { name: "Claim part 1", exact: true })
              .and(page.locator(":enabled"))
              .waitFor();
            await lobbyFeedback(page, "");
          },
        },
      ];
    })(),
    (() => {
      const fx = teamFixture(lobbyBoard({ claims: ["1", null, null, null] }));
      return [
        "offline-stale-board",
        {
          team: fx.board,
          extra: fx.extra,
          after: async ({ page }) => {
            fx.fail = "offline";
            await nextPoll(page);
            await page.locator(".team-lobby-feedback").getByText(/./).first().waitFor();
            const text = await page.locator(".team-lobby-feedback").innerText();
            assert.doesNotMatch(text, RAW_FETCH, `raw browser error shown: ${text}`);
            await lobbyFeedback(page, "Cannot reach the exam server. Reconnecting…");
            assert(await isDisabled(page, "Release part 1"));
          },
        },
      ];
    })(),
    (() => {
      const fx = teamFixture(lobbyBoard());
      fx.fail = "offline";
      return [
        "offline-first-load-recovers",
        {
          team: null,
          extra: fx.extra,
          after: async ({ page }) => {
            await shown(page, "Cannot reach the exam server. Reconnecting…");
            fx.fail = null;
            await page.clock.runFor(16_000);
            await page.getByRole("heading", { level: 1, name: "Team Seven" }).waitFor();
            await shown(page, "Choose your part");
          },
        },
      ];
    })(),
    (() => {
      let release;
      const fx = teamFixture(lobbyBoard());
      return [
        "claim-during-slow-poll",
        {
          team: fx.board,
          extra: fx.extra,
          after: async ({ page }) => {
            fx.hold = new Promise((r) => (release = r));
            await nextPoll(page);
            await page.getByRole("button", { name: "Claim part 2", exact: true }).click();
            await shown(page, "Team status is updating. Try again in a moment.");
            assert.deepEqual(fx.posts, [], "a claim never races the poll");
            fx.hold = null;
            release();
            await page.waitForTimeout(300);
            assert.deepEqual(fx.posts, [], "the dropped click is not replayed");
          },
        },
      ];
    })(),
    [
      "clock-ahead-7m-choosing",
      {
        team: lobbyBoard(),
        after: async ({ page }) => {
          await page.clock.setSystemTime(T0 + 12 * 60_000);
          await nextPoll(page);
          const left = await countdownSeconds(page, "Parts lock in");
          assert(left > 590 && left <= 600, `device clock moved the lock countdown: ${left}s`);
        },
      },
    ],
    [
      "clock-behind-7m-locked",
      {
        team: lockedBoard(),
        after: async ({ page }) => {
          await page.clock.setSystemTime(T0 - 2 * 60_000);
          await nextPoll(page);
          const left = await countdownSeconds(page, "Contest starts in");
          assert(left > 890 && left <= 900, `device clock moved the start countdown: ${left}s`);
          assert(await isDisabled(page, "Ready"));
        },
      },
    ],
    [
      "clock-ahead-past-start-locked",
      {
        team: lockedBoard(),
        after: async ({ page }) => {
          // The device believes the contest started 10 minutes ago; the server does not.
          await page.clock.setSystemTime(T0 + 30 * 60_000);
          await nextPoll(page);
          assert(await isDisabled(page, "Ready"), "entered before the server start");
          await page.getByText(/^Contest starts in 1\d:\d\d$/).waitFor();
        },
      },
    ],
    (() => {
      const unassigned = lockedBoard({ claims: [null, "2", "3", "4"] }, iso(T0));
      const fx = teamFixture(unassigned);
      return [
        "locked-unassigned-then-auto-assigned",
        {
          team: unassigned,
          extra: fx.extra,
          after: async ({ page }) => {
            await shown(page, "Waiting for your server-confirmed assignment.");
            await shown(page, "No part selected");
            assert(await isDisabled(page, "Ready"), "no assignment must not enter");
            await capture(page, "TeamLobby-locked-unassigned");
            const assigned = lockedBoard({}, iso(T0));
            assigned.members[0].assigned_by = "auto";
            fx.board = assigned;
            await nextPoll(page);
            await shown(page, "Your assigned part is 1 (P1).");
            await shown(page, "Auto-assigned");
            assert.equal(await isDisabled(page, "Ready"), false);
          },
        },
      ];
    })(),
    (() => {
      let contestFails = true;
      const board = lobbyBoard({ phase: "locked", locked: true, claims: ["1", "2", "3", "4"] });
      board.phase = { ...board.phase, name: "locked" };
      const contest = {
        uid: CONTEST,
        title: "Round 2 fixture",
        description: "",
        status: "ACTIVE",
        starts_at: iso(T0),
        ends_at: iso(T0 + 3 * 3600_000),
        is_practice: false,
        frozen: false,
        organization_name: "AMS",
        problems: [],
        server_time: board.server_time,
        remaining_ms: 3 * 3600_000,
        phase: "running",
      };
      return [
        "start-time-unavailable-retry",
        {
          team: board,
          extra: {
            [`/contests/${CONTEST}`]: (route, json) =>
              contestFails ? json({ detail: "unavailable" }, 503) : json(contest),
          },
          after: async ({ page }) => {
            await page.clock.runFor(20_000);
            await shown(page, "Contest start time unavailable. Retry or use Help.");
            assert(await isDisabled(page, "Ready"), "unknown start must not enter");
            await capture(page, "TeamLobby-start-unavailable");
            contestFails = false;
            await page.getByRole("button", { name: "Retry start time", exact: true }).click();
            await page
              .getByRole("button", { name: "Ready", exact: true })
              .and(page.locator(":enabled"))
              .waitFor({ timeout: 20_000 });
            await absent(page, "Contest start time unavailable. Retry or use Help.");
          },
        },
      ];
    })(),
    (() => {
      const fx = teamFixture(lobbyBoard({ claims: [null, "2", "3", "4"] }), {
        claim: (_fx, body) =>
          lobbyBoard({
            claims: [body.part_label, "2", "3", "4"],
            ready: [false, true, true, true],
          }),
        ready: () => lockedBoard({}, iso(T0)),
      });
      return [
        "keyboard-claim-ready-enter",
        {
          team: fx.board,
          extra: fx.extra,
          after: async ({ page }) => {
            await keyboardActivate(
              page,
              page.getByRole("button", { name: "Claim part 1", exact: true })
            );
            await page.getByRole("button", { name: "Release part 1", exact: true }).waitFor();
            assert.deepEqual(fx.posts, ["claim"]);
            await keyboardActivate(
              page,
              page.locator(".team-lobby-readiness").getByRole("button", { name: "Ready" })
            );
            await shown(page, "Parts are locked");
            assert.deepEqual(fx.posts, ["claim", "ready"]);
            await keyboardActivate(page, page.getByRole("button", { name: "Ready", exact: true }));
            await page.getByRole("button", { name: "Team progress" }).waitFor({ timeout: 30_000 });
          },
        },
      ];
    })(),
    (() => {
      const fx = teamFixture(
        lobbyBoard({ claims: ["1", "2", "3", null], ready: [true, true, true, false] })
      );
      return [
        "member-substituted-mid-choosing",
        {
          team: fx.board,
          extra: fx.extra,
          after: async ({ page }) => {
            await shown(page, "Chen Li");
            const next = lobbyBoard({
              claims: ["1", "2", null, null],
              ready: [true, true, false, false],
            });
            next.members[2] = { ...next.members[2], member_uid: "m9", display_name: "Eli Mensah" };
            fx.board = next;
            await nextPoll(page);
            await shown(page, "Eli Mensah");
            await absent(page, "Chen Li");
            await shown(page, "2 of 4 members ready");
            assert.equal(await isDisabled(page, "Claim part 3"), false);
          },
        },
      ];
    })(),
    (() => {
      const discussion = lobbyBoard({ phase: "discussion", now: T0 + 120_000 - 8_000 });
      const fx = teamFixture(discussion);
      let release;
      return [
        "discussion-to-choosing-boundary",
        {
          team: discussion,
          extra: fx.extra,
          after: async ({ page }) => {
            // The boundary passes while the board request is slow.
            fx.hold = new Promise((r) => (release = r));
            fx.board = lobbyBoard({ now: T0 + 120_000 });
            await page.clock.runFor(8_100);
            await shown(page, "Checking the next phase…");
            assert(await isDisabled(page, "Claim part 1"), "claims must wait for the server");
            fx.hold = null;
            release();
            await page.clock.runFor(5_500);
            await shown(page, "Choose your part");
            assert.equal(await isDisabled(page, "Claim part 1"), false);
          },
        },
      ];
    })(),
    [
      "zoom-200-choosing",
      {
        team: lobbyBoard({ claims: ["1", null, "3", null], names: LONG }),
        viewport: { width: 683, height: 384 },
      },
    ],
    [
      "zoom-200-locked",
      { team: lockedBoard({ names: LONG }), viewport: { width: 683, height: 384 } },
    ],
    [
      "small-window-locked-light",
      { team: lockedBoard(), theme: "light", viewport: { width: 390, height: 640 } },
    ],
  ],
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[process.argv.indexOf("--file") + 1];
  const scenes = SCENES[file];
  assert(scenes, `Pass --file with one of: ${Object.keys(SCENES).join(", ")}`);
  const summary = [];
  try {
    for (const [name, options] of scenes) {
      if (options.team) {
        if (options.invalidProjection) assert.throws(() => parseTeamLobby(options.team));
        else parseTeamLobby(options.team);
      }
      const { page, context } = await openScene(`${file}/${name}`, options);
      await page
        .getByRole("heading", {
          level: 1,
          name: options.team && !options.invalidProjection ? options.team.team.name : "Team lobby",
          exact: true,
        })
        .waitFor({ timeout: 30_000 });
      await page.waitForTimeout(1500);
      if (options.enter) {
        // Same path as a candidate: the post-lock Ready opens the part workspace.
        await page.getByRole("button", { name: "Ready", exact: true }).click();
        await page.getByRole("button", { name: "Team progress" }).waitFor({ timeout: 30_000 });
        await page.waitForTimeout(800);
      }
      for (const label of options.click ?? []) {
        await page.getByRole("button", { name: label, exact: true }).last().click();
        await page.waitForTimeout(600);
      }
      if (options.resize) {
        await page.setViewportSize(options.resize);
        await page.waitForTimeout(300);
      }
      if (options.after) await options.after({ page, team: options.team });
      if (options.expectText)
        await page.getByText(options.expectText, { exact: true }).first().waitFor();
      await capture(page, `${file}-${name}`);
      const findings = await audit(page, "body");
      summary.push({ scene: name, findings });
      // An ordinary team dialog must return keyboard focus to its opener.
      const dialog = page.locator("dialog[open]");
      if (await dialog.count()) {
        await page.keyboard.press("Tab");
        assert(
          await dialog.evaluate((el) => el.contains(document.activeElement)),
          "Tab escaped the dialog"
        );
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        assert(
          await page
            .getByRole("button", { name: "Team progress", exact: true })
            .evaluate((el) => el === document.activeElement),
          "Dialog did not restore focus"
        );
      }
      await context.close();
    }
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    await browser.close();
    for (const { scene, findings } of summary)
      console.log(
        `${findings.length ? "FINDINGS" : "CLEAN   "} ${scene}${findings.length ? "\n  - " + findings.join("\n  - ") : ""}`
      );
    if (report.unknownApi.size) console.log("UNKNOWN API", [...report.unknownApi].join(" | "));
    // Resource errors are fixture responses (404 assets, injected 5xx); page exceptions still fail.
    const errors = report.errors.filter((e) => !/Failed to load resource/.test(e));
    if (errors.length) console.log("PAGE ERRORS\n" + errors.join("\n"));
    await writeFile(
      path.join(out, "report.json"),
      JSON.stringify(
        {
          file,
          scenes: summary,
          unknownApi: [...report.unknownApi],
          errors,
        },
        null,
        2
      )
    );
    console.log("OUT", out);
    if (errors.length || report.unknownApi.size || summary.some((s) => s.findings.length))
      process.exitCode = 1;
  }
}
