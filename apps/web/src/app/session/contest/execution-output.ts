/** Public sample output only; hidden indicators always take precedence. */
export function isPublicSample(row: {hidden?: boolean | null; is_hidden?: boolean | null; is_sample?: boolean | null; sample?: boolean | null; kind?: string}): boolean {
  if (row.hidden || row.is_hidden || row.is_sample === false || row.sample === false) return false;
  if (row.kind && row.kind !== 'sample') return false;
  return true; // Existing legacy rows lack kind/sample flags.
}
export function outputText(value: unknown): string {
  if (value == null) return 'Not provided by the judge';
  const text = String(value);
  return text === '' ? '(empty output)' : text;
}
