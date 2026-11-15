import type { TeamVoiceSnapshot } from "./team-voice-engine";

export function voiceStatusText(status: TeamVoiceSnapshot["status"]): string {
  return {
    idle: "Ready · microphone starts muted",
    connecting: "Connecting to your team…",
    connected: "In voice",
    reconnecting: "Reconnecting to your team…",
    unavailable: "Team voice is unavailable",
    closed: "Voice has ended for this round",
    replaced: "Voice moved to another window or device. This one has stopped.",
  }[status];
}

/** Only known, candidate-facing advice crosses the engine/UI boundary. */
export function voiceErrorAdvice(error: string | null): string | null {
  if (!error) return null;
  switch (error) {
    case "Microphone access was denied.":
      return "Allow microphone access in system settings, then choose Retry voice.";
    case "No microphone was found.":
    case "Microphone disconnected.":
      return "Connect a microphone, then choose Retry voice.";
    case "Microphone request timed out.":
      return "The microphone did not respond. Check the permission prompt and try again.";
    case "Microphone could not be opened.":
      return "Your microphone could not be opened. Check your audio device and try again.";
    case "Allow audio playback to hear your team.":
      return "Audio playback is blocked. Choose Retry audio playback to hear your team.";
    case "Your sign-in has expired.":
      return "Your sign-in has expired. Sign in again, then choose Retry voice.";
    case "Team voice is not available to you.":
      return "Your account cannot join team voice for this round. Ask a proctor for help.";
    case "A teammate audio connection failed.":
      return "A teammate’s audio connection was interrupted.";
    case "Voice relay credentials could not be renewed.":
    case "Voice relay credentials expired.":
    case "Team voice relay is unavailable.":
      return "The team voice service is unavailable. Choose Retry voice to reconnect.";
    default:
      return "The voice connection failed. Check your connection, then choose Retry voice.";
  }
}
