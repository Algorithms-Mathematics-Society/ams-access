// Turning a handful of camera samples into one presence verdict.
//
// The stage this replaces set `confirmed` on a 1200 ms `setTimeout` and then
// rendered "Presence confirmed" / "Identity verified". It said that with a
// null stream, with the lens taped over, and with nobody in the room. This
// module is the decision it should have been making, kept pure so the rules
// are actually testable — the component around it can only be eyeballed.
//
// A verdict is never "fail" here. Decision 7: onboarding records and warns, it
// does not eject. `absent`, `multiple` and `unknown` all let the candidate
// through with the stage recorded as a warning, because a person locked out of
// an exam by a webcam is a worse outcome than a person flagged for review.

import type { PresenceSample } from "@/lib/presence-monitor";

/** How many samples to take, and how far apart. ~4 s of wall clock. */
export const SAMPLE_COUNT = 3;
export const SAMPLE_INTERVAL_MS = 1300;

export type PresenceVerdict = "present" | "absent" | "multiple" | "unknown";

/**
 * `null` samples are frames the detector could not read at all — a video
 * element with no decodable frame, a missing 2D context. They are not
 * evidence of absence, so they are discarded rather than counted against the
 * candidate; if *every* sample is null we have measured nothing and say so.
 */
export function decidePresence(samples: readonly (PresenceSample | null)[]): PresenceVerdict {
  const usable = samples.filter((s): s is PresenceSample => s !== null);
  if (usable.length === 0) return "unknown";

  // A second face anywhere in the window outranks a majority of clean frames.
  // Someone who steps out of shot for one sample is ordinary; someone else
  // appearing in shot for one sample is the thing this check exists to catch.
  if (usable.some((s) => s.status === "multiple_faces")) return "multiple";

  const present = usable.filter((s) => s.status === "presence_ok").length;
  return present * 2 > usable.length ? "present" : "absent";
}

/** Whether the verdict should be recorded as a clean pass. */
export function isPresencePass(verdict: PresenceVerdict): boolean {
  return verdict === "present";
}

export function presenceMessage(verdict: PresenceVerdict): string {
  switch (verdict) {
    case "present":
      return "You are visible to the camera";
    case "absent":
      return "We could not see you clearly — this is recorded, and you may continue";
    case "multiple":
      return "More than one person was visible — this is recorded for your proctor";
    case "unknown":
      return "The presence check could not run on this device — recorded, and you may continue";
  }
}
