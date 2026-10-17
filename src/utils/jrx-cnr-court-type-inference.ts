/**
 * NV-CNR-COURT-TYPE-INFER-001 — infer court tier + identifier kind from user input.
 * Used by `/sdk/cnr/resolve` when NSP omits `options.courtType`.
 */

export type NvInferredCourtType = 'sc' | 'hc' | 'dc' | 'unknown';
export type NvIdentifierKind = 'cnr' | 'diary' | 'case_number' | 'ambiguous';

export type NvCourtTypeInference = {
  courtType: NvInferredCourtType;
  kind: NvIdentifierKind;
  normalized?: string;
  confidence: 'high' | 'medium' | 'low';
  notes: string[];
};

const SC_CASE_NUMBER_RE =
  /\b(?:SLP\s*\([^)]+\)|SLP(?:\s*\([^)]+\))?|C\.?\s*A\.?|CRL\.?\s*A\.?|W\.?\s*P\.?\s*\([^)]+\)|W\.?\s*P\.?|T\.?\s*P\.?|T\.?\s*C\.?|R\.?\s*P\.?|CURATIVE|CONTEMPT|ARB\.?\s*P\.?|TRANSFERRED\s+CASE|REVIEW\s+PETITION)\b/i;

const DIARY_SLASH_RE = /^(\d{1,7})\/((?:19|20)\d{2}|\d{2})$/;
const DIARY_INSC_RE = /^((?:19|20)\d{2})\s+INSC\s+(\d{1,6})$/i;

function expandYear(y: string): number {
  const n = Number.parseInt(y, 10);
  if (y.length === 2) return n >= 70 ? 1900 + n : 2000 + n;
  return n;
}

function normalizeCompact(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s\-_.]/g, '');
}

function normalizeDiarySlash(raw: string): string | null {
  const trimmed = raw.trim();
  const m = DIARY_SLASH_RE.exec(trimmed.replace(/\s/g, ''));
  if (!m) return null;
  const num = m[1]!.replace(/^0+/, '') || m[1]!;
  const year = expandYear(m[2]!);
  if (year < 1950 || year > 2100) return null;
  return `${num}/${year}`;
}

function normalizeDiaryCompact(compact: string): string | null {
  if (!/^\d{6,12}$/.test(compact)) return null;
  const year = Number.parseInt(compact.slice(-4), 10);
  if (!Number.isFinite(year) || year < 1950 || year > 2100) return null;
  const numRaw = compact.slice(0, -4);
  const num = numRaw.replace(/^0+/, '') || numRaw;
  if (num.length < 1 || num.length > 7) return null;
  return `${num}/${year}`;
}

function normalizeInscDiary(raw: string): string | null {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  const m = DIARY_INSC_RE.exec(trimmed);
  if (!m) return null;
  const year = Number.parseInt(m[1]!, 10);
  const num = m[2]!.replace(/^0+/, '') || m[2]!;
  if (year < 1950 || year > 2100) return null;
  return `${year} INSC ${num}`;
}

function inferFromDiary(raw: string, compact: string): NvCourtTypeInference | null {
  const slash = normalizeDiarySlash(raw);
  if (slash) {
    return {
      courtType: 'sc',
      kind: 'diary',
      normalized: slash,
      confidence: 'high',
      notes: ['SC diary NNNNN/YYYY — resolve via diaryNumber, not CNR'],
    };
  }

  const insc = normalizeInscDiary(raw);
  if (insc) {
    return {
      courtType: 'sc',
      kind: 'diary',
      normalized: insc,
      confidence: 'high',
      notes: ['SC INSC citation — judgment lookup; not a filing CNR'],
    };
  }

  const compactDiary = normalizeDiaryCompact(compact);
  if (compactDiary) {
    return {
      courtType: 'sc',
      kind: 'diary',
      normalized: compactDiary,
      confidence: 'high',
      notes: ['SC compact diary NNNNNYYYY normalized to slash form'],
    };
  }

  return null;
}

function inferFromCaseNumber(raw: string): NvCourtTypeInference | null {
  const trimmed = raw.trim();
  if (!SC_CASE_NUMBER_RE.test(trimmed)) return null;
  return {
    courtType: 'sc',
    kind: 'case_number',
    normalized: trimmed.replace(/\s+/g, ' '),
    confidence: 'high',
    notes: [
      'SC formal case number — resolve with diaryNumber when available; case_no alone may not index',
    ],
  };
}

function inferFromCnr(compact: string): NvCourtTypeInference | null {
  if (!/^[A-Z0-9]{10,20}$/.test(compact)) return null;

  if (compact.startsWith('ESCR')) {
    return {
      courtType: 'sc',
      kind: 'cnr',
      normalized: compact,
      confidence: 'high',
      notes: ['SC judgment corpus CNR (ESCR prefix) — not standard 16-char eCourts layout'],
    };
  }

  if (compact.length === 16) {
    const tierCode = compact.slice(2, 4);
    // SC eCourts CNRs use SCIN… (positions 3–4 = IN) — not district court.
    if (compact.startsWith('SCIN') || (compact.startsWith('SC') && tierCode === 'IN')) {
      return {
        courtType: 'sc',
        kind: 'cnr',
        normalized: compact,
        confidence: 'high',
        notes: [
          'SC 16-char CNR (SCIN / SC…IN tier) — corpus may still be diary-first; use diaryNumber when pending',
        ],
      };
    }
    if (tierCode === 'HC') {
      return {
        courtType: 'hc',
        kind: 'cnr',
        normalized: compact,
        confidence: 'high',
        notes: ['16-char CNR with HC tier code at positions 3–4'],
      };
    }

    const notes = [
      '16-char CNR with non-HC tier code at positions 3–4 — treated as district court',
    ];
    if (tierCode === 'CT') {
      notes.push(
        'B9 duplicate risk: some CNRs (e.g. DLCT…) exist as both HC and DC rows — pass options.courtType when user picks',
      );
    }
    return {
      courtType: 'dc',
      kind: 'cnr',
      normalized: compact,
      confidence: 'medium',
      notes,
    };
  }

  if (compact.length >= 12 && compact.slice(2, 4) === 'HC') {
    return {
      courtType: 'hc',
      kind: 'cnr',
      normalized: compact,
      confidence: 'medium',
      notes: ['Non-canonical length but HC tier code present at positions 3–4'],
    };
  }

  return {
    courtType: 'unknown',
    kind: 'cnr',
    normalized: compact,
    confidence: 'low',
    notes: ['Alphanumeric token plausibly CNR-shaped but tier code not recognized'],
  };
}

/**
 * Infer court tier and identifier kind from a single user-supplied token.
 * Does not call upstream services — pure string rules (Appendix E).
 */
export function inferCourtTypeFromIdentifier(input: string): NvCourtTypeInference {
  const raw = String(input ?? '').trim();
  if (!raw) {
    return {
      courtType: 'unknown',
      kind: 'ambiguous',
      confidence: 'low',
      notes: ['Empty identifier'],
    };
  }

  const compact = normalizeCompact(raw);

  const diary = inferFromDiary(raw, compact);
  if (diary) return diary;

  const caseNumber = inferFromCaseNumber(raw);
  if (caseNumber) return caseNumber;

  const cnr = inferFromCnr(compact);
  if (cnr) return cnr;

  if (/^\d+$/.test(compact) && compact.length >= 6) {
    return {
      courtType: 'hc',
      kind: 'ambiguous',
      normalized: compact,
      confidence: 'low',
      notes: [
        'Long numeric filing reference — likely HC filing ref; pass options.courtType hc or dc explicitly',
      ],
    };
  }

  return {
    courtType: 'unknown',
    kind: 'ambiguous',
    confidence: 'low',
    notes: ['Identifier shape not recognized as SC diary, case number, or Indian CNR'],
  };
}

/** Map inference court tier → nysapi `court_type` query param. */
export function inferenceToCaseApiCourtLevel(
  inference: NvCourtTypeInference,
): 'SC' | 'HC' | 'DC' | undefined {
  switch (inference.courtType) {
    case 'sc':
      return 'SC';
    case 'hc':
      return 'HC';
    case 'dc':
      return 'DC';
    default:
      return undefined;
  }
}
