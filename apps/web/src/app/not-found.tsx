"use client";

import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { exitToHome } from "@/lib/exit-to-home";

// Shared with error.tsx. Plain markup keeps both inside the screen size budget.
export const stuckScreenStyle: CSSProperties = {
  minHeight: "100vh",
  background: "var(--surface-0)",
  color: "var(--theme-text)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 16,
  padding: 24,
  textAlign: "center",
  fontFamily: "system-ui, sans-serif",
};

export default function NotFound() {
  const router = useRouter();
  return (
    <main style={stuckScreenStyle}>
      <h1 style={{ fontSize: 20, margin: 0 }}>Page not found</h1>
      <p style={{ margin: 0, color: "var(--text-soft)" }}>
        This screen does not exist. Going home puts your settings back first.
      </p>
      <button onClick={() => void exitToHome(router)} className="results-btn results-btn-primary">
        Back to Home
      </button>
    </main>
  );
}
