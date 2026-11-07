import type { LobbyState } from "@/lib/team-lobby";

/** Allocation is authoritative only after the server locks it. Names are never identity. */
export function assignedWorkspaceLabel(state: LobbyState): string | null {
  if (
    state.status !== "team" ||
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
