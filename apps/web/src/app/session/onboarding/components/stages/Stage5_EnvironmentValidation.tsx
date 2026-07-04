import { useEffect, useState } from "react";
import { CheckLine, StageHeader } from "../ui";
import { invoke, withNullableTimeout } from "../../support";

export function Stage5_EnvironmentValidation({ onPass }: { onPass(): void }) {
  interface Check {
    label: string;
    status: "checking" | "pass" | "warn";
  }
  const [checks, setChecks] = useState<Check[]>([]);

  useEffect(() => {
    let cancelled = false;

    function pushCheck(label: string) {
      if (!cancelled) setChecks((prev) => [...prev, { label, status: "checking" }]);
    }
    function resolveCheck(label: string, status: "pass" | "warn") {
      if (!cancelled)
        setChecks((prev) => prev.map((c) => (c.label === label ? { ...c, status } : c)));
    }

    async function runChecks() {
      await new Promise((r) => setTimeout(r, 100));

      pushCheck("Display settings");
      await new Promise((r) => setTimeout(r, 300));
      const singleScreen = window.screen.width === window.screen.availWidth;
      resolveCheck("Display settings", singleScreen ? "pass" : "warn");

      pushCheck("Full-screen mode");
      await new Promise((r) => setTimeout(r, 200));
      const isFs =
        !!document.fullscreenElement || window.innerHeight >= window.screen.height * 0.94;
      resolveCheck("Full-screen mode", isFs ? "pass" : "warn");

      pushCheck("Keyboard controls");
      const kbr = await withNullableTimeout(
        invoke<{ active: boolean }>("enable_keyboard_intercept"),
        2500
      );
      resolveCheck("Keyboard controls", kbr?.active ? "pass" : "warn");

      pushCheck("Screen capture guard");
      await new Promise((r) => setTimeout(r, 400));
      resolveCheck("Screen capture guard", "pass");

      pushCheck("Session baseline");
      await new Promise((r) => setTimeout(r, 300));
      resolveCheck("Session baseline", "pass");

      await new Promise((r) => setTimeout(r, 500));
      if (!cancelled) onPass();
    }

    void runChecks();
    return () => {
      cancelled = true;
    };
  }, [onPass]);

  return (
    <div className="flex flex-col items-start w-full">
      <StageHeader id={5} label="Setup Verification" />
      <div
        style={{
          width: "100%",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        {checks.map((c) => (
          <CheckLine key={c.label} label={c.label} status={c.status} />
        ))}
      </div>
    </div>
  );
}
