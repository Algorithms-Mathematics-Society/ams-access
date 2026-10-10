// Save-indicator derivation — CONFIRMED, never optimistic. "All changes saved"
// is returned ONLY for the post-server-200 state (no error, not saving, nothing
// unsaved). A proctored exam where a lying "Saved" hides a failed save = lost
// answer; the test locks that invariant. See design 2026-07-03 §3 / §5 2b.

export type SaveIndicatorState = {
  saveError: string | null;
  saving: boolean;
  hasUnsavedChanges: boolean;
};

export type SaveIndicatorIcon = "error" | "loading" | "pending" | "saved";

export type SaveIndicator = {
  label: string;
  color: string;
  bg: string;
  border: string;
  icon: SaveIndicatorIcon;
};

export function deriveSaveIndicator(state: SaveIndicatorState): SaveIndicator {
  if (state.saveError) {
    return {
      label: "Couldn't save — retrying",
      color: "var(--color-text-red)",
      bg: "var(--color-error-muted)",
      border: "color-mix(in srgb, var(--color-error) 28%, transparent)",
      icon: "error",
    };
  }
  if (state.saving) {
    return {
      label: "Saving…",
      color: "var(--color-accent-light)",
      bg: "rgb(var(--accent-rgb) / 0.1)",
      border: "rgb(var(--accent-rgb) / 0.28)",
      icon: "loading",
    };
  }
  if (state.hasUnsavedChanges) {
    return {
      label: "Saving…",
      color: "var(--color-accent-light)",
      bg: "rgb(var(--accent-rgb) / 0.1)",
      border: "rgb(var(--accent-rgb) / 0.28)",
      icon: "pending",
    };
  }
  return {
    label: "All changes saved",
    color: "var(--color-text-green)",
    bg: "color-mix(in srgb, var(--color-text-green) 8%, transparent)",
    border: "color-mix(in srgb, var(--color-text-green) 24%, transparent)",
    icon: "saved",
  };
}

export type FooterSaveView = {
  color: string;
  dotColor: string;
  label: string;
};

// Footer save indicator — its own compact presentation (shorter labels, different
// colors than the main indicator), but the STATE CLASSIFICATION is driven off the
// same `icon` discriminant `deriveSaveIndicator` returns, so the footer can never
// drift from the tested "never falsely Saved" invariant above.
export function footerSaveView(icon: SaveIndicatorIcon): FooterSaveView {
  if (icon === "error") {
    return {
      color: "var(--color-text-red)",
      dotColor: "var(--color-text-red)",
      label: "Not saved",
    };
  }
  if (icon === "saved") {
    return { color: "var(--color-text-secondary)", dotColor: "var(--verdict-ac)", label: "Saved" };
  }
  // "loading" and "pending" share the footer's in-flight presentation.
  return {
    color: "var(--color-text-yellow)",
    dotColor: "var(--color-text-yellow)",
    label: "Saving…",
  };
}
