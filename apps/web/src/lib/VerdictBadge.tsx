import type { CSSProperties } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Circle,
  Clock,
  HardDrive,
  Loader2,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  isTerminalVerdict,
  verdictColor,
  verdictLabel,
  verdictShort,
  type VerdictCode,
} from "./verdict";

// NOTE: `color` here must be a full CSS color (e.g. `var(--verdict-ac)`), NOT a bare token name
// like `"--verdict-ac"` — do not copy-paste with the tint() helper in client.tsx which takes the token alone.
const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

// A shape per verdict so the badge never relies on colour alone (~8% of male
// candidates are red/green colourblind; AC-green vs WA-red is the worst case).
function verdictIcon(v: VerdictCode): LucideIcon {
  switch (v) {
    case "AC":
      return Check;
    case "WA":
      return X;
    case "TLE":
      return Clock;
    case "MLE":
    case "OLE":
      return HardDrive;
    case "RE":
      return Zap;
    case "CE":
      return AlertTriangle;
    case "IE":
      return AlertCircle;
    case "RUNNING":
    case "QUEUED":
      return Loader2;
    default:
      return Circle;
  }
}

type Props = {
  code: VerdictCode;
  variant?: "full" | "chip";
  style?: CSSProperties;
  // The verdict moment (§6.6): when true and the verdict is terminal, play a
  // one-shot scale + glow on mount (AC gets a gentler celebratory pulse). Pass a
  // changing React `key` so it re-fires each time the verdict resolves anew.
  reveal?: boolean;
};

// Single rendering of a judge verdict — color + name from lib/verdict.ts so the
// exam screen and results page can never drift. Never throws on unknown codes.
export function VerdictBadge({ code, variant = "full", style, reveal = false }: Props) {
  const color = verdictColor(code);
  const Icon = verdictIcon(code);
  const label = verdictLabel(code);
  const pending = code === "RUNNING" || code === "QUEUED";
  const revealAnim =
    reveal && isTerminalVerdict(code)
      ? `${code === "AC" ? "verdict-reveal-ac" : "verdict-reveal"} 300ms cubic-bezier(0.22,1,0.36,1)`
      : undefined;
  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    fontFamily: "Inter, system-ui, sans-serif",
    fontWeight: 600,
    lineHeight: 1,
    color,
    background: tint(color, 12),
    border: `1px solid ${tint(color, 35)}`,
    borderRadius: "var(--radius-sm)",
    whiteSpace: "nowrap",
    animation: revealAnim,
    ...style,
  };
  const iconStyle: CSSProperties | undefined = pending
    ? { animation: "spin 0.8s linear infinite" }
    : undefined;
  if (variant === "chip") {
    return (
      <span
        role="img"
        aria-label={label}
        style={{ ...base, fontSize: "10px", padding: "2px 6px", letterSpacing: "0.02em" }}
        title={label}
      >
        <Icon size={11} strokeWidth={2.5} aria-hidden="true" style={iconStyle} />
        {verdictShort(code)}
      </span>
    );
  }
  return (
    <span
      role="img"
      aria-label={label}
      style={{ ...base, gap: "6px", fontSize: "11px", padding: "3px 9px" }}
    >
      <Icon size={12} strokeWidth={2.5} aria-hidden="true" style={iconStyle} />
      <span style={{ opacity: 0.85, letterSpacing: "0.02em" }}>{verdictShort(code)}</span>
      <span style={{ opacity: 0.55 }}>·</span>
      <span>{label}</span>
    </span>
  );
}
