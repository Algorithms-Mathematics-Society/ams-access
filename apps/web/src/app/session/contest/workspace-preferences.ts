export const DEFAULT_PROBLEM_WIDTH = 35;
export const DEFAULT_OUTPUT_HEIGHT = 34;
export function boundedPercent(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}
export function parseQuestionMarks(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))] : [];
  } catch { return []; }
}
