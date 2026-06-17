import type { CSSProperties } from "react";
import { verdictColor, verdictLabel, verdictShort, type VerdictCode } from "./verdict";

// NOTE: `color` here must be a full CSS color (e.g. `var(--verdict-ac)`), NOT a bare token name
// like `"--verdict-ac"` — do not copy-paste with the tint() helper in client.tsx which takes the token alone.
const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

type Props = { code: VerdictCode; variant?: "full" | "chip"; style?: CSSProperties };

// Single rendering of a judge verdict — color + name from lib/verdict.ts so the
// exam screen and results page can never drift. Never throws on unknown codes.
export function VerdictBadge({ code, variant = "full", style }: Props) {
  const color = verdictColor(code);
  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: variant === "full" ? "6px" : "0",
    fontFamily: "Inter, system-ui, sans-serif",
    fontWeight: 600,
    lineHeight: 1,
    color,
    background: tint(color, 12),
    border: `1px solid ${tint(color, 35)}`,
    borderRadius: "5px",
    whiteSpace: "nowrap",
    ...style,
  };
  if (variant === "chip") {
    return (
      <span
        style={{ ...base, fontSize: "10px", padding: "2px 6px", letterSpacing: "0.02em" }}
        title={verdictLabel(code)}
      >
        {verdictShort(code)}
      </span>
    );
  }
  return (
    <span style={{ ...base, fontSize: "11px", padding: "3px 9px" }}>
      <span style={{ opacity: 0.85, letterSpacing: "0.02em" }}>{verdictShort(code)}</span>
      <span style={{ opacity: 0.55 }}>·</span>
      <span>{verdictLabel(code)}</span>
    </span>
  );
}
