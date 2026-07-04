// Shared loading screen — used both as the data-fetch placeholder and as the
// Suspense fallback for useSearchParams(), so the UI is identical in both cases.
export function ResultsLoading() {
  return (
    <main className="route-loading-shell route-loading-shell--results">
      <svg className="route-loading-spinner" viewBox="0 0 30 30" fill="none" aria-hidden="true">
        <circle
          cx="15"
          cy="15"
          r="12.5"
          stroke="currentColor"
          strokeOpacity="0.2"
          strokeWidth="2.5"
        />
        <path
          d="M15 2.5 A12.5 12.5 0 0 1 27.5 15"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
      <div className="route-loading-label">Loading results…</div>
    </main>
  );
}
