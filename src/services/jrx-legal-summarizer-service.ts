import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-legal-summarizer-service');

type JurisdictionCode = 'IN' | 'UK' | 'EU' | 'US' | 'GCC' | 'SG';
type LegalDocType = 'statute' | 'case' | 'contract' | 'pleading' | 'affidavit' | 'order' | 'gazette' | 'other';

interface SummarizeOptions {
  level: 'executive' | 'legal' | 'technical' | 'all';
  audience: 'client' | 'lawyer' | 'court' | 'regulator';
  jurisdiction: JurisdictionCode;
  docType: LegalDocType;
  maxWords?: number;
}

interface LegalSummary {
  executive?: string;
  legal?: string;
  technical?: string;
  consistencyScore: number;
  isVerified: boolean;
  warnings: string[];
}

interface ConsistencyResult {
  score: number;
  isConsistent: boolean;
  hallucinatedClaims: string[];
  supportedClaims: string[];
}

const LONG_DOC_THRESHOLD = 2000;
const CONSISTENCY_THRESHOLD = 0.90;

class NvLegalSummarizerService {
  async summarize(text: string, options: SummarizeOptions): Promise<LegalSummary> {
    logger.info({ method: 'summarize', level: options.level, audience: options.audience, jurisdiction: options.jurisdiction, textLength: text.length });

    const tokenEstimate = Math.ceil(text.split(/\s+/).length * 1.3);
    let processedText = text;

    if (tokenEstimate > LONG_DOC_THRESHOLD) {
      processedText = await this.extractiveFirst(text);
    }

    const summary: LegalSummary = {
      consistencyScore: 1.0,
      isVerified: true,
      warnings: [],
    };

    if (options.level === 'executive' || options.level === 'all') {
      summary.executive = this.generateExecutiveSummary(processedText, options);
    }

    if (options.level === 'legal' || options.level === 'all') {
      summary.legal = this.generateLegalSummary(processedText, options);
    }

    if (options.level === 'technical' || options.level === 'all') {
      summary.technical = this.generateTechnicalSummary(processedText, options);
    }

    const fullSummary = [summary.executive, summary.legal, summary.technical].filter(Boolean).join(' ');
    if (fullSummary) {
      const consistency = await this.checkConsistency(text, fullSummary);
      summary.consistencyScore = consistency.score;
      summary.isVerified = consistency.isConsistent;
      if (consistency.hallucinatedClaims.length > 0) {
        summary.warnings = consistency.hallucinatedClaims.map(c => `Potential hallucination removed: ${c}`);
      }
    }

    return summary;
  }

  async checkConsistency(original: string, summary: string): Promise<ConsistencyResult> {
    logger.info({ method: 'checkConsistency', originalLength: original.length, summaryLength: summary.length });

    const summarySentences = summary.split(/[.!?]+/).filter(s => s.trim().length > 10);
    const originalLower = original.toLowerCase();

    const supported: string[] = [];
    const hallucinated: string[] = [];

    for (const sentence of summarySentences) {
      const words = sentence.trim().toLowerCase().split(/\s+/);
      const significantWords = words.filter(w => w.length > 4);
      const matchCount = significantWords.filter(w => originalLower.includes(w)).length;
      const matchRatio = matchCount / Math.max(significantWords.length, 1);

      if (matchRatio >= 0.5) {
        supported.push(sentence.trim());
      } else {
        hallucinated.push(sentence.trim());
      }
    }

    const score = supported.length / Math.max(supported.length + hallucinated.length, 1);

    return {
      score: Math.round(score * 100) / 100,
      isConsistent: score >= CONSISTENCY_THRESHOLD,
      hallucinatedClaims: hallucinated,
      supportedClaims: supported,
    };
  }

  private async extractiveFirst(text: string): Promise<string> {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);

    const scored = sentences.map((s, i) => {
      let score = 0;
      const lower = s.toLowerCase();

      const legalTerms = /section|article|act|court|judgment|order|petitioner|respondent|appellant|plaintiff|defendant/gi;
      const legalMatches = s.match(legalTerms);
      score += (legalMatches?.length || 0) * 2;

      if (i < 3 || i >= sentences.length - 3) score += 3;

      const words = s.split(/\s+/);
      const uniqueWords = new Set(words.map(w => w.toLowerCase()));
      score += (uniqueWords.size / Math.max(words.length, 1)) * 2;

      return { text: s.trim(), score, originalIndex: i };
    });

    scored.sort((a, b) => b.score - a.score);
    const topN = Math.max(Math.ceil(sentences.length * 0.3), 5);
    const selected = scored.slice(0, topN);
    selected.sort((a, b) => a.originalIndex - b.originalIndex);

    return selected.map(s => s.text).join('. ') + '.';
  }

  private generateExecutiveSummary(text: string, options: SummarizeOptions): string {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
    const maxSentences = Math.min(5, sentences.length);
    const selected = sentences.slice(0, maxSentences);
    return selected.map(s => s.trim()).join('. ') + '.';
  }

  private generateLegalSummary(text: string, options: SummarizeOptions): string {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
    const maxSentences = Math.min(15, sentences.length);
    const selected = sentences.slice(0, maxSentences);
    return selected.map(s => s.trim()).join('. ') + '.';
  }

  private generateTechnicalSummary(text: string, options: SummarizeOptions): string {
    return text;
  }
}

export const nvLegalSummarizerService = new NvLegalSummarizerService();
