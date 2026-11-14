import type { VoiceTeam } from "./team-voice-api";
import type { TeamVoiceSnapshot } from "./team-voice-engine";

/** Only stable roster IDs establish presence; names may be identical. */
export function voiceMemberRows<Member extends VoiceTeam["members"][number]>(
  team: Omit<VoiceTeam, "members"> & { members: Member[] },
  snapshot: TeamVoiceSnapshot | null
) {
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
      : !connected || !member.member_uid
        ? "voice status unavailable"
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
