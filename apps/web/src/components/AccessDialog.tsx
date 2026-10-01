"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";

/** Shared native dialog shell. Business state and actions remain with callers. */
export function AccessDialog({ open, onClose, title, subtitle, width, children, labelId }: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  width: string;
  children: ReactNode;
  labelId: string;
}) {
  const openerRef = useRef<HTMLElement | null>(null);
  // Keep the original opener through React StrictMode's effect replay.
  // Astryx restores on isOpen=false; app callers may unmount the dialog instead.
  useLayoutEffect(() => {
    if (!open) { openerRef.current = null; return; }
    if (!openerRef.current && document.activeElement instanceof HTMLElement) {
      openerRef.current = document.activeElement;
    }
    const opener = openerRef.current;
    const dialog = document.querySelector<HTMLDialogElement>(`[data-dialog-id="${labelId}"]`);
    return () => {
      queueMicrotask(() => {
        if (dialog?.isConnected && dialog.open) return;
        if (opener?.isConnected) opener.focus({ preventScroll: true });
      });
    };
  }, [open, labelId]);

  return (
    <Dialog isOpen={open} onOpenChange={(next) => { if (!next) onClose(); }}
      purpose="form" padding={6} width={width} maxHeight="calc(100dvh - var(--spacing-8))"
      aria-label={title} data-dialog-id={labelId} style={{ borderColor: "var(--color-border)" }}>
      <Layout
        header={<DialogHeader id={labelId} title={title} subtitle={subtitle}
          onOpenChange={(next) => { if (!next) onClose(); }} hasDivider />}
        content={<LayoutContent padding={6}>{children}</LayoutContent>}
      />
    </Dialog>
  );
}
