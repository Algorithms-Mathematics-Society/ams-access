import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { voiceMemberRows } from "../../../lib/team-voice-members.ts";
function harness() {
  const source = readFileSync(
    new URL("./components/VoiceEndedNotice.tsx", import.meta.url),
    "utf8"
  );
  const state = [],
    effects = [],
    pending = [];
  let cursor = 0,
    timer;
  const react = {
    useRef(v) {
      const i = cursor++;
      return (state[i] ??= { current: v });
    },
    useState(v) {
      const i = cursor++;
      state[i] ??= v;
      return [
        state[i],
        (v) => {
          state[i] = v;
        },
      ];
    },
    useEffect(fn, deps) {
      const i = cursor++,
        old = effects[i];
      if (!old || deps.some((v, j) => !Object.is(v, old.deps[j])))
        pending.push(() => {
          old?.cleanup?.();
          effects[i] = { deps, cleanup: fn() };
        });
    },
  };
  const exports = {};
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function("require", "exports", "setTimeout", "clearTimeout", js)(
    (name) => {
      if (name === "react") return react;
      if (name === "react-dom") return { createPortal: (node, target) => ({ node, target }) };
      if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }) };
      return { Text: "Text" };
    },
    exports,
    (fn, ms) => {
      timer = { fn, ms };
      return timer;
    },
    () => {
      timer = null;
    }
  );
  return {
    render(patch = {}) {
      const props = {
        contestUid: "one",
        enabled: true,
        status: "team",
        voiceOpen: true,
        compact: true,
        toolbarTarget: "toolbar",
        ...patch,
      };
      cursor = 0;
      exports.useVoiceEndedNotice(props);
      pending.splice(0).forEach((fn) => fn());
      cursor = 0;
      const result = exports.useVoiceEndedNotice(props);
      pending.splice(0).forEach((fn) => fn());
      return result;
    },
    get timer() {
      return timer;
    },
    unmount() {
      effects.forEach((e) => e?.cleanup?.());
    },
  };
}
test("voice end announces for five seconds, not initial wait or transient polls", () => {
  const h = harness();
  assert.equal(h.render({ voiceOpen: false }), null);
  assert.equal(h.render(), null);
  assert.equal(h.render({ status: "error" }), null);
  const notice = h.render({ voiceOpen: false });
  assert.equal(notice.target, "toolbar");
  assert.equal(notice.node.props.children, "Voice has ended for this round");
  assert.equal(h.timer.ms, 5000);
  h.timer.fn();
  assert.equal(h.render({ voiceOpen: false }), null);
  assert.equal(h.timer, null);
});
test("local round end retains notice when disabled and cleans up on unmount", () => {
  const h = harness();
  h.render();
  assert.ok(h.render({ enabled: false }));
  h.unmount();
  assert.equal(h.timer, null);
});
test("phase boundary, actions, and hidden output names have explicit feedback", () => {
  const source = readFileSync(new URL("./components/TeamLobby.tsx", import.meta.url), "utf8");
  assert.match(source, /phase === "discussion" && remaining !== 0/);
  assert.match(source, /setPendingAction\(`Claiming part \$\{part.label\}…`\)/);
  assert.match(source, /setPendingAction\(`Releasing part \$\{part.label\}…`\)/);
  assert.match(source, /state.pending && <Text role="status">/);
  const voice = readFileSync(
    new URL("./components/TeamVoiceControls.tsx", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(voice, /Teams have not been published yet/);
  assert.match(voice, /Output names may appear after microphone access is granted/);
});
test("part rows render real descriptions as wrapping text and preserve legacy rows", () => {
  const source = readFileSync(new URL("./components/TeamLobby.tsx", import.meta.url), "utf8");
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  new Function(
    "require",
    "exports",
    "performance",
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText
  )(
    (name) => {
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "react")
        return { useEffect() {}, useState: (v) => [typeof v === "function" ? v() : v, () => {}] };
      if (name === "@/lib/team-voice-members") return { voiceMemberRows };
      if (name === "@/lib/team-lobby")
        return { countdownMs: () => 60000, contestStartRemaining: () => 60000 };
      return Object.fromEntries(
        ["VStack", "HStack", "Heading", "Token", "Text", "List", "ListItem", "Button"].map((n) => [
          n,
          n,
        ])
      );
    },
    exports,
    { now: () => 0 }
  );
  const part = { label: "1", problem_label: "P1", holder: "Alice", holder_is_me: false };
  const render = (patch) => {
    const result = exports.TeamLobby({
      state: {
        status: "team",
        sampledAt: 0,
        pending: false,
        board: {
          team: { name: "Team" },
          members: [],
          parts: [{ ...part, ...patch }],
          phase: { name: "discussion", starts_at: "2026-01-01T00:00:00Z" },
          allocation: { locked: false },
        },
      },
      contestUid: "contest",
    });
    return result.props.children.find(
      (n) => n?.type === "List" && n.props.header.props.children === "Parts"
    ).props.children[0];
  };
  const old = render({});
  assert.equal(old.props.label, "Part 1 · P1");
  assert.equal(old.props.description.type, "HStack");
  assert.equal(old.props.description.props.children[0].props.children, "Alice");
  const title = "VeryLongUnbrokenAuthoredTitle".repeat(8);
  const summary = "<b>Authored text, not HTML</b>";
  const next = render({ title, summary });
  assert.equal(next.props.label, `Part 1 · ${title}`);
  const description = next.props.description;
  assert.equal(description.type, "HStack");
  assert.equal(description.props.style.minWidth, 0);
  assert.equal(description.props.style.overflowWrap, "anywhere");
  assert.equal(description.props.children[0].props.children, "Alice");
  const details = description.props.children[1];
  assert.equal(details.type, "details");
  assert.equal(details.props.children[1].props.children, "P1");
  assert.equal(details.props.children[2].props.children, summary);
});

test("voice presentation moves between reserved lobby region and toolbar without a second owner", () => {
  const source = readFileSync(
    new URL("./components/TeamVoicePresentation.tsx", import.meta.url),
    "utf8"
  );
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  new Function(
    "require",
    "exports",
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText
  )((name) => {
    if (name === "react")
      return {
        useEffect() {},
        useRef: (value) => ({ current: value }),
        useState: () => [false, () => {}],
      };
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name === "react-dom") return { createPortal: (node, target) => ({ node, target }) };
    if (name === "@/lib/team-voice-presentation")
      return { voiceStatusText: (status) => `Voice status: ${status}` };
    return Object.fromEntries(
      ["Button", "Popover", "HStack", "Text", "Mic", "MicOff"].map((n) => [n, n])
    );
  }, exports);
  const props = {
    compact: false,
    lobbyTarget: { id: "lobby" },
    toolbarTarget: { id: "toolbar" },
    suspended: false,
    snapshot: null,
    onToggleMute() {},
    onRequestJoin() {},
    onDismiss() {},
    canJoin: true,
    children: { id: "settings" },
  };
  const lobby = exports.TeamVoicePresentation(props);
  assert.equal(lobby.target, props.lobbyTarget);
  assert.equal(lobby.node, props.children);
  const workspace = exports.TeamVoicePresentation({ ...props, compact: true });
  assert.equal(workspace.target, props.toolbarTarget);
  assert.equal(workspace.node.props.children[0], false);
  const trigger = (view) => view.node.props.children.at(-1).props.children;
  assert.equal(trigger(workspace).props.label, "Join voice");
  for (const status of ["connecting", "reconnecting", "unavailable", "closed", "replaced"]) {
    const state = exports.TeamVoicePresentation({
      ...props,
      compact: true,
      snapshot: { status, muted: true, peers: [] },
    });
    assert.equal(
      trigger(state).props.label,
      status === "connecting"
        ? "Connecting…"
        : status === "reconnecting"
          ? "Reconnecting…"
          : "Join voice"
    );
  }
  for (const notice of [null, "Team status is reconnecting. Your work is safe."]) {
    const state = exports.TeamVoicePresentation({
      ...props,
      compact: true,
      notice,
      snapshot: {
        status: "connected",
        error: "Allow audio playback to hear your team.",
        peers: [],
      },
    });
    assert.equal(trigger(state).props.label, "Audio issue");
    assert.equal(trigger(state).props.tooltip, notice ?? "Allow audio playback to hear your team.");
  }
  for (const muted of [true, false]) {
    let toggles = 0;
    const joined = exports.TeamVoicePresentation({
      ...props,
      compact: true,
      snapshot: { status: "connected", muted, peers: [] },
      onToggleMute() {
        toggles += 1;
      },
    });
    const mic = joined.node.props.children[0];
    assert.equal(mic.props.label, muted ? "Muted" : "Live");
    assert.ok(mic.props["aria-label"].includes(mic.props.label));
    assert.equal(mic.props["aria-keyshortcuts"], "Control+Shift+M");
    assert.match(mic.props.tooltip, /Ctrl\+Shift\+M/);
    assert.equal(mic.props.isDisabled, false);
    if (!muted) assert.equal(mic.props.style.color, "var(--color-text-green)");
    mic.props.onClick();
    assert.equal(toggles, 1);
  }

  assert.equal(workspace.node.props.children.at(-1).props.content, props.children);
  assert.equal(
    exports.TeamVoicePresentation({ ...props, lobbyTarget: null }),
    null,
    "waiting for the reserved region never inserts a full-width voice strip above content"
  );
});

function renderVoiceSettings({
  compact = false,
  connected = false,
  muted = true,
  status = "connected",
  enabled = true,
  membersTarget = null,
  renderMembers,
  suspended = false,
} = {}) {
  const source = readFileSync(
    new URL("./components/TeamVoiceControls.tsx", import.meta.url),
    "utf8"
  );
  const exports = {};
  let snapshotUsed = false;
  const snapshot = connected ? { status, muted, inputLevel: 0, peers: [], error: null } : null;
  const jsx = (type, props) => ({ type, props });
  new Function(
    "require",
    "exports",
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText
  )((name) => {
    if (name === "react")
      return {
        useEffect() {},
        useRef: (v) => ({ current: v }),
        useState: (v) => {
          if (v === null && !snapshotUsed) {
            snapshotUsed = true;
            return [snapshot, () => {}];
          }
          return [v, () => {}];
        },
      };
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name === "react-dom")
      return {
        createPortal: (children, target) => ({ type: "portal", props: { children, target } }),
      };
    if (name === "@/lib/team-voice-input") return { createVoiceAutoJoinGate: () => ({}) };
    if (name === "./VoiceEndedNotice") return { useVoiceEndedNotice: () => null };
    if (name === "@/lib/team-voice-members")
      return {
        voiceMemberRows: () => [
          { key: "self", member: { display_name: "Candidate", is_me: true }, status: "muted" },
        ],
      };
    if (name === "@/lib/team-voice-presentation") return { voiceStatusText: () => "Connected" };
    return Object.fromEntries(
      [
        "TeamVoicePresentation",
        "Button",
        "LeaveTeamVoice",
        "VStack",
        "HStack",
        "Text",
        "List",
        "ListItem",
        "Slider",
        "Selector",
      ].map((n) => [n, n])
    );
  }, exports);
  const tree = exports.TeamVoiceControls({
    contestUid: "contest",
    enabled,
    compact,
    membersTarget,
    renderMembers,
    suspended,
    projection: {
      status: "team",
      error: null,
      board: { team: { name: "Team" }, phase: { voice_open: true }, members: [] },
    },
  });
  const settings = tree.props.children.find((node) => node?.props?.onToggleMute)?.props.children;
  const roster = settings?.props.children.find((n) => n?.type === "VStack" && n.props.as);
  return { settings, roster, tree };
}

test("lobby has no duplicate audio roster and workspace retains member settings", () => {
  for (const connected of [false, true]) {
    const lobby = renderVoiceSettings({ connected });
    assert.equal(lobby.roster, undefined);
    assert.equal(lobby.settings.props.style.maxHeight, undefined);
    assert.doesNotMatch(JSON.stringify(lobby.settings), /Member audio settings/);
  }
  const workspace = renderVoiceSettings({ compact: true, connected: true });
  assert.equal(workspace.roster.props.as, "section");
  assert.equal(workspace.settings.props.style.maxHeight, "60vh");
});

test("connected voice uses the mic control for state and shortcut without redundant guidance", () => {
  for (const compact of [false, true]) {
    for (const muted of [true, false]) {
      const { settings } = renderVoiceSettings({ connected: true, compact, muted });
      const header = settings.props.children[0];
      const mic = header.props.children.find(
        (node) => node?.props?.label === (muted ? "Muted" : "Live")
      );
      if (compact) {
        assert.equal(mic, undefined, "workspace uses only the persistent toolbar microphone");
        continue;
      }
      assert.equal(mic.props["aria-pressed"], !muted);
      assert.equal(mic.props["aria-keyshortcuts"], "Control+Shift+M");
      assert.match(mic.props.tooltip, /Ctrl\+Shift\+M/);
      assert.equal(
        header.props.children[1],
        false,
        "connected status is conveyed by the mic button"
      );
      if (!muted) {
        assert.equal(mic.props.style.color, "var(--color-text-green)");
        assert.equal(mic.props.style.background, "var(--color-success-muted)");
      }
      const rendered = JSON.stringify(settings);
      assert.doesNotMatch(
        rendered,
        /Microphone starts muted|microphone starts muted|controlled by the system audio settings|Mute shortcut:/
      );
    }
  }
  const reconnecting = renderVoiceSettings({ connected: true, status: "reconnecting" });
  assert.equal(reconnecting.settings.props.children[0].props.children[1].props.role, "status");
});

test("leave confirmation keeps Stay primary and only confirms a deliberate leave", () => {
  const source = readFileSync(new URL("./components/LeaveTeamVoice.tsx", import.meta.url), "utf8");
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  let confirming = false;
  let leaves = 0;
  new Function(
    "require",
    "exports",
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText
  )((name) => {
    if (name === "react")
      return {
        useState: () => [
          confirming,
          (value) => {
            confirming = value;
          },
        ],
      };
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    return { Button: "Button", HStack: "HStack", Text: "Text" };
  }, exports);
  const render = () =>
    exports.LeaveTeamVoice({
      onLeave: () => {
        leaves++;
      },
    });
  render().props.onClick();
  assert.equal(leaves, 0, "opening confirmation never disconnects voice");
  const stay = render().props.children[1];
  assert.equal(stay.props.variant, "primary");
  stay.props.onClick();
  assert.equal(leaves, 0);
  assert.equal(render().props.label, "Leave voice");
  render().props.onClick();
  const leave = render().props.children[2];
  assert.equal(leave.props.variant, "destructive");
  leave.props.onClick();
  assert.equal(leaves, 1);
  assert.equal(render().props.label, "Leave voice");
});

test("recovery actions remain reachable when editing is locked, and locked entry precedes parts", () => {
  const source = readFileSync(new URL("./components/TeamLobby.tsx", import.meta.url), "utf8");
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  new Function(
    "require",
    "exports",
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText
  )((name) => {
    if (name === "react")
      return { useEffect() {}, useState: (v) => [typeof v === "function" ? v() : v, () => {}] };
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name === "@/lib/team-voice-members") return { voiceMemberRows };
    if (name === "@/lib/team-lobby")
      return { countdownMs: () => 60000, contestStartRemaining: () => 0 };
    return Object.fromEntries(
      ["VStack", "HStack", "Heading", "Token", "Text", "List", "ListItem", "Button"].map((n) => [
        n,
        n,
      ])
    );
  }, exports);
  const actions = { type: "Help and Exit" };
  const board = {
    team: { name: "Team" },
    members: [],
    phase: { name: "choosing", starts_at: "2026-01-01T00:00:00Z" },
    allocation: { locked: false },
    parts: [{ label: "A", problem_label: "A", holder: null, holder_is_me: false }],
  };
  const render = (patch = {}) =>
    exports.TeamLobby({
      contestUid: "contest",
      state: { status: "team", sampledAt: 0, pending: false, board },
      actions,
      canEnter: false,
      ...patch,
    });
  const blocked = render();
  assert.equal(blocked.props.children[0].props.children[1], actions);
  const parts = blocked.props.children.find(
    (n) => n?.type === "List" && n.props.header.props.children === "Parts"
  );
  assert.equal(
    parts.props.children[0].props.endContent.props.isDisabled,
    true,
    "editor lock disables claims without trapping recovery controls"
  );
  const locked = render({
    canEnter: true,
    state: {
      status: "team",
      sampledAt: 0,
      pending: false,
      board: {
        ...board,
        phase: { ...board.phase, name: "locked" },
        allocation: { locked: true },
        parts: [{ ...board.parts[0], holder_is_me: true }],
      },
    },
  });
  const entry = locked.props.children.findIndex(
    (n) =>
      n?.type === "VStack" &&
      n.props.children?.some?.((child) => child?.type === "Button" && child.props.label === "Ready")
  );
  const partList = locked.props.children.findIndex((n) => n?.type === "List");
  assert.ok(entry > 0 && entry < partList, "primary workspace entry is adjacent to phase guidance");

  const client = readFileSync(new URL("./client.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile(
    "client.tsx",
    client,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let lobby;
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "TeamLobby") lobby = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const inert = lobby.parent.openingElement.attributes.properties
    .find((prop) => ts.isJsxAttribute(prop) && prop.name.text === "inert")
    .initializer.getText(ast);
  assert.doesNotMatch(inert, /editorLocked/);
  for (const blocker of [
    "criticalOverlayActive",
    "networkOverlayActive",
    "leaveConfirm",
    "showSupportChat",
  ])
    assert.ok(inert.includes(blocker));
});

test("assignment roster renders once in its own rail with authoritative member assignments", () => {
  const source = readFileSync(new URL("./components/TeamLobby.tsx", import.meta.url), "utf8");
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  new Function(
    "require",
    "exports",
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText
  )((name) => {
    if (name === "react")
      return { useEffect() {}, useState: (v) => [typeof v === "function" ? v() : v, () => {}] };
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name === "@/lib/team-voice-members") return { voiceMemberRows };
    if (name === "@/lib/team-lobby")
      return { countdownMs: () => 60000, contestStartRemaining: () => 0 };
    return Object.fromEntries(
      ["VStack", "HStack", "Heading", "Token", "Text", "List", "ListItem", "Button"].map((n) => [
        n,
        n,
      ])
    );
  }, exports);
  assert.equal(exports.TeamLobbyMembers({ state: { board: null } }), null);
  const members = [
    {
      member_uid: "me",
      display_name: "Same name",
      is_me: true,
      part_label: "A",
      assigned_by: null,
    },
    {
      member_uid: "peer",
      display_name: "Same name",
      is_me: false,
      part_label: "B",
      assigned_by: "auto",
    },
    {
      member_uid: "waiting",
      display_name: "Waiting member",
      is_me: false,
      part_label: null,
      assigned_by: null,
    },
  ];
  const state = {
    status: "team",
    sampledAt: 0,
    pending: false,
    board: {
      team: { name: "Team" },
      phase: { name: "choosing", starts_at: "2026-01-01T00:00:00Z" },
      allocation: { locked: false },
      parts: [],
      members,
    },
  };
  const rail = exports.TeamLobbyMembers({ state });
  assert.equal(rail.props.as, "aside");
  assert.equal(rail.props.className, "team-lobby-members");
  assert.equal(rail.props.style.overflow, undefined, "members share page scrolling");
  const rows = rail.props.children.props.children;
  assert.equal(rows.length, 3);
  assert.equal(rows[0].props.label, "Same name (you)");
  assert.equal(rows[0].props.description.props.children, "Part A");
  assert.equal(rows[1].props.description.props.children, "Part B");
  assert.equal(rows[1].props.endContent.props.children[2].props.label, "Auto-assigned");
  assert.equal(rows[2].props.description.props.children, "No part selected");
  const snapshot = {
    status: "connected",
    muted: true,
    peers: [{ memberUid: "peer", muted: false, speaking: true, volume: 0.6 }],
  };
  const changes = [];
  const liveRows = exports.TeamLobbyMembers({
    state,
    snapshot,
    onVolume: (...change) => changes.push(change),
  }).props.children.props.children;
  const presence = (row) => row.props.endContent.props.children[0].props.children;
  assert.equal(presence(liveRows[0]).props["aria-label"], "Same name: muted");
  assert.equal(presence(liveRows[1]).props["aria-label"], "Same name: speaking");
  assert.equal(presence(liveRows[2]).props["aria-label"], "Waiting member: not in voice");
  liveRows[1].props.endContent.props.children[1].props.onChange(35);
  assert.deepEqual(changes, [["peer", 0.35]]);
  assert.equal(presence(rows[1]).props["aria-label"], "Same name: voice status unavailable");
  const main = exports.TeamLobby({
    state,
    contestUid: "contest",
    onClaim() {},
    onRelease() {},
    onEnter() {},
  });
  assert.equal(
    main.props.children.filter((node) => node?.type === "List").length,
    1,
    "main content contains only the parts list"
  );
});

test("lobby keeps action feedback mounted and readiness guidance stable", () => {
  const source = readFileSync(new URL("./components/TeamLobby.tsx", import.meta.url), "utf8");
  assert.match(source, /<VStack gap=\{0\} className="team-lobby-feedback">/);
  assert.doesNotMatch(source, /board.readiness\?\.mine\s*\?/);
  assert.match(source, /label="Claim"/);
  const styles = readFileSync(new URL("./components/workspace-styles.ts", import.meta.url), "utf8");
  assert.match(styles, /team-lobby-feedback \{ min-height:var\(--spacing-6\)/);
  assert.match(styles, /team-lobby-part > :last-child \{[^}]*min-width:/);
});

test("voice owner portals the rail even when disabled and suspends its controls", () => {
  const target = {};
  for (const enabled of [false, true]) {
    const seen = [];
    const { tree } = renderVoiceSettings({
      enabled,
      connected: true,
      suspended: true,
      membersTarget: target,
      renderMembers: (snapshot, volume) => {
        seen.push(snapshot);
        assert.equal(typeof volume, "function");
        return { type: "roster" };
      },
    });
    const portal = tree.props.children.find((node) => node?.type === "portal");
    assert.equal(portal.props.target, target);
    assert.equal(portal.props.children.props.inert, true);
    assert.equal(portal.props.children.props.children.type, "roster");
    assert.equal(seen[0]?.status ?? null, enabled ? "connected" : null);
  }
});
