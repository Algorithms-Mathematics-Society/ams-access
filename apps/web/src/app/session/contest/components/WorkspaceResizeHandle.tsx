import { observeWorkspaceGeometry } from "../workspace-geometry-observer";
import { useCallback, useEffect, useRef, useState } from 'react';
import { ResizeHandle, useResizable } from '@astryxdesign/core/Resizable';

/** Keep persisted proportions responsive while Astryx owns pointer/keyboard drag. */
export function WorkspaceResizeHandle({ direction, value, min, max, onChange, label, className, containerSelector, reversed = false }: {
  direction: 'horizontal' | 'vertical'; value: number; min: number; max: number;
  onChange: (value: number) => void; label: string; className?: string;
  containerSelector: string; reversed?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [{ extent, outputFloor, outputCeiling }, setGeometry] = useState({ extent: 1000, outputFloor: 0, outputCeiling: Infinity });
  const callbackRef = useRef(onChange); callbackRef.current = onChange;
  useEffect(() => {
    const container = ref.current?.closest(containerSelector);
    if (!container) return;
    const measure = () => {
      const rect = container.getBoundingClientRect();
      const next = direction === 'horizontal' ? rect.width : rect.height;
      const editor = container.querySelector('[aria-label="Code editor"]');
      const code = container.querySelector('.cm-editor');
      // Reserve three spacing-10 units of code, in addition to the editor's
      // measured toolbars and notices. Output can never consume that space.
      const minimumCode = parseFloat(getComputedStyle(container).getPropertyValue('--spacing-10')) * 3 || 120;
      const chrome = editor && code ? Math.max(0, editor.getBoundingClientRect().height - code.getBoundingClientRect().height) : 0;
      const output = container.querySelector('.contest-terminal-panel');
      const floor = direction === 'vertical' && output ? parseFloat(getComputedStyle(output).minHeight) || 0 : 0;
      const ceiling = direction === 'vertical' && code ? Math.max(minimumCode, next - chrome - minimumCode - (ref.current?.getBoundingClientRect().height ?? 0)) : Infinity;
      if (next > 0) setGeometry(previous => previous.extent === next && previous.outputFloor === floor && (previous.outputCeiling === ceiling || Math.abs(previous.outputCeiling - ceiling) < 0.5) ? previous : { extent: next, outputFloor: floor, outputCeiling: ceiling });
    };
    // Toolbar/banner sizes are observed directly; text edits do not trigger
    // synchronous measurements, and replaced editors are explicitly released.
    return observeWorkspaceGeometry(container, measure);
  }, [containerSelector, direction]);
  const effectiveMax = Math.min(max, outputCeiling / extent * 100);
  const effectiveMin = Math.min(Math.max(min, outputFloor / extent * 100), effectiveMax);
  const changed = useCallback((pixels: number) => callbackRef.current(Math.min(effectiveMax, Math.max(effectiveMin, pixels / extent * 100))), [extent, effectiveMin, effectiveMax]);
  const region = useResizable({ defaultSize: 300, minSizePx: extent * effectiveMin / 100, maxSizePx: extent * effectiveMax / 100, onSizeChange: changed });
  useEffect(() => {
    const bounded = Math.min(effectiveMax, Math.max(effectiveMin, value));
    if (Math.abs(bounded - value) > 0.01) callbackRef.current(bounded);
    const pixels = extent * bounded / 100;
    if (Math.abs(region.size - pixels) > 0.5) region.resize(pixels);
  }, [value, extent, effectiveMin, effectiveMax, region.size, region.resize]);
  return <ResizeHandle ref={ref} className={className} direction={direction} resizable={region.props} isReversed={reversed} label={label} aria-valuetext={`${Math.round(value)} percent`} hasDivider pillPlacement="center" />;
}
