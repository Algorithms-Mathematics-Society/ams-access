"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { exitToHome } from "@/lib/exit-to-home";
import { stuckScreenStyle } from "./not-found";

// Catches what error.tsx cannot: a crash in the root layout itself. It
// replaces the layout, so it brings its own <html> and <body>.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  const router = useRouter();
  useEffect(() => console.error("[global-error]", error), [error]);
  return (
    <html lang="en">
      <body>
        <main style={stuckScreenStyle}>
          <h1 style={{ fontSize: 20, margin: 0 }}>Something went wrong</h1>
          <p style={{ margin: 0 }}>Going home puts your settings back first.</p>
          <button onClick={() => void exitToHome(router)}>Back to Home</button>
        </main>
      </body>
    </html>
  );
}
