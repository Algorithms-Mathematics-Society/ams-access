import type { LobbyState } from "@/lib/team-lobby";

/**
 * Allocation is authoritative only after the server locks it. Names are never identity.
 * A transient poll failure ("error") keeps the last good board, so the label survives it.
 */
export function assignedWorkspaceLabel(state: LobbyState): string | null {
  if (
    (state.status !== "team" && state.status !== "error") ||
    state.board?.phase.name !== "locked" ||
    !state.board.allocation.locked
  )
    return null;
  const own = state.board.parts.filter((part) => part.holder_is_me);
  return own.length === 1 && own[0].problem_label ? own[0].problem_label : null;
}

export function teamWorkspaceAllowed(state: LobbyState, entered: boolean): boolean {
  return state.status === "solo" || (entered && assignedWorkspaceLabel(state) !== null);
}

export type WorkspaceIdentity = {
  contestId: string;
  sessionId: string;
  generation: number;
  label: string;
};
/** Transient board failures must not reinstall drafts over the live editor buffer. */
export function workspaceAlreadyLoaded(
  loaded: WorkspaceIdentity | null,
  current: WorkspaceIdentity
): boolean {
  return (
    loaded !== null &&
    loaded.contestId === current.contestId &&
    loaded.sessionId === current.sessionId &&
    loaded.generation === current.generation &&
    loaded.label === current.label
  );
}

/** Only the assigned part may be fetched; teammate statements stay private. */
export function teamWorkspaceLabels(state: LobbyState): string[] {
  const own = assignedWorkspaceLabel(state);
  if (!own || !state.board) return [];
  const labels = state.board.parts.map((part) => part.problem_label);
  if (labels.some((label) => !label) || new Set(labels).size !== labels.length) return [];
  return [own];
}

export function teamPartAccess(state: LobbyState, label: string) {
  const own = assignedWorkspaceLabel(state);
  const part = state.board?.parts.find((part) => part.problem_label === label);
  const editable = Boolean(own && label === own && part?.holder_is_me);
  return {
    editable,
    label: editable ? "Your part" : part?.holder ? `Held by ${part.holder}` : "Part unavailable",
  };
}

/** Presentation and click-time guard share server time; never trust the device wall clock. */
export function teamSubmissionBlock(
  state: LobbyState,
  label: string,
  now = performance.now()
): string | null {
  const access = teamPartAccess(state, label);
  if (!access.editable) return access.label;
  const submission = state.board?.submission;
  if (!submission) return "Team submission status unavailable. Wait for the next update.";
  const remaining =
    Date.parse(submission.deadline) -
    Date.parse(state.board!.server_time) -
    Math.max(0, now - state.sampledAt);
  if (!Number.isFinite(remaining) || remaining <= 0)
    return "The team submission deadline has passed.";
  return null;
}

/** Read-only teammate parts are visible context, not this candidate's unfinished work. */
export function finishReviewQuestions<T extends { id: string }>(
  questions: T[],
  teamState: LobbyState | null
): T[] {
  if (!teamState || teamState.status === "solo") return questions;
  return questions.filter((question) => teamPartAccess(teamState, question.id).editable);
}
