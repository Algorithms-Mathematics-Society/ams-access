/** Scoped styles for responsive composition and the existing sanitized HTML renderer. */
export const CONTEST_STYLES = `
[data-contest-page] { font-family: var(--font-family-body); }
/* Astryx labels are inline, clipped text wrappers. Rail content is a layout,
   so give that wrapper a real box before positioning its status icons. */
[data-contest-page] .contest-question-button > span:first-child > span { display:block; overflow:visible; }
[data-contest-page] .contest-body[data-editor-focus="true"] .contest-problem-pane { width:0 !important; min-width:0 !important; visibility:hidden; overflow:hidden; border:0; }
[data-contest-page] .contest-body[data-editor-focus="true"] .contest-splitter { display:none; }
@media (prefers-reduced-motion: no-preference) {
 [data-contest-page]:not([data-resizing]) .contest-question-rail,
 [data-contest-page]:not([data-resizing]) .contest-problem-pane { transition:width 180ms cubic-bezier(0.22,1,0.36,1), min-width 180ms cubic-bezier(0.22,1,0.36,1); }
 [data-contest-page]:not([data-resizing]) .contest-terminal-panel { transition:height 180ms cubic-bezier(0.22,1,0.36,1), min-height 180ms cubic-bezier(0.22,1,0.36,1); }
}
[data-contest-page] .contest-problem-pane { container-type:inline-size; }
[data-contest-page] .contest-problem-limits > dl { grid-auto-flow:column; grid-auto-columns:minmax(0,1fr); grid-template-columns:none; gap:var(--spacing-3); }
[data-contest-page] .contest-problem-limits dt { font-size:var(--font-size-xs); }
[data-contest-page] .pb-body > :last-child { margin-bottom:0; }
@container (max-width:320px) {
 [data-contest-page] .contest-problem-limits > dl { grid-auto-flow:row; grid-template-columns:1fr; gap:var(--spacing-2); }
 [data-contest-page] .contest-problem-limits .astryx-metadata-list-item { display:grid; grid-template-columns:1fr 1fr; align-items:baseline; gap:var(--spacing-3); }
}
[data-contest-page] .contest-terminal-panel { max-height:55%; }
[data-contest-page] .contest-splitter:hover [data-split-bar] { background: var(--color-text-primary) !important; }
[data-contest-page] .sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
[data-contest-page] .pb-body { color:var(--color-text-secondary); font-size:var(--font-size-base); line-height:var(--text-body-leading,1.65); overflow-wrap:anywhere; }
[data-contest-page] .pb-body p { margin:0 0 var(--spacing-4); }
[data-contest-page] .pb-body h1,[data-contest-page] .pb-body h2,[data-contest-page] .pb-body h3,[data-contest-page] .pb-body h4 { color:var(--color-text-primary); font-family:var(--font-family-heading); font-weight:var(--font-weight-semibold); margin:var(--spacing-6) 0 var(--spacing-3); line-height:var(--text-heading-3-leading,1.3); }
[data-contest-page] .pb-body h1 { font-size:var(--font-size-xl); }
[data-contest-page] .pb-body h2 { font-size:var(--font-size-lg); }
[data-contest-page] .pb-body h3,[data-contest-page] .pb-body h4 { font-size:var(--font-size-base); }
[data-contest-page] .pb-body strong { color:var(--color-text-primary); font-weight:var(--font-weight-semibold); }
[data-contest-page] .pb-body code { font-family:var(--font-family-mono); font-size:var(--font-size-sm); background:var(--color-background-muted); color:var(--color-text-primary); padding:var(--spacing-0-5) var(--spacing-1); border-radius:var(--radius-element); }
[data-contest-page] .pb-body pre { background:var(--color-background-card); border:var(--border-width) solid var(--color-border); border-radius:var(--radius-container); padding:var(--spacing-4); overflow:auto; margin:var(--spacing-3) 0; }
[data-contest-page] .pb-body pre code { background:none; border:none; padding:0; color:var(--color-text-primary); }
[data-contest-page] .pb-sample-block { position:relative; margin:var(--spacing-4) 0; }
[data-contest-page] .pb-sample-block pre { margin:0; padding-top:var(--spacing-10); }
[data-contest-page] .pb-copy-button { position:absolute; top:var(--spacing-2); right:var(--spacing-2); min-height:var(--spacing-6); padding:var(--spacing-1) var(--spacing-2); border-radius:var(--radius-element); border:var(--border-width) solid var(--color-border); background:var(--color-background-muted); color:var(--color-text-primary); font-family:var(--font-family-body); font-size:var(--font-size-xs); cursor:pointer; }
[data-contest-page] .pb-copy-button:hover { background:var(--color-background-muted); }
[data-contest-page] .pb-copy-button:focus-visible { outline:var(--border-width) solid var(--color-text-primary); outline-offset:var(--spacing-0-5); }
[data-contest-page] .pb-body ul,[data-contest-page] .pb-body ol { padding-left:var(--spacing-5); margin:0 0 var(--spacing-4); }
[data-contest-page] .pb-body li { margin-bottom:var(--spacing-1); }
[data-contest-page] .pb-body a { color:var(--color-text-primary); text-decoration:underline; }
[data-contest-page] .pb-body img { max-width:100%; height:auto; border-radius:var(--radius-element); margin:var(--spacing-2) 0; }
[data-contest-page] .pb-body blockquote { border-left:var(--spacing-1) solid var(--color-border-emphasized); margin:var(--spacing-3) 0; padding:var(--spacing-1) var(--spacing-4); }
[data-contest-page] .pb-body hr { border:0; border-top:var(--border-width) solid var(--color-border); margin:var(--spacing-4) 0; }
[data-contest-page] .pb-body table { display:block; overflow-x:auto; border-collapse:collapse; max-width:100%; margin:var(--spacing-3) 0; font-size:var(--font-size-sm); }
[data-contest-page] .pb-body th,[data-contest-page] .pb-body td { border:var(--border-width) solid var(--color-border); padding:var(--spacing-2) var(--spacing-3); text-align:left; }
[data-contest-page] .pb-body th { background:var(--color-background-card); color:var(--color-text-primary); font-weight:var(--font-weight-semibold); }
[data-contest-page] .pb-body .katex { color:var(--color-text-primary); }
[data-contest-page] .pb-body .katex-display { margin:var(--spacing-3) 0; overflow-x:auto; overflow-y:hidden; padding:var(--spacing-0-5) 0; }
[data-contest-page] .pb-body .pb-math-error { color:var(--color-text-red); background:var(--color-background-red); }
@media(max-width:1000px) {
 [data-contest-page] .contest-body[data-editor-focus="true"] .contest-problem-pane { display:none; }
 [data-contest-page] .contest-topbar { flex-wrap:wrap; gap:var(--spacing-3); padding:var(--spacing-3) var(--spacing-4); }
 [data-contest-page] .contest-topbar-actions { flex:none !important; }
 [data-contest-page] .contest-footer { flex-wrap:wrap; gap:var(--spacing-2); padding:var(--spacing-3) var(--spacing-4); }
 [data-contest-page] .contest-footer-statuses { flex-wrap:wrap; gap:var(--spacing-2) var(--spacing-3); }
 [data-contest-page] .contest-footer-summary { white-space:normal; }
 [data-contest-page] .contest-question-rail nav { padding-bottom:var(--spacing-2) !important; }

 [data-contest-page] .contest-body { flex-direction:column; overflow-y:auto !important; }
 [data-contest-page] .contest-question-rail { width:100% !important; min-width:0 !important; max-height:calc(var(--spacing-10) * 6); flex-shrink:0; padding-bottom:0 !important; }
 [data-contest-page] .contest-problem-pane { width:100% !important; min-width:0 !important; flex:none !important; min-height:calc(var(--spacing-10) * 8); max-height:none; max-width:none !important; overflow:visible; }
 [data-contest-page] .contest-splitter { display:none; }
 [data-contest-page] .contest-editor-output { flex:none !important; width:100%; height:calc(var(--spacing-10) * 19); min-height:calc(var(--spacing-10) * 15) !important; border-top:var(--border-width) solid var(--color-border); }
 [data-contest-page] .contest-camera-tile { position:relative !important; flex-shrink:0; align-self:flex-start; margin:var(--spacing-4); }
}
@media(max-width:600px) {
 [data-contest-page] .contest-topbar > :first-child { flex-basis:100% !important; }
 [data-contest-page] .contest-topbar-actions { margin-left:auto; flex-wrap:wrap; max-width:100%; gap:var(--spacing-1); }
 [data-contest-page] .contest-countdown-label { display:none; }
}
`;
