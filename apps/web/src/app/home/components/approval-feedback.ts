/** Candidate wording follows an acknowledged server state, never elapsed time. */
export function approvalMessage(status: string | undefined, reviewNote?: string | null): string {
  switch (status?.toUpperCase()) {
    case "PENDING":
      return "Re-entry request received. Waiting for organizer approval. Status refreshes automatically; you do not need to send another request.";
    case "APPROVED":
      return "Re-entry approved. Choose Resume to run the required setup checks and rejoin.";
    case "REJECTED":
      return `The organizer declined this re-entry request.${reviewNote?.trim() ? ` ${reviewNote.trim()}` : " Ask your invigilator for help."}`;
    case "EXPIRED":
      return "This re-entry request expired. Choose Resume to check whether a new request is allowed.";
    case "CONSUMED":
      return "Approval was used. Choose Resume to verify your current session before continuing.";
    default:
      return "The current approval decision is unavailable. Ask your invigilator for help.";
  }
}

export function approvalLabel(status: string | undefined, unavailable: boolean): string {
  if (unavailable) return "Status unavailable";
  switch (status?.toUpperCase()) {
    case "PENDING":
      return "Approval pending";
    case "APPROVED":
      return "Approved to rejoin";
    case "REJECTED":
      return "Request declined";
    case "EXPIRED":
      return "Request expired";
    case "CONSUMED":
      return "Approval used";
    default:
      return "Session verified";
  }
}

export function acceptedRequestTime(value?: string): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
