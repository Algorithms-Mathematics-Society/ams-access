import { useEffect, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { PanelsTopLeft } from "lucide-react";

export function WorkspaceControls({
  focused,
  onFocus,
  onReset,
  onNavigate,
  suspended,
}: {
  suspended: boolean;
  focused: boolean;
  onFocus: () => void;
  onReset: () => void;
  onNavigate: (region: "problem" | "code" | "output") => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (suspended) setOpen(false);
  }, [suspended]);
  useEffect(() => {
    if (!open || suspended) return;
    const pointer = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    const resized = () => setOpen(false);
    window.addEventListener("resize", resized);
    window.addEventListener("focusin", pointer);
    window.addEventListener("pointerdown", pointer);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("resize", resized);
      window.removeEventListener("focusin", pointer);
      window.removeEventListener("pointerdown", pointer);
      window.removeEventListener("keydown", key, true);
    };
  }, [open, suspended]);
  const action = (fn: () => void) => {
    setOpen(false);
    trigger.current?.focus();
    fn();
  };
  return (
    <VStack ref={root} gap={0} style={{ position: "relative" }}>
      <Button
        ref={trigger}
        label="Workspace"
        variant="ghost"
        icon={<PanelsTopLeft size={16} />}
        aria-expanded={open}
        aria-controls="workspace-controls"
        onClick={() => setOpen((value) => !value)}
      />
      {open && !suspended && (
        <Card
          id="workspace-controls"
          padding={3}
          role="group"
          aria-label="Workspace controls"
          style={{
            position: "fixed",
            top: `calc(${trigger.current?.getBoundingClientRect().bottom ?? 0}px + var(--spacing-2))`,
            left: `clamp(var(--spacing-4), ${trigger.current?.getBoundingClientRect().left ?? 0}px, calc(100vw - var(--spacing-10) * 6 - var(--spacing-4)))`,
            maxHeight: `calc(100dvh - ${trigger.current?.getBoundingClientRect().bottom ?? 0}px - var(--spacing-6))`,
            overflowY: "auto",
            zIndex: 30,
            width: "calc(var(--spacing-10) * 6)",
            maxWidth: "calc(100vw - var(--spacing-8))",
            border: "var(--border-width) solid var(--color-border)",
          }}
        >
          <VStack gap={1}>
            <Text type="label">Workspace</Text>
            <Button
              label={focused ? "Restore workspace" : "Focus editor"}
              variant="ghost"
              onClick={() => action(onFocus)}
            />
            <Button
              label="Go to problem"
              variant="ghost"
              onClick={() => action(() => onNavigate("problem"))}
            />
            <Button
              label="Go to code"
              variant="ghost"
              onClick={() => action(() => onNavigate("code"))}
            />
            <Button
              label="Go to output"
              variant="ghost"
              onClick={() => action(() => onNavigate("output"))}
            />
            <Button label="Reset layout" variant="secondary" onClick={() => action(onReset)} />
          </VStack>
        </Card>
      )}
    </VStack>
  );
}
