// Submit-button derivation — SUBMIT state only, decoupled from autosave by
// construction: SubmitButtonState has NO save field, and the committed test
// scans this module's source for save identifiers. The save indicators (top
// pill + footer, via deriveSaveIndicator) own save state; this button never
// renders it. See design 2026-07-03-submit-button-decouple §3a/§3d.

export type SubmitButtonState = {
  isSubmitting: boolean;
  submissionError: string | null;
  hasSession: boolean;
  editorEmpty: boolean;
};

export type SubmitButtonView = {
  label: "Submit" | "Submitting" | "Submit Failed";
  disabled: boolean;
  icon: "send" | "spinner";
};

export function deriveSubmitButton(state: SubmitButtonState): SubmitButtonView {
  if (state.isSubmitting) {
    return { label: "Submitting", disabled: true, icon: "spinner" };
  }
  const disabled = !state.hasSession || state.editorEmpty;
  if (state.submissionError) {
    return { label: "Submit Failed", disabled, icon: "send" };
  }
  return { label: "Submit", disabled, icon: "send" };
}
