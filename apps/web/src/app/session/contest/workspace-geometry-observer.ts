/** Observe layout elements, not CodeMirror's text-node churn. */
export function observeWorkspaceGeometry(container: Element, measure: () => void): () => void {
  const resize = new ResizeObserver(measure);
  resize.observe(container);
  let targets = new Set<Element>();
  const reconcile = () => {
    const next = new Set<Element>();
    for (const selector of ['[aria-label="Code editor"]', '.cm-editor', '.contest-terminal-panel']) {
      const element = container.querySelector(selector);
      if (element && element !== container) next.add(element);
    }
    let changed = false;
    for (const element of targets) {
      if (!next.has(element)) { resize.unobserve(element); changed = true; }
    }
    for (const element of next) {
      if (!targets.has(element)) { resize.observe(element); changed = true; }
    }
    targets = next;
    if (changed) measure();
  };
  reconcile();
  const mutation = new MutationObserver(reconcile);
  mutation.observe(container, { childList: true, subtree: true });
  measure();
  return () => { mutation.disconnect(); resize.disconnect(); targets.clear(); };
}
