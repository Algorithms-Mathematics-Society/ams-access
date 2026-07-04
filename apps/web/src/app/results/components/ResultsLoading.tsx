import { RouteLoadingShell } from "@/components/RouteLoadingShell";

// Shared loading screen — used both as the data-fetch placeholder and as the
// Suspense fallback for useSearchParams(), so the UI is identical in both cases.
export function ResultsLoading() {
  return <RouteLoadingShell variant="results" label="Loading results…" />;
}
