import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-legal-ner-v2-service');

type JurisdictionCode = 'IN' | 'UK' | 'EU' | 'US' | 'GCC' | 'SG';

type EntityType =
  | 'PERSON' | 'ORG' | 'COURT' | 'JUDGE' | 'CASE_NUMBER' | 'STATUTE_REF'
  | 'SECTION_REF' | 'DATE' | 'AMOUNT' | 'JURISDICTION' | 'PARTY_ROLE'
  | 'DEFINED_TERM' | 'LIMITATION_DATE' | 'EFFECTIVE_DATE'
  | 'GOVERNING_LAW' | 'ARBITRATION_CLAUSE';

interface RawEntity {
  text: string;
  type: EntityType;
  start: number;
  end: number;
  confidence: number;
}

interface NormalizedEntity extends RawEntity {
  canonicalForm: string;
  normalized: boolean;
}

interface ValidatedEntity extends NormalizedEntity {
  valid: boolean;
  validationSource?: string;
}

interface LegalNerResult {
  entities: ValidatedEntity[];
  entityCounts: Record<string, number>;
  confidence: number;
  model: string;
}

/* NV-NER-INDIA-FORMS-001 — these patterns are for an India-only product, but two
 * of them only recognised non-Indian conventions.
 *
 * Measured live on `POST /api/jrx/intelligence/legal-ner` with
 * "Ram Kumar filed a petition under BNSS 482 before the Telangana High Court on
 *  12 March 2025 against Meridian Textiles Pvt Ltd for Rs 47,00,000."
 * → only AMOUNT and COURT were returned. The statute reference, the date and the
 * company were all missed, on the exact phrasing an Indian advocate would use.
 *
 * SECTION_PATTERN required a `Section`/`S.` prefix AND a trailing Act name with a
 * year, so the everyday citation form `BNSS 482` / `BNS 103` / `u/s 482 BNSS`
 * matched nothing. The bare-code alternative is deliberately restricted to a known
 * list of Indian code abbreviations rather than any `[A-Z]+ \d+`, so it cannot
 * swallow ordinary text like "INV 88421" or "COVID 19".
 *
 * DATE_PATTERN accepted `March 12, 2025` but not `12 March 2025` — the standard
 * Indian ordering, and the one used in cause titles and affidavits — nor ordinal
 * forms like `12th March 2025`.
 */
const INDIAN_CODE_ABBR = 'BNSS|BNS|BSA|IPC|CrPC|CPC|IEA|PMLA|CGST|SGST|IGST|MSMED|SARFAESI|IBC|NIA|RERA|DPDP';
const SECTION_PATTERN = new RegExp(
  // Section 482 of the BNSS, 2023   |   u/s 482 BNSS   |   BNSS 482
  `(?:Section|Sec\\.?|S\\.)\\s*(\\d+[A-Z]?(?:\\(\\d+\\)(?:\\([a-z]+\\))?)*)\\s+(?:of\\s+)?(?:the\\s+)?([\\w\\s,]+(?:Act|Code|Rules|Regulations|Ordinance|Sanhita|Adhiniyam)\\s*,?\\s*\\d{4})` +
  `|(?:u/s|under\\s+section)\\s*(\\d+[A-Z]?)\\s*(?:of\\s+)?(?:the\\s+)?(?:${INDIAN_CODE_ABBR})\\b` +
  `|\\b(?:${INDIAN_CODE_ABBR})\\s+(?:section\\s+)?(\\d+[A-Z]?(?:\\(\\d+\\))?)\\b`,
  'gi',
);
const CASE_PATTERN = /(?:[A-Z][a-z]+\s+(?:vs?\.?\s+)?[A-Z][a-z]+),?\s+(?:\(\d{4}\)|\[\d{4}\])\s+\d+\s+(?:SCC|AIR|SCR|Bom|Del|Mad|Cal|SC)\s+\d+/g;
/* NV-NER-AMOUNT-BOUNDARY-001 — the currency prefix must be a word on its own and
 * must be followed by an actual digit.
 *
 * Pre-existing defect, found while building court-document extraction: the old
 * pattern was `(?:Rs\.?\s*|₹|INR\s*|...)[\d,]+`, and `[\d,]+` matches a **bare
 * comma**. With no leading word boundary, the "rs," inside "aged 42 yea*rs,*"
 * matched and was emitted as an AMOUNT entity with confidence 0.85. So any document
 * containing the word "years," produced a phantom monetary entity — measured
 * `["rs,", "Rs 47,00,000"]` on a real petition. Letter prefixes now require `\b`
 * (symbols cannot take one), and a digit is mandatory before the comma run. */
const AMOUNT_PATTERN = /(?:\bRs\.?\s*|\bINR\s*|\bUSD\s*|\bGBP\s*|₹\s*|\$\s*|£\s*)\d[\d,]*(?:\.\d+)?(?:\s*(?:lakhs?|crores?|millions?|billions?))?/gi;
const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
const DATE_PATTERN = new RegExp(
  // 12/03/2025  |  12 March 2025  |  12th March 2025  |  March 12, 2025
  `\\b\\d{1,2}[\\/-]\\d{1,2}[\\/-]\\d{2,4}\\b` +
  `|\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})\\,?\\s+\\d{4}\\b` +
  `|\\b(?:${MONTHS})\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`,
  'gi',
);
const COURT_PATTERN = /(?:Supreme Court|High Court|District Court|Sessions Court|Magistrate Court|NCLT|NCLAT|SAT|NCDRC|ITAT|Tribunal)(?:\s+(?:of|at)\s+[A-Z][a-z]+)?/gi;
/* NV-NER-JUDGE-INITIALS-001 — Indian judges are almost always cited with initials.
 *
 * The pattern required `Justice` followed immediately by `[A-Z][a-z]+`, so
 * "Justice A. Rajashekar Reddy" — the standard cause-list form — matched NOTHING.
 * Surfaced by a test written for PERSON extraction: the JUDGE assertion failed, which
 * is why the assertion existed. `(?:[A-Z]\.\s*)*` accepts any run of initials
 * (`A.`, `A. B.`, `K.S.`) before the surname, and remains optional so plain
 * "Justice Sharma" still matches.
 *
 * Note the earlier court-document probe DID report `judge: "A. Rajashekar Reddy"` —
 * that came from `jrx-court-document-fields.ts`'s own JUDGE_RE, which already handled
 * initials. This service was the one that could not, so the two disagreed on the same
 * text. Now aligned.
 */
const JUDGE_PATTERN = /(?:Hon'?ble\s+)?(?:Justice|Judge|J\.)\s+(?:[A-Z]\.\s*)*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/gi;
/* Indian company / firm suffixes — `ORG_PATTERN` recognised only regulators
 * (RBI/SEBI/…), so the actual parties to a commercial matter were never entities.
 * "Meridian Textiles Pvt Ltd" was missed on the live probe. Anchored on the suffix
 * so it captures the name preceding it without matching arbitrary capitalised prose. */
const ORG_PATTERN = /(?:RBI|SEBI|MCA|CBDT|CBIC|IRDAI|TRAI|CCI|NCLT|NCLAT)\b|\b(?:[A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*){0,4})\s+(?:Pvt\.?\s+Ltd\.?|Private\s+Limited|Ltd\.?|Limited|LLP|Corporation|Industries|Enterprises|Bank)\b/g;
const PARTY_ROLE_PATTERN = /(?:petitioner|respondent|appellant|plaintiff|defendant|applicant|complainant|accused|convict|witness)/gi;

/**
 * NV-NER-PERSON-INDIA-001 — PERSON extraction anchored on Indian document structure.
 *
 * `regexExtract` declared PERSON as a type but had no pattern for it, so a name in
 * free text was never an entity. The live probe made that concrete: "Ram Kumar filed a
 * petition…" returned no PERSON.
 *
 * Anchored on *conventions* rather than capitalisation, on purpose. A "two capitalised
 * words" heuristic would classify "High Court", "Banjara Hills", "Bharatiya Nyaya" and
 * "Meridian Textiles" as people — and a wrong party name autofilled into a matter is
 * worse than a blank field, because it looks authoritative. So each alternative
 * requires a structural cue that only ever precedes or follows a person:
 *
 *   S/o | D/o | W/o        Indian filiation markers, always after a person's name
 *   aged N years           cause-title descriptor
 *   Deponent / Affiant     affidavit signature block
 *   Counsel/Advocate for   appearance line
 *   Shri/Smt/Sri/Kum/Dr    honorifics
 *
 * PERSON deliberately does NOT include the bare "Justice X" form — `JUDGE_PATTERN`
 * already owns that, and duplicating it would double-count the same span under two
 * types.
 */
const HONORIFIC = "Shri|Sri|Smt\\.?|Smt|Kum\\.?|Ms\\.?|Mr\\.?|Mrs\\.?|Dr\\.?|Prof\\.?";
const NAME_CORE = "[A-Z][a-z]+(?:\\s+[A-Z][a-z]+){0,3}";
const PERSON_PATTERN = new RegExp(
  // "Ram Kumar S/o ..." — name immediately before a filiation marker
  `\\b(${NAME_CORE})\\s*(?:,\\s*)?(?=(?:S/o|D/o|W/o|s/o|d/o|w/o)\\b)` +
  // "Shri Mohan Lal", "Smt. Radha Devi"
  `|\\b(?:${HONORIFIC})\\s+(${NAME_CORE})` +
  // "Ram Kumar, aged 42 years"
  `|\\b(${NAME_CORE})\\s*,\\s*(?=aged\\s+\\d+\\s+years?)` +
  // "Counsel for the Petitioner: Ravi Shankar" / "Advocate for Respondent - X"
  `|(?:Counsel|Advocate|Pleader)\\s+for\\s+(?:the\\s+)?(?:Petitioner|Respondent|Appellant|Plaintiff|Defendant|Applicant|Accused)s?\\s*[:\\-–]\\s*(${NAME_CORE})` +
  // "Deponent: X" / signed "X, Deponent"
  `|(?:Deponent|Affiant)\\s*[:\\-–]\\s*(${NAME_CORE})` +
  `|\\b(${NAME_CORE})\\s*,\\s*(?=(?:Deponent|Affiant)\\b)`,
  'g',
);

class NvLegalNerV2Service {
  async extractEntities(text: string, jurisdiction: JurisdictionCode): Promise<LegalNerResult> {
    logger.info({ method: 'extractEntities', jurisdiction, textLength: text.length });

    const inlegalBertUrl = process.env.INLEGAL_BERT_URL;

    if (inlegalBertUrl) {
      try {
        return await this.callInLegalBert(text, jurisdiction, inlegalBertUrl);
      } catch (error: any) {
        logger.warn({ method: 'extractEntities', fallback: 'regex', reason: (error as Error).message });
      }
    }

    return this.regexExtract(text, jurisdiction);
  }

  private async callInLegalBert(text: string, jurisdiction: JurisdictionCode, url: string): Promise<LegalNerResult> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, jurisdiction }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) throw new Error(`InLegalBERT returned ${response.status}`);

    const data = await response.json() as { entities: RawEntity[] };
    const normalized = await this.normalizeEntities(data.entities);
    const validated = await this.validateStatuteRefs(normalized);

    return this.buildResult(validated, 'inlegal-bert');
  }

  private regexExtract(text: string, jurisdiction: JurisdictionCode): LegalNerResult {
    const entities: RawEntity[] = [];

    this.extractWithPattern(text, SECTION_PATTERN, 'SECTION_REF', entities);
    this.extractWithPattern(text, CASE_PATTERN, 'CASE_NUMBER', entities);
    this.extractWithPattern(text, AMOUNT_PATTERN, 'AMOUNT', entities);
    this.extractWithPattern(text, DATE_PATTERN, 'DATE', entities);
    this.extractWithPattern(text, COURT_PATTERN, 'COURT', entities);
    this.extractWithPattern(text, JUDGE_PATTERN, 'JUDGE', entities);
    this.extractWithPattern(text, ORG_PATTERN, 'ORG', entities);
    this.extractWithPattern(text, PARTY_ROLE_PATTERN, 'PARTY_ROLE', entities);
    /* NV-NER-PERSON-INDIA-001 — PERSON last, at a lower confidence (0.8 vs 0.85),
     * because it is inferred from a structural cue rather than a self-identifying
     * token like "Rs" or "Section". Ordering also matters: JUDGE has already claimed
     * "Justice X" spans by this point. */
    this.extractCapturedWithPattern(text, PERSON_PATTERN, 'PERSON', entities, 0.8);

    const definedTermPattern = /"([A-Z][a-zA-Z\s]+)"\s*(?:means|shall mean|refers to)/g;
    this.extractWithPattern(text, definedTermPattern, 'DEFINED_TERM', entities);

    const governingLawPattern = /governed by.*?(?:law|laws).*?(?:of\s+)?(?:India|United Kingdom|Singapore|UAE|European Union)/gi;
    this.extractWithPattern(text, governingLawPattern, 'GOVERNING_LAW', entities);

    const arbitrationPattern = /(?:arbitrat(?:ion|ed|or)).*?(?:rules|clause|proceedings|seat)/gi;
    this.extractWithPattern(text, arbitrationPattern, 'ARBITRATION_CLAUSE', entities);

    const normalized = entities.map(e => ({
      ...e,
      canonicalForm: this.canonicalize(e),
      normalized: true,
    }));

    const validated = normalized.map(e => ({
      ...e,
      valid: true,
      validationSource: 'regex-rules',
    }));

    return this.buildResult(validated, 'regex-v2');
  }

  private extractWithPattern(text: string, pattern: RegExp, type: EntityType, entities: RawEntity[]): void {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(text)) !== null) {
      entities.push({
        text: match[0].trim(),
        type,
        start: match.index,
        end: match.index + match[0].length,
        confidence: 0.85,
      });
    }
  }

  /**
   * NV-NER-PERSON-INDIA-001 — like `extractWithPattern`, but records the first
   * non-empty CAPTURE GROUP instead of the whole match.
   *
   * Needed because the person's name is only one part of its structural cue: on
   * "Counsel for the Petitioner: Ravi Shankar", `match[0]` is the entire clause, and
   * storing that as a PERSON value would put "Counsel for the Petitioner:" into an
   * autofilled party field. A separate method rather than a flag on the shared helper,
   * so the eight existing call sites keep byte-identical behaviour.
   *
   * Offsets are recalculated for the captured span so `start`/`end` still point at the
   * name itself — a consumer highlighting the entity must not highlight the cue.
   */
  private extractCapturedWithPattern(
    text: string,
    pattern: RegExp,
    type: EntityType,
    entities: RawEntity[],
    confidence = 0.8,
  ): void {
    const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
    let match;
    while ((match = regex.exec(text)) !== null) {
      const captured = match.slice(1).find((g) => typeof g === 'string' && g.trim());
      const value = (captured ?? match[0]).trim();
      if (!value) continue;
      /* Zero-length matches would loop forever with a lastIndex that never advances. */
      if (match[0].length === 0) {
        regex.lastIndex += 1;
        continue;
      }
      const offset = match[0].indexOf(value);
      const start = match.index + (offset >= 0 ? offset : 0);
      entities.push({
        text: value,
        type,
        start,
        end: start + value.length,
        confidence,
      });
    }
  }

  async normalizeEntities(entities: RawEntity[]): Promise<NormalizedEntity[]> {
    return entities.map(e => ({
      ...e,
      canonicalForm: this.canonicalize(e),
      normalized: true,
    }));
  }

  async validateStatuteRefs(entities: NormalizedEntity[]): Promise<ValidatedEntity[]> {
    return entities.map(e => ({
      ...e,
      valid: true,
      validationSource: 'pending-db-validation',
    }));
  }

  private canonicalize(entity: RawEntity): string {
    const text = entity.text.trim();
    switch (entity.type) {
      case 'SECTION_REF':
        return text.replace(/\s+/g, ' ').replace(/S\./i, 'Section ');
      case 'AMOUNT':
        return text.replace(/\s+/g, '');
      case 'DATE':
        return text;
      default:
        return text;
    }
  }

  private buildResult(entities: ValidatedEntity[], model: string): LegalNerResult {
    const entityCounts: Record<string, number> = {};
    for (const e of entities) {
      entityCounts[e.type] = (entityCounts[e.type] || 0) + 1;
    }

    const confidence = entities.length > 0
      ? entities.reduce((sum, e) => sum + e.confidence, 0) / entities.length
      : 0;

    return {
      entities,
      entityCounts,
      confidence: Math.round(confidence * 100) / 100,
      model,
    };
  }
}

export const nvLegalNerV2Service = new NvLegalNerV2Service();
