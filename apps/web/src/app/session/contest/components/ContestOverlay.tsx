import type { ReactNode, RefObject } from "react";
import { VStack } from "@astryxdesign/core/Stack";

/** Keep mandatory proctoring layers above ordinary controls. Existing focus
 * traps and dismissal decisions belong to the caller, not this presentation. */
export function ContestOverlay({ children, labelId, critical = false, dialogRef, wide = false, alert = false }: {
  children: ReactNode; labelId: string; critical?: boolean;
  dialogRef?: RefObject<HTMLDivElement | null>; wide?: boolean; alert?: boolean;
}) {
  return <VStack role={alert ? "alertdialog" : "dialog"} aria-modal="true" aria-labelledby={labelId}
    aria-live={alert ? "assertive" : undefined} align="center" justify="center"
    style={{ position: "fixed", inset: 0, zIndex: critical ? "var(--modal-z-critical)" : "var(--modal-z-overlay)", padding: "var(--spacing-4)", background: "color-mix(in srgb, var(--color-background-body) 92%, transparent)", overflowY: "auto" }}>
    <VStack ref={dialogRef} tabIndex={-1} gap={6} style={{ width: "100%", maxWidth: wide ? "calc(var(--spacing-10) * 20)" : "calc(var(--spacing-10) * 12)", maxHeight: "calc(100dvh - var(--spacing-8))", overflowY: "auto", padding: "clamp(var(--spacing-4), 3vw, var(--spacing-8))", border: "var(--border-width) solid var(--color-border)", borderRadius: "var(--radius-container)", background: "var(--color-background-card)", boxShadow: "var(--shadow-high)", outline: "none" }}>
      {children}
    </VStack>
  </VStack>;
}
