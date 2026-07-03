// An edit marks the buffer unsaved but MUST NOT clear a prior save failure.
// Clearing it on keystroke would erase the candidate's "Not saved" warning the
// instant they typed — repainting it to a benign "Saving…" while the last real
// save attempt still failed. Only an actual save attempt (handleSave) may
// change saveError: it clears it at the start of the attempt and then reflects
// that attempt's real outcome (success clears it; failure re-sets it).
//
// See save-indicator.ts / the "confirmed indicator" invariant this closes a
// hole in.
export function saveErrorAfterEdit(current: string | null): string | null {
  return current; // sticky: an edit never clears a failure
}
