/**
 * NV-AUTHORITY-BODY-DETECT-001 — locatable authority detection aligned with
 * counsel-grade harness (`scripts/_nv-counsel-grade-assertions.ts`).
 */

const REPORTER_SERIES = [
  'SCC OnLine', 'SCC', 'SCR', 'AIR', 'SCALE', 'JT', 'Supp SCC',
  'Cri LJ', 'CriLJ', 'Crl LJ', 'MLJ', 'Mad LJ', 'BomCR', 'Bom CR', 'DLT', 'PLR',
  'KLT', 'KHC', 'ITR', 'Comp Cas', 'CTR', 'STC', 'LLJ', 'FLR', 'ALL ER', 'WLR',
];
const COURT_TOKENS = 'SC|SCW|INSC|UKSC|EWCA|EWHC|Bom|Del|Mad|Cal|All|Ker|Kar|Guj|Pat|Ori|Raj|MP|AP|TS|P&H|Gau|HP|J&K|Jhar|Chh|Utt|Sikk|Mani|Megh|Tri|NOC';

const REPORTER_PATTERNS: readonly RegExp[] = [
  new RegExp(
    `[(\\[]\\s*((?:1[89]|20)\\d{2})\\s*[)\\]]\\s*(\\d{1,3})\\s+(${REPORTER_SERIES.join('|')})\\s+(\\d{1,5})`,
    'gi',
  ),
  new RegExp(`\\bAIR\\s+((?:1[89]|20)\\d{2})\\s+(${COURT_TOKENS})\\s+(\\d{1,5})\\b`, 'gi'),
  /\b((?:19|20)\d{2})\s+SCC\s+OnLine\s+[A-Za-z&]{2,6}\s+(\d{1,5})\b/gi,
  /\b((?:19|20)\d{2})\s+INSC\s+(\d{1,5})\b/gi,
  /\[((?:19|20)\d{2})\]\s+(UKSC|UKHL|EWCA\s+(?:Civ|Crim)|EWHC)\s+(\d{1,5})\b/gi,
  /\b(\d{1,3})\s+U\.\s?S\.\s+(\d{1,4})\b/g,
];

const CASE_NAME_PATTERN =
  /\b([A-Z][\w.&''\-]*(?:[ \t]+(?:of|and|the|&|v\/s)?[ \t]*[A-Z][\w.&''\-]*){0,6})[ \t]+(?:v\.?|vs\.?|versus)[ \t]+([A-Z][\w.&''\-]*(?:[ \t]+(?:of|and|the|&)?[ \t]*[A-Z(][\w.&''\-)]*){0,6})/g;

const GENERIC_PARTY = new Set([
  'petitioner', 'petitioners', 'respondent', 'respondents', 'applicant', 'applicants',
  'appellant', 'appellants', 'plaintiff', 'plaintiffs', 'defendant', 'defendants',
  'accused', 'complainant', 'claimant', 'deponent', 'party', 'partya', 'partyb',
  'the state', 'state', 'union of india', 'anr', 'ors', 'others', 'another',
  'x', 'y', 'a', 'b', 'name', 'company', 'employer', 'employee',
]);

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v.replace(/\s+/g, ' ').trim());
  }
  return out;
}

function matchAll(body: string, patterns: readonly RegExp[]): string[] {
  const out: string[] = [];
  for (const p of patterns) {
    for (const m of body.matchAll(new RegExp(p.source, p.flags.includes('g') ? p.flags : `${p.flags}g`))) {
      out.push(m[0]);
    }
  }
  return out;
}

function normaliseParty(side: string): string {
  return side
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\b(anr|ors|others|another|etc|and)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isGenericParty(side: string): boolean {
  const n = normaliseParty(side);
  if (!n) return true;
  if (GENERIC_PARTY.has(n)) return true;
  return n.split(' ').every((t) => GENERIC_PARTY.has(t));
}

function isPlaceholderWrapped(text: string, at: number, len: number): boolean {
  const before = text.slice(Math.max(0, at - 12), at);
  const after = text.slice(at + len, at + len + 12);
  return /\[\[[^\]]{0,10}$/.test(before) && /^[^[]{0,10}\]\]/.test(after);
}

/** Reporter-style citations found in the body. */
export function detectReporterCitations(body: string): string[] {
  return dedupe(matchAll(String(body || ''), REPORTER_PATTERNS));
}

/** Party pairs with a locating citation/year/court within `window` chars. */
export function detectCitedCaseNames(body: string, window = 90): string[] {
  const text = String(body || '');
  const cited: string[] = [];
  const locator = new RegExp(
    `(?:[(\\[]?(?:1[89]|20)\\d{2}[)\\]]?|${REPORTER_SERIES.join('|')}|Supreme\\s+Court`
    + '|High\\s+Court|CNR\\s+[A-Z0-9]{8,})',
    'i',
  );

  for (const m of text.matchAll(CASE_NAME_PATTERN)) {
    const [full, left, right] = m;
    if (isGenericParty(left) && isGenericParty(right)) continue;
    if (/\[[^\]]*\]/.test(full)) continue;
    const at = m.index ?? 0;
    if (isPlaceholderWrapped(text, at, full.length)) continue;
    const near = text.slice(Math.max(0, at - window), at + full.length + window);
    if (locator.test(near.replace(full, ' '))) cited.push(full);
  }
  return dedupe(cited);
}

/** Count locatable authorities (reporter cite or named+located pair). */
export function countLocatableAuthorities(body: string): number {
  return dedupe([...detectReporterCitations(body), ...detectCitedCaseNames(body)]).length;
}
