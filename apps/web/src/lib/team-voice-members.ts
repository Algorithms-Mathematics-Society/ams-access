import type { VoiceTeam } from "./team-voice-api";
import type { TeamVoiceSnapshot } from "./team-voice-engine";

/** Only stable roster IDs establish presence; names may be identical. */
export function voiceMemberRows(team: VoiceTeam, snapshot: TeamVoiceSnapshot | null) {
  const connected = snapshot?.status === "connected";
  const peers = new Map(connected ? snapshot.peers.map((peer) => [peer.memberUid, peer]) : []);
  return team.members.map((member, index) => {
    const peer = !member.is_me && member.member_uid ? peers.get(member.member_uid) : undefined;
    const status = member.is_me
      ? connected
        ? snapshot.muted
          ? "muted"
          : "in voice"
        : "not in voice"
      : !member.member_uid
        ? "voice status unavailable"
        : !connected
          ? // Out of voice this client cannot see teammates; say why, not "unavailable".
            snapshot?.status === "connecting" || snapshot?.status === "reconnecting"
            ? "connecting…"
            : snapshot?.status === "closed"
              ? "voice ended"
              : "join voice to see"
          : !peer
            ? "not in voice"
            : peer.muted
              ? "muted"
              : peer.speaking
                ? "speaking"
                : "in voice";
    return { key: member.member_uid ?? `legacy-${index}`, member, peer, status };
  });
}
