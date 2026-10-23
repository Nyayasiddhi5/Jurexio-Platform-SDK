/**
 * NV-PLATFORM-TEMPORAL-001 — authoritative platform reference date for all AI paths.
 *
 * Models otherwise infer "today" from training cutoff (often 2024/2025) and refuse
 * valid 2026 queries. Every counsel overlay and orchestration path must inject this.
 */

const PLATFORM_TZ = 'Asia/Kolkata';

/** Override for tests only — ISO date or datetime (e.g. 2026-08-20). */
export function getPlatformReferenceDate(): Date {
  const raw = String(process.env.JRX_REFERENCE_DATE ?? '').trim();
  if (raw) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

export function getPlatformReferenceYear(date = getPlatformReferenceDate()): number {
  const parts = new Intl.DateTimeFormat('en-IN', {
    timeZone: PLATFORM_TZ,
    year: 'numeric',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value;
  return y ? Number(y) : date.getUTCFullYear();
}

export function formatPlatformReferenceDate(date = getPlatformReferenceDate()): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: PLATFORM_TZ,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

export function platformReferenceIsoDate(date = getPlatformReferenceDate()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PLATFORM_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${d}`;
}

export function buildPlatformTemporalContextBlock(date = getPlatformReferenceDate()): string {
  const year = getPlatformReferenceYear(date);
  const iso = platformReferenceIsoDate(date);
  const human = formatPlatformReferenceDate(date);
  return `PLATFORM REFERENCE DATE (authoritative — overrides model training cutoff):
- Today: ${human} (${PLATFORM_TZ}).
- ISO date: ${iso}. Current calendar year: ${year}.
- Do NOT treat ${year} as a future year or ask the user to "confirm the year".
- "Till date", "YTD", "this year", and "in ${year}" mean 1 January ${year} through ${iso}.
- For live crime statistics, news, case lists, or counts not present in retrieved corpus, use LIVE WEB SEARCH excerpts when provided; otherwise say official published data may lag — never invent figures.`;
}

/**
 * NV-TOKEN-BUDGET-001 — compact tier temporal block (~45 tok vs ~137 full).
 *
 * The full block is required on research/drafting paths; on `micro_faq` it alone
 * blew the 600-token overlay ceiling once the grounding discipline landed. The
 * compact form keeps the correctness rules (current year, YTD window, no invented
 * live figures) without the verbose heading and bullet scaffolding.
 */
export function buildCompactPlatformTemporalContextBlock(date = getPlatformReferenceDate()): string {
  const year = getPlatformReferenceYear(date);
  const iso = platformReferenceIsoDate(date);
  return `REF DATE: ${iso} (${PLATFORM_TZ}). Calendar year ${year} is current — not future. YTD = 1 Jan ${year} through ${iso}. Use live-search excerpts when supplied; never invent figures.`;
}

/**
 * Auto-enable live web search for current-period factual queries (murders in 2026, etc.).
 */
export function queryNeedsLiveWebData(
  prompt: string,
  date = getPlatformReferenceDate(),
): boolean {
  const q = String(prompt || '').trim();
  if (q.length < 12) return false;
  const year = getPlatformReferenceYear(date);
  const mentionsCurrentPeriod =
    new RegExp(`\\b${year}\\b`).test(q)
    || /\b(till date|year to date|ytd|this year|current year|so far this year)\b/i.test(q);
  const asksLiveFacts =
    /\b(murder|murders|crime|statistic|statistics|number of|how many|count of|list of|cases|case list|news|latest|recent|happened in|registered in|reported in|money laundering|telangana|andhra|nationwide|india-wide|current data|judgment|judgement|order|amendment|notification|gazette|ordinance|legal news|breaking|supreme court today|high court today)\b/i.test(
      q,
    );
  const asksLegalIntel =
    /\b(latest\b[\s\S]{0,40}?\b(case|judgment|judgement|order|amendment|news|notification)\b|recent\s+(case|judgment|judgement|order|amendment|legislation|ruling)|legal\s+news|case\s+search|find\s+case|full\s+details|cnr|high court\b.*\b(recent|latest|2024|2025|2026))\b/i.test(
      q,
    );
  return (mentionsCurrentPeriod && asksLiveFacts) || asksLegalIntel;
}
