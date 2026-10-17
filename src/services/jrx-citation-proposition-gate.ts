/**
 * NV-CITATION-PROPOSITION-GATE-001 — cite-for-proposition verification rules.
 *
 * Lawyer review (Hanuman sir): citations must support the EXACT proposition in
 * the preceding sentence; no date-only placeholders; no Bhajan Lal stretch.
 */

export interface CitationPropositionIssue {
  kind: 'date_only_citation' | 'verify_placeholder' | 'citation_required' | 'stretch_risk';
  excerpt: string;
  line?: number;
}

const DATE_ONLY_CITATION_RE =
  /\b(?:judgment|order|decision)\s+(?:dated|on)\s+\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b(?![^.\n]{0,80}\bv\.\b)/gi;

const BARE_DATE_CITATION_RE =
  /\b(?:in|see|refer)\s+(?:its|the|a)?\s*judgment\s+dated\s+\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/gi;

const VERIFY_PLACEHOLDER_RE =
  /\[\[PLACEHOLDER:[^]]*(?:verify|by date alone)[^]]*\]\]|\[VERIFY[^\]]*\]/gi;

const CITATION_REQUIRED_RE = /\[CITATION REQUIRED\]/gi;

/** Bhajan Lal categories cited without naming the case — stretch risk when paired with unrelated case names. */
const BHAJAN_LAL_STRETCH_RE =
  /\bBhajan Lal\b[^.\n]{0,200}\b(?:Ajay Malik|Anand Rai|Dr\.\s*Anand)\b|\b(?:Ajay Malik|Anand Rai|Dr\.\s*Anand)\b[^.\n]{0,200}\bBhajan Lal\b/gi;

export function analyzeCitationPropositionIssues(content: string): CitationPropositionIssue[] {
  const text = String(content || '');
  if (!text.trim()) return [];

  const issues: CitationPropositionIssue[] = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (DATE_ONLY_CITATION_RE.test(line) || BARE_DATE_CITATION_RE.test(line)) {
      issues.push({
        kind: 'date_only_citation',
        excerpt: line.trim().slice(0, 200),
        line: i + 1,
      });
    }
    DATE_ONLY_CITATION_RE.lastIndex = 0;
    BARE_DATE_CITATION_RE.lastIndex = 0;

    if (VERIFY_PLACEHOLDER_RE.test(line)) {
      issues.push({
        kind: 'verify_placeholder',
        excerpt: line.trim().slice(0, 200),
        line: i + 1,
      });
    }
    VERIFY_PLACEHOLDER_RE.lastIndex = 0;

    if (CITATION_REQUIRED_RE.test(line)) {
      issues.push({
        kind: 'citation_required',
        excerpt: line.trim().slice(0, 200),
        line: i + 1,
      });
    }
    CITATION_REQUIRED_RE.lastIndex = 0;
  }

  if (BHAJAN_LAL_STRETCH_RE.test(text)) {
    issues.push({
      kind: 'stretch_risk',
      excerpt: 'Bhajan Lal language may be paired with unrelated case citation',
    });
  }

  return issues;
}

export function hasCitationPropositionIssues(content: string): boolean {
  return analyzeCitationPropositionIssues(content).length > 0;
}

/** Post-process: replace date-only citation phrases with [VERIFY] marker for counsel review. */
export function applyCitationPropositionSanitize(content: string): {
  content: string;
  sanitized: boolean;
  issues: CitationPropositionIssue[];
} {
  let out = String(content || '');
  const issues = analyzeCitationPropositionIssues(out);
  if (issues.length === 0) return { content: out, sanitized: false, issues };

  let sanitized = false;
  out = out.replace(BARE_DATE_CITATION_RE, (m) => {
    sanitized = true;
    return m.replace(/\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/, '[VERIFY: case name and citation required]');
  });
  out = out.replace(
    /\b(?:Supreme Court(?:'s)?|Hon'ble Court(?:'s)?)\s+(?:judgment|order)\s+dated\s+\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b(?![^.\n]{0,120}\bv\.\b)/gi,
    (m) => {
      sanitized = true;
      return `${m} [VERIFY: cite case name, not date alone]`;
    },
  );

  return { content: out, sanitized, issues };
}

export const CITATION_PROPOSITION_PROMPT_RULE = `NV-CITATION-PROPOSITION-GATE-001 (mandatory — Indian drafting):
- Every case citation MUST support the EXACT legal proposition in the immediately preceding sentence. If uncertain whether the case holds that proposition, write [CITATION REQUIRED] — never fabricate a fit.
- NEVER cite by date alone (e.g. "judgment dated 15.01.2026" or "judgment dated 25.03.2025"). Always give party names and a standard reporter / SCC / INSC citation, or mark [VERIFY: case name and citation required].
- Do NOT attribute State of Haryana v. Bhajan Lal (1992 Supp (1) SCC 335) categories to unrelated cases (e.g. Ajay Malik, Anand Rai) unless the cited case actually decides that point on its facts.
- When citing Ajay Malik, Anand Rai, or any recent SC decision: verify the proposition (quashing / SC/ST ingredients / BNSS arrest) matches the holding — if not verified from supplied facts, use [CITATION REQUIRED] or [VERIFY citation before filing].
- Anti-stretch: omnibus / vague FIR grounds may cite Bhajan Lal categories; SC/ST ingredient grounds must cite SC/ST Act jurisprudence — do not cross-apply holdings.`;

export const INDIAN_PLEADING_STRUCTURE_CHECKLIST = `NV-INDIAN-PLEADING-STRUCTURE-001 (mandatory for criminal petition / quash / writ):
- Cause title: exact Court name, case type, year, parties with status (Petitioner/Respondent).
- LIST OF DATES (when paper exceeds a short application): chronological table, date → event.
- MOST RESPECTFULLY SHOWETH / Brief Facts: numbered paragraphs, chronological narrative.
- GROUNDS: numbered legal submissions — anticipate opposing counsel (why this accused is named; rebut omnibus allegation; individual overt act absence).
- UNDERTAKING (criminal/quash where appropriate): cooperation with investigation, notice compliance under BNSS s.35.
- DISCLOSURE CLAUSE: aver that no other petition for same/substantially similar relief has been filed (or disclose related co-accused proceedings in [[PLACEHOLDER: …]]).
- PRAYER: itemised interim + final relief in executable terms.
- VERIFICATION: deponent verification with place and date.
- Advocate block: Place, Date, counsel for Petitioner/Applicant — never leave bare "by date alone" citation placeholders in final output.`;
