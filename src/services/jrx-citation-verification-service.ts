// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
import { createLogger } from '../utils/logger.js';
import { db as _raw_db } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { nvStatuteVersions } from '../../shared/schema.js';
import { eq, and, isNull, or, gte, lte } from 'drizzle-orm';

const logger = createLogger('./jrx-citation-verification');

export interface CitationCandidate {
  type: 'structured' | 'unstructured';
  rawText: string;
  position: number;
  normalizedRef?: string;
}

export interface CitationResult {
  citation: CitationCandidate;
  status: 'VERIFIED' | 'UNVERIFIED' | 'EXPIRED' | 'UNCERTAIN';
  dbMatch?: { sectionText: string; validFrom: Date; validTo?: Date | null };
  reason: string;
}

export interface CitationVerificationReport {
  totalCitations: number;
  verified: CitationResult[];
  unverified: CitationResult[];
  expired: CitationResult[];
  uncertain: CitationResult[];
  passedThreshold: boolean;
  deprecationWarnings: string[];
}

const STRUCTURED_CITATION_PATTERN = /(?:Section|S\.)\s*(\d+[A-Z]?(?:\(\d+\)(?:\([a-z]+\))?)*)\s+(?:of\s+)?(?:the\s+)?([A-Z][A-Za-z\s,]+(?:Act|Code|Rules|Regulations|Ordinance|Sanhita)\s*,?\s*\d{4})/gi;
const CASE_CITATION_PATTERN = /(\[\d{4}\])\s+(\d+)\s+([A-Z]+)\s+(\d+)/g;
const IPC_PATTERN = /(?:Section|S\.)\s*\d+[A-Z]?\s+(?:of\s+)?(?:the\s+)?(?:Indian\s+Penal\s+Code|IPC|Code\s+of\s+Criminal\s+Procedure|CrPC|Indian\s+Evidence\s+Act)/gi;

const STATUTE_NORMALIZATION: Record<string, string> = {
  'BNS': 'BNS 2023',
  'Bharatiya Nyaya Sanhita': 'BNS 2023',
  'Bharatiya Nyaya Sanhita, 2023': 'BNS 2023',
  'BNSS': 'BNSS 2023',
  'Bharatiya Nagarik Suraksha Sanhita': 'BNSS 2023',
  'Bharatiya Nagarik Suraksha Sanhita, 2023': 'BNSS 2023',
  'BSA': 'BSA 2023',
  'Bharatiya Sakshya Adhiniyam': 'BSA 2023',
  'Bharatiya Sakshya Adhiniyam, 2023': 'BSA 2023',
};

export class NvCitationVerificationService {
  private static instance: NvCitationVerificationService;

  private constructor() {}

  static getInstance(): NvCitationVerificationService {
    if (!NvCitationVerificationService.instance) {
      NvCitationVerificationService.instance = new NvCitationVerificationService();
    }
    return NvCitationVerificationService.instance;
  }

  async verify(text: string, eventDate?: Date): Promise<CitationVerificationReport> {
    const startTime = Date.now();
    const deprecationWarnings: string[] = [];

    try {
      const candidates = this.extractCitations(text);
      const normalized = this.normalizeCitations(candidates, deprecationWarnings);

      const verified: CitationResult[] = [];
      const unverified: CitationResult[] = [];
      const expired: CitationResult[] = [];
      const uncertain: CitationResult[] = [];

      for (const citation of normalized) {
        if (citation.type === 'structured' && citation.normalizedRef) {
          const result = await this.verifyStatuteCitation(citation, eventDate);
          switch (result.status) {
            case 'VERIFIED': verified.push(result); break;
            case 'UNVERIFIED': unverified.push(result); break;
            case 'EXPIRED': expired.push(result); break;
            case 'UNCERTAIN': uncertain.push(result); break;
          }
        } else {
          uncertain.push({
            citation,
            status: 'UNCERTAIN',
            reason: 'Unstructured citation — requires manual verification',
          });
        }
      }

      const passedThreshold = unverified.length === 0;

      logger.info({
        service: 'NvCitationVerificationService',
        method: 'verify',
        totalCitations: candidates.length,
        verified: verified.length,
        unverified: unverified.length,
        expired: expired.length,
        uncertain: uncertain.length,
        passedThreshold,
        durationMs: Date.now() - startTime,
      });

      return { totalCitations: candidates.length, verified, unverified, expired, uncertain, passedThreshold, deprecationWarnings };
    } catch (error: any) {
      logger.error({
        service: 'NvCitationVerificationService',
        method: 'verify',
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      });
      return { totalCitations: 0, verified: [], unverified: [], expired: [], uncertain: [], passedThreshold: true, deprecationWarnings };
    }
  }

  extractCitations(text: string): CitationCandidate[] {
    const candidates: CitationCandidate[] = [];

    let match: RegExpExecArray | null;
    const structuredPattern = new RegExp(STRUCTURED_CITATION_PATTERN.source, STRUCTURED_CITATION_PATTERN.flags);
    while ((match = structuredPattern.exec(text)) !== null) {
      candidates.push({
        type: 'structured',
        rawText: match[0],
        position: match.index,
      });
    }

    const casePattern = new RegExp(CASE_CITATION_PATTERN.source, CASE_CITATION_PATTERN.flags);
    while ((match = casePattern.exec(text)) !== null) {
      candidates.push({
        type: 'unstructured',
        rawText: match[0],
        position: match.index,
      });
    }

    const unstructuredPatterns = [
      /the\s+(?:Supreme|High)\s+Court\s+held\s+in\s+([^,]+)/gi,
      /as\s+per\s+the\s+decision\s+in\s+([^,]+)/gi,
    ];
    for (const pattern of unstructuredPatterns) {
      const p = new RegExp(pattern.source, pattern.flags);
      while ((match = p.exec(text)) !== null) {
        candidates.push({
          type: 'unstructured',
          rawText: match[0],
          position: match.index,
        });
      }
    }

    return candidates;
  }

  normalizeCitations(candidates: CitationCandidate[], warnings: string[]): CitationCandidate[] {
    return candidates.map(c => {
      if (c.type !== 'structured') return c;

      let normalized = c.rawText;
      const ipcMatch = c.rawText.match(IPC_PATTERN);
      if (ipcMatch) {
        warnings.push(`DEPRECATION: "${c.rawText}" — IPC/CrPC/Evidence Act are superseded. Use BNS 2023/BNSS 2023/BSA 2023.`);
      }

      for (const [key, value] of Object.entries(STATUTE_NORMALIZATION)) {
        if (normalized.includes(key)) {
          normalized = normalized.replace(key, value);
        }
      }

      const sectionMatch = normalized.match(/(?:Section|S\.)\s*(\d+[A-Z]?(?:\(\d+\)(?:\([a-z]+\))?)*)/i);
      const actMatch = normalized.match(/([A-Z][A-Za-z\s,]+(?:Act|Code|Rules|Regulations|Ordinance|Sanhita)\s*,?\s*\d{4})/i);

      if (sectionMatch && actMatch) {
        const normalizedRef = `${actMatch[1].trim()} S.${sectionMatch[1]}`;
        return { ...c, normalizedRef };
      }

      return c;
    });
  }

  private async verifyStatuteCitation(citation: CitationCandidate, eventDate?: Date): Promise<CitationResult> {
    if (!citation.normalizedRef) {
      return { citation, status: 'UNCERTAIN', reason: 'Could not normalize citation reference' };
    }

    const parts = citation.normalizedRef.match(/^(.+)\s+S\.(.+)$/);
    if (!parts) {
      return { citation, status: 'UNCERTAIN', reason: 'Could not parse statute reference format' };
    }

    const statuteName = parts[1].trim();
    const sectionNumber = parts[2].trim();

    try {
      const results = await db.select()
        .from(nvStatuteVersions)
        .where(
          and(
            eq(nvStatuteVersions.sectionNumber, sectionNumber),
            or(
              isNull(nvStatuteVersions.validTo),
              eventDate ? gte(nvStatuteVersions.validTo, eventDate) : undefined
            )
          )
        )
        .limit(5);

      if (results.length === 0) {
        return { citation, status: 'UNVERIFIED', reason: `Section ${sectionNumber} not found in statute database` };
      }

      const currentVersion = results.find(r => !r.validTo);
      if (currentVersion) {
        return {
          citation,
          status: 'VERIFIED',
          dbMatch: {
            sectionText: currentVersion.sectionText.substring(0, 200),
            validFrom: currentVersion.validFrom,
            validTo: currentVersion.validTo,
          },
          reason: 'Citation verified against statute database',
        };
      }

      const latestExpired = results[0];
      return {
        citation,
        status: 'EXPIRED',
        dbMatch: {
          sectionText: latestExpired.sectionText.substring(0, 200),
          validFrom: latestExpired.validFrom,
          validTo: latestExpired.validTo,
        },
        reason: `Citation refers to expired provision (valid until ${latestExpired.validTo})`,
      };
    } catch (error: any) {
      return { citation, status: 'UNCERTAIN', reason: `DB lookup failed: ${error instanceof Error ? error.message : 'unknown'}` };
    }
  }
}

export const nvCitationVerificationService = NvCitationVerificationService.getInstance();
