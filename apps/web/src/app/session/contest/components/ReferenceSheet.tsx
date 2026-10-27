import { memo, useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { ContestOverlay } from "./ContestOverlay";
import { CountdownBadge } from "./CountdownBadge";
import { contestTimestamp } from "../contest-information";
import type { ReferenceSheet } from "../reference-sheet";
import type { ClockSnapshot } from "../session-clock";

/** Local state keeps opening/scrolling independent of the editor and autosave.
 * The parent keys this component by contest; content is already in memory. */
export const ReferenceSheetButton = memo(function ReferenceSheetButton({
  sheet,
  suspended,
  clock,
}: {
  sheet: ReferenceSheet;
  suspended: boolean;
  clock: ClockSnapshot;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollTop = useRef(0);
  const latest = useRef({ open, suspended });
  latest.current = { open, suspended };
  const active = open && !suspended;

  useEffect(() => {
    if (suspended) setOpen(false);
  }, [suspended]);

  useEffect(() => {
    if (!active) return;
    const root = rootRef.current;
    const body = bodyRef.current;
    if (!root) return;
    if (body) body.scrollTop = scrollTop.current;
    // Keep the workspace mounted (draft/selection/scroll remain owned by it),
    // but remove background controls from keyboard and accessibility navigation.
    // Existing mandatory dialogs are deliberately excluded from isolation.
    // Move focus before hiding its previous ancestor from assistive technology.
    const closeButton = root.querySelector<HTMLElement>("[data-reference-close]");
    closeButton?.focus({ preventScroll: true });
    const restoreIsolation: Array<() => void> = [];
    let branch = root.parentElement;
    while (branch?.parentElement && !branch.matches("[data-contest-page]")) {
      for (const sibling of Array.from(branch.parentElement.children)) {
        if (
          sibling !== branch &&
          sibling instanceof HTMLElement &&
          !sibling.inert &&
          !sibling.matches('[role="dialog"], [role="alertdialog"]')
        ) {
          if (typeof sibling.inert === "boolean") {
            sibling.inert = true;
            restoreIsolation.push(() => {
              sibling.inert = false;
            });
          } else {
            // Earlier supported WKWebView engines lack inert. The focus trap
            // handles keyboard navigation; hide background accessibility nodes
            // separately, preserving each caller's exact original attribute.
            const previous = sibling.getAttribute("aria-hidden");
            sibling.setAttribute("aria-hidden", "true");
            restoreIsolation.push(() => {
              if (previous === null) sibling.removeAttribute("aria-hidden");
              else sibling.setAttribute("aria-hidden", previous);
            });
          }
        }
      }
      branch = branch.parentElement;
    }
    const focusable = () =>
      Array.from(
        root.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex]:not([tabindex="-1"])')
      ).filter((item) => item.getClientRects().length > 0);
    const key = (event: KeyboardEvent) => {
      if (latest.current.suspended) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      } else if (event.key === "Tab") {
        const items = focusable();
        const first = items[0] ?? root;
        const last = items[items.length - 1] ?? root;
        if (!root.contains(document.activeElement)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus({ preventScroll: true });
        } else if (
          event.shiftKey &&
          (document.activeElement === first || document.activeElement === root)
        ) {
          event.preventDefault();
          last.focus({ preventScroll: true });
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus({ preventScroll: true });
        }
      }
    };
    const focus = (event: FocusEvent) => {
      if (!latest.current.suspended && !root.contains(event.target as Node)) {
        closeButton?.focus({ preventScroll: true });
      }
    };
    // Match the existing finish review: native lockdown intercepts Escape at
    // window capture, so a document listener alone never receives it.
    window.addEventListener("keydown", key, true);
    window.addEventListener("focusin", focus);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("focusin", focus);
      if (body) scrollTop.current = body.scrollTop;
      for (const restore of restoreIsolation) restore();
      // Mandatory overlays own focus immediately, including during teardown.
      if (!latest.current.open && !latest.current.suspended) {
        triggerRef.current?.focus({ preventScroll: true });
      }
    };
  }, [active]);

  return (
    <>
      <Button
        ref={triggerRef}
        label="Reference"
        variant="ghost"
        icon={<FileText size={16} aria-hidden="true" />}
        aria-haspopup="dialog"
        aria-expanded={active}
        isDisabled={suspended}
        onClick={() => setOpen(true)}
      />
      {active && (
        <ContestOverlay
          labelId="contest-reference-title"
          dialogRef={rootRef}
          contentClassName="contest-reference-sheet"
          wide
        >
          <HStack gap={3} justify="between" align="center">
            <Text type="supporting" color="secondary" style={{ minWidth: 0 }}>
              Contest reference · Read only
            </Text>
            <Button
              data-reference-close
              label="Close"
              variant="secondary"
              onClick={() => setOpen(false)}
            />
          </HStack>
          <VStack
            ref={bodyRef}
            tabIndex={0}
            role="region"
            aria-label="Reference content"
            gap={3}
            style={{ minHeight: 0, overflowY: "auto", overscrollBehavior: "contain" }}
          >
            <Heading
              id="contest-reference-title"
              level={3}
              accessibilityLevel={2}
              style={{ overflowWrap: "anywhere", flexShrink: 0 }}
            >
              {sheet.title}
            </Heading>
            <Text as="p" style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {sheet.body}
            </Text>
          </VStack>
          <HStack gap={3} justify="between" align="center" wrap="wrap">
            <Text type="supporting" color="secondary">
              Published version {sheet.revision} · {contestTimestamp(sheet.published_at)}
            </Text>
            <CountdownBadge clock={clock} />
          </HStack>
        </ContestOverlay>
      )}
    </>
  );
});
