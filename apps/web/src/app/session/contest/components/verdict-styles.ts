// Verdict dot/text colour resolves to the canonical --verdict-* tokens so a
// verdict reads identically here, in the trust strip, and on the results page.
// (CE is a distinct violet, not WA-red; RUNNING is blue so purple stays the
// primary-action accent.) The BG/BORDER tints are DERIVED from those same tokens
// via color-mix — re-hueing a verdict in globals.css updates every surface at
// once, with no second hardcoded copy to drift out of sync.
export const VERDICT_COLORS: Record<string, string> = {
  AC: "var(--verdict-ac)",
  WA: "var(--verdict-wa)",
  TLE: "var(--verdict-tle)",
  MLE: "var(--verdict-mle)",
  RE: "var(--verdict-re)",
  CE: "var(--verdict-ce)",
  OLE: "var(--verdict-mle)",
  IE: "var(--verdict-ie)",
  QUEUED: "var(--verdict-running)",
  RUNNING: "var(--verdict-running)",
};
// A verdict hue at `pct`% opacity over the dark surface (equivalent to the old
// rgba(...,pct/100) tints, but sourced from the one canonical token).
export const tint = (token: string, pct: number) =>
  `color-mix(in srgb, var(${token}) ${pct}%, transparent)`;
export const VERDICT_BG: Record<string, string> = {
  AC: tint("--verdict-ac", 10),
  QUEUED: tint("--verdict-running", 10),
  RUNNING: tint("--verdict-running", 10),
  WA: tint("--verdict-wa", 10),
  RE: tint("--verdict-re", 10),
  CE: tint("--verdict-ce", 12),
  IE: tint("--verdict-ie", 12),
  TLE: tint("--verdict-tle", 10),
  MLE: tint("--verdict-mle", 10),
  OLE: tint("--verdict-mle", 10),
};
export const VERDICT_BORDER: Record<string, string> = {
  AC: tint("--verdict-ac", 28),
  QUEUED: tint("--verdict-running", 28),
  RUNNING: tint("--verdict-running", 28),
  WA: tint("--verdict-wa", 28),
  RE: tint("--verdict-re", 28),
  CE: tint("--verdict-ce", 30),
  IE: tint("--verdict-ie", 30),
  TLE: tint("--verdict-tle", 28),
  MLE: tint("--verdict-mle", 28),
  OLE: tint("--verdict-mle", 28),
};
