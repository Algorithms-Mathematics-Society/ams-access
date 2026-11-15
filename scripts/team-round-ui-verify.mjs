/** Team-round UI verification against the real contest page, fixtures only.
 * Run: start `next dev -p 3210` in apps/web, then
 *   PLAYWRIGHT_MODULE=<playwright> node scripts/team-round-ui-verify.mjs http://127.0.0.1:3210 --file TeamLobby
 * Each scene is audited for page overflow, unnamed or overlapping controls,
 * small targets, clipped text and WCAG AA contrast; screenshots go to a temp dir.
 * Entry follows the app's own path (stored session, setup handoff, POST
 * /participant/sessions, native lockdown probe); nothing reaches a real API.
 */
import assert from "node:assert/strict";
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
    parts: ["1", "2", "3", "4"].map((label) => ({
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

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const report = { scenes: [], unknownApi: new Set(), unknownInvoke: new Set(), errors: [] };

/** Opens the contest page in a fresh context and enters it through the real gate. */
export async function openScene(
  name,
  { team, viewport = { width: 1366, height: 768 }, extra = {} }
) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on("pageerror", (e) => report.errors.push(`${name}: ${e.message}`));
  page.on(
    "console",
    (m) => m.type() === "error" && report.errors.push(`${name}: console ${m.text().slice(0, 300)}`)
  );
  await page.addInitScript(
    ({ CONTEST, SESSION, ATTEMPT }) => {
      localStorage.setItem("ams_theme", "dark");
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
      const answers = { is_lockdown_engaged: true, ...(window.__fixtureInvokes ?? {}) };
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
    { CONTEST, SESSION, ATTEMPT }
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
        problems: [],
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
    const root = document.querySelector(scope) ?? document.body;
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
      if (!c.matches("input[type=checkbox],input[type=radio]") && (r.width < 24 || r.height < 24))
        findings.push(
          `small target ${Math.round(r.width)}x${Math.round(r.height)}: ${name.slice(0, 40)}`
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
export const SCENES = {
  TeamLobby: [
    ["waiting", { team: lobbyBoard({ phase: "waiting", now: T0 - 5 * 60_000 }) }],
    [
      "waiting-unscheduled",
      {
        team: {
          ...lobbyBoard({ phase: "waiting", now: T0 - 5 * 60_000 }),
          phase: { ...lobbyBoard().phase, name: "waiting", selection_opens_at: null },
        },
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
  ],
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[process.argv.indexOf("--file") + 1];
  const scenes = SCENES[file];
  assert(scenes, `Pass --file with one of: ${Object.keys(SCENES).join(", ")}`);
  const summary = [];
  try {
    for (const [name, options] of scenes) {
      const { page, context } = await openScene(`${file}/${name}`, options);
      await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(1500);
      await capture(page, `${file}-${name}`);
      const findings = await audit(page, "body");
      summary.push({ scene: name, findings });
      await context.close();
    }
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
    console.log("OUT", out);
    if (errors.length) process.exitCode = 1;
  }
}
