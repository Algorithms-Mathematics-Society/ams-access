/** Labels describe actual awaited work, never a fabricated percentage or ETA. */
export function entryProgressLabel(operation: string): string {
  switch (operation) {
    case "contest eligibility check":
      return "Checking contest eligibility";
    case "media device listing":
      return "Checking available camera and microphone devices";
    case "session creation":
      return "Confirming your contest session";
    case "review recording":
      return "Saving your proctor review request";
    case "desktop protection verification":
      return "Verifying device protection";
    default:
      return "Recording setup results";
  }
}
