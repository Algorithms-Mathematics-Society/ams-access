import { type useRouter } from "next/navigation";

export interface ErrorScreenProps {
  error: string;
  fetchResults: () => Promise<void>;
  router: ReturnType<typeof useRouter>;
}

export function ErrorScreen({ error, fetchResults, router }: ErrorScreenProps) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--surface-0)",
        color: "var(--theme-text)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          animation: "slideDown var(--transition-slow) both",
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
            stroke="currentColor"
            style={{ color: "var(--theme-error-text)" }}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span style={{ fontSize: 15, color: "var(--theme-error-text)" }}>{error}</span>
      </div>
      <button onClick={() => void fetchResults()} className="results-btn results-btn-primary">
        Retry
      </button>
      <button onClick={() => router.push("/home")} className="results-btn results-btn-ghost">
        Back to Home
      </button>
    </div>
  );
}
