/** Public login help uses only bundled guidance and explicitly allowlisted metadata. */
export const LOGIN_SUPPORT_URL = "https://amsaccess.com/contact?source=access-login";
export const LOGIN_SUPPORT_EMAIL = "team@amshq.in";

export const LOGIN_HELP_TOPICS = {
  missing: {
    label: "Credentials not received",
    guidance:
      "Check your registration email and spam folder, or your printed sign-in slip. Ask your contest organizer or invigilator to verify your registration and reissue your details.",
  },
  rejected: {
    label: "Credentials not accepted",
    guidance:
      "Use the Login ID and password issued for this contest. If you received replacement details, use those. If they still fail, ask your organizer to verify them; avoid repeated guesses.",
  },
  connection: {
    label: "Server or connection problem",
    guidance:
      "A connection error does not tell us whether the problem is on your device or the server. Wait a moment before retrying. You can contact AMS support from another connected device.",
  },
  other: {
    label: "Something else",
    guidance:
      "Describe what you were trying to do and what happened. Include your contest name when contacting support. Do not share your password.",
  },
} as const;
export type LoginHelpTopic = keyof typeof LOGIN_HELP_TOPICS;

export function loginHelpError(diagnostic: unknown, hasError: boolean): string {
  // Never include the server's free-form message or an arbitrary host/URL.
  const code = typeof diagnostic === "string" ? diagnostic.split(" · ").at(-1) : null;
  if (code === "TIMEOUT") return "The exam server did not respond in time (TIMEOUT).";
  if (code === "UNREACHABLE") return "The app could not reach the exam server (UNREACHABLE).";
  return hasError
    ? "Sign-in did not complete. See the sign-in screen for the message."
    : "No sign-in error recorded.";
}

export function coarseLoginPlatform(userAgent: string): string {
  if (/Windows/i.test(userAgent)) return "Windows";
  if (/Macintosh|Mac OS X/i.test(userAgent)) return "macOS";
  if (/Linux/i.test(userAgent)) return "Linux";
  return "Unavailable";
}

export function buildLoginHelpSummary(input: {
  version: unknown;
  userAgent: string;
  diagnostic: unknown;
  hasError: boolean;
  topic: LoginHelpTopic;
  openedAt: Date;
}): string {
  const version =
    typeof input.version === "string" &&
    /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:[-+][a-zA-Z0-9.-]{1,40})?$/.test(input.version)
      ? input.version
      : "Unavailable";
  const time = Number.isFinite(input.openedAt.getTime())
    ? input.openedAt.toISOString()
    : "Unavailable";
  return [
    "AMS Access sign-in help",
    `Topic: ${LOGIN_HELP_TOPICS[input.topic]?.label ?? LOGIN_HELP_TOPICS.other.label}`,
    `App version: ${version}`,
    `Platform (browser-reported): ${coarseLoginPlatform(input.userAgent)}`,
    `Help opened (device time, UTC): ${time}`,
    `Last sign-in result: ${loginHelpError(input.diagnostic, input.hasError)}`,
  ].join("\n");
}
