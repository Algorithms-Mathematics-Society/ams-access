const formatters = new Map<string, Intl.DateTimeFormat>();
const MAX_FORMATTERS = 32;
let localOffset: number | undefined;
let environment: string | undefined;

/** Re-check on app re-entry/language changes, including zones sharing an offset. */
export function refreshDateTimeFormatEnvironment() {
  const { locale, timeZone } = new Intl.DateTimeFormat().resolvedOptions();
  const next = `${locale}:${timeZone}`;
  if (environment !== undefined && environment !== next) formatters.clear();
  environment = next;
}

if (typeof window !== "undefined") {
  refreshDateTimeFormatEnvironment();
  window.addEventListener("focus", refreshDateTimeFormatEnvironment);
  window.addEventListener("languagechange", refreshDateTimeFormatEnvironment);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshDateTimeFormatEnvironment();
  });
}

/** Reuse expensive Intl objects, with bounded storage for organizer time zones. */
export function dateTimeFormatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  // This cheap read also catches DST/system-offset changes while focused.
  const offset = new Date().getTimezoneOffset();
  if (localOffset !== offset) { formatters.clear(); localOffset = offset; }
  const key = JSON.stringify(Object.entries(options).sort(([a], [b]) => a.localeCompare(b)));
  const existing = formatters.get(key);
  if (existing) return existing;
  const formatter = new Intl.DateTimeFormat(undefined, options);
  if (formatters.size >= MAX_FORMATTERS) formatters.delete(formatters.keys().next().value!);
  formatters.set(key, formatter);
  return formatter;
}
