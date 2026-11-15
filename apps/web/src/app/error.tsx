"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { exitToHome } from "@/lib/exit-to-home";
import { stuckScreenStyle } from "./not-found";

// Any screen that throws lands here, possibly mid-setup with the window
// still locked down, so the way out restores settings on the way home.
export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  useEffect(() => console.error("[app-error]", error), [error]);
  return (
    <main style={stuckScreenStyle}>
      <h1 style={{ fontSize: 20, margin: 0 }}>Something went wrong</h1>
      <p style={{ margin: 0, color: "var(--text-soft)" }}>
        Try again, or go back home. Going home puts your settings back first.
      </p>
      <Button label="Try again" variant="primary" onClick={reset} />
      <Button label="Back to Home" variant="secondary" onClick={() => void exitToHome(router)} />
    </main>
  );
}
