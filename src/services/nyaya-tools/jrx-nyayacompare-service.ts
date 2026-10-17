// NYV-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
import { createLogger } from '../../utils/logger.js';
import { db as _raw_db } from '../../db/index.js';
import { lazyRequire } from '../../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { nvStatuteVersions } from '../../../shared/schema.js';
import { eq, and, desc } from 'drizzle-orm';

const logger = createLogger('./jrx-nyayacompare');

type JurisdictionCode = 'IN' | 'UK' | 'EU' | 'US' | 'GC' | 'SG';

export interface CompareInput {
  sourceJurisdiction: JurisdictionCode;
  targetJurisdiction: JurisdictionCode;
  sourceSectionNumber: string;
  targetSectionNumber?: string;
  sourceStatuteId: string;
  targetStatuteId?: string;
}

export interface ComparisonDiff {
  type: 'added' | 'removed' | 'modified' | 'unchanged';
  sourceText: string;
  targetText: string;
  similarity: number;
}

export interface ComparisonResult {
  source: { jurisdiction: JurisdictionCode; statuteId: string; sectionNumber: string; text: string };
  target: { jurisdiction: JurisdictionCode; statuteId: string; sectionNumber: string; text: string };
  overallSimilarity: number;
  diffs: ComparisonDiff[];
  keyDifferences: string[];
  practicalImplications: string[];
}

export interface VersionDiffResult {
  statuteId: string;
  sectionNumber: string;
  oldVersion: { text: string; validFrom: Date; validTo: Date | null };
  newVersion: { text: string; validFrom: Date; validTo: Date | null };
  changeType: 'added' | 'removed' | 'modified' | 'substituted';
  similarity: number;
  diffs: ComparisonDiff[];
}

export class NvNyayaCompareService {
  private static instance: NvNyayaCompareService;

  private constructor() {}

  static getInstance(): NvNyayaCompareService {
    if (!NvNyayaCompareService.instance) {
      NvNyayaCompareService.instance = new NvNyayaCompareService();
    }
    return NvNyayaCompareService.instance;
  }

  async compareSections(input: CompareInput): Promise<ComparisonResult> {
    const startTime = Date.now();

    try {
      const sourceVersions = await db.select()
        .from(nvStatuteVersions)
        .where(
          and(
            eq(nvStatuteVersions.statuteId, input.sourceStatuteId),
            eq(nvStatuteVersions.sectionNumber, input.sourceSectionNumber),
            eq(nvStatuteVersions.jurisdiction, input.sourceJurisdiction)
          )
        )
        .orderBy(desc(nvStatuteVersions.validFrom))
        .limit(1);

      const targetStatuteId = input.targetStatuteId || input.sourceStatuteId;
      const targetSectionNumber = input.targetSectionNumber || input.sourceSectionNumber;

      const targetVersions = await db.select()
        .from(nvStatuteVersions)
        .where(
          and(
            eq(nvStatuteVersions.statuteId, targetStatuteId),
            eq(nvStatuteVersions.sectionNumber, targetSectionNumber),
            eq(nvStatuteVersions.jurisdiction, input.targetJurisdiction)
          )
        )
        .orderBy(desc(nvStatuteVersions.validFrom))
        .limit(1);

      const sourceText = sourceVersions[0]?.sectionText || '';
      const targetText = targetVersions[0]?.sectionText || '';

      const diffs = this.computeDiffs(sourceText, targetText);
      const similarity = this.computeSimilarity(sourceText, targetText);
      const keyDifferences = this.extractKeyDifferences(diffs);
      const practicalImplications = this.derivePracticalImplications(keyDifferences, input);

      logger.info({
        service: 'NvNyayaCompareService',
        method: 'compareSections',
        sourceJurisdiction: input.sourceJurisdiction,
        targetJurisdiction: input.targetJurisdiction,
        similarity: Math.round(similarity * 100) / 100,
        durationMs: Date.now() - startTime,
      });

      return {
        source: { jurisdiction: input.sourceJurisdiction, statuteId: input.sourceStatuteId, sectionNumber: input.sourceSectionNumber, text: sourceText },
        target: { jurisdiction: input.targetJurisdiction, statuteId: targetStatuteId, sectionNumber: targetSectionNumber, text: targetText },
        overallSimilarity: similarity,
        diffs,
        keyDifferences,
        practicalImplications,
      };
    } catch (error: any) {
      logger.error({
        service: 'NvNyayaCompareService',
        method: 'compareSections',
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      });
      return {
        source: { jurisdiction: input.sourceJurisdiction, statuteId: input.sourceStatuteId, sectionNumber: input.sourceSectionNumber, text: '' },
        target: { jurisdiction: input.targetJurisdiction, statuteId: input.targetStatuteId || '', sectionNumber: input.targetSectionNumber || '', text: '' },
        overallSimilarity: 0,
        diffs: [],
        keyDifferences: ['Comparison failed — data unavailable'],
        practicalImplications: [],
      };
    }
  }

  async compareVersions(statuteId: string, sectionNumber: string): Promise<VersionDiffResult[]> {
    const startTime = Date.now();

    try {
      const versions = await db.select()
        .from(nvStatuteVersions)
        .where(
          and(
            eq(nvStatuteVersions.statuteId, statuteId),
            eq(nvStatuteVersions.sectionNumber, sectionNumber)
          )
        )
        .orderBy(desc(nvStatuteVersions.validFrom))
        .limit(20);

      if (versions.length < 2) return [];

      const results: VersionDiffResult[] = [];

      for (let i = 0; i < versions.length - 1; i++) {
        const newer = versions[i];
        const older = versions[i + 1];
        const diffs = this.computeDiffs(older.sectionText, newer.sectionText);
        const similarity = this.computeSimilarity(older.sectionText, newer.sectionText);

        let changeType: VersionDiffResult['changeType'] = 'modified';
        if (similarity > 0.95) changeType = 'modified';
        else if (similarity < 0.1) changeType = 'substituted';
        else if (!older.sectionText) changeType = 'added';

        results.push({
          statuteId,
          sectionNumber,
          oldVersion: { text: older.sectionText, validFrom: older.validFrom, validTo: older.validTo },
          newVersion: { text: newer.sectionText, validFrom: newer.validFrom, validTo: newer.validTo },
          changeType,
          similarity,
          diffs,
        });
      }

      logger.info({
        service: 'NvNyayaCompareService',
        method: 'compareVersions',
        statuteId,
        sectionNumber,
        versionsCompared: results.length,
        durationMs: Date.now() - startTime,
      });

      return results;
    } catch (error: any) {
      logger.error({ service: 'NvNyayaCompareService', method: 'compareVersions', error: (error as Error).message });
      return [];
    }
  }

  computeDiffs(source: string, target: string): ComparisonDiff[] {
    if (!source && !target) return [];
    if (!source) return [{ type: 'added', sourceText: '', targetText: target, similarity: 0 }];
    if (!target) return [{ type: 'removed', sourceText: source, targetText: '', similarity: 0 }];

    const sourceSentences = this.splitSentences(source);
    const targetSentences = this.splitSentences(target);
    const diffs: ComparisonDiff[] = [];

    const targetUsed = new Set<number>();

    for (const srcSentence of sourceSentences) {
      let bestMatch = -1;
      let bestSim = 0;

      for (let j = 0; j < targetSentences.length; j++) {
        if (targetUsed.has(j)) continue;
        const sim = this.sentenceSimilarity(srcSentence, targetSentences[j]);
        if (sim > bestSim) {
          bestSim = sim;
          bestMatch = j;
        }
      }

      if (bestSim > 0.8 && bestMatch >= 0) {
        targetUsed.add(bestMatch);
        if (bestSim > 0.95) {
          diffs.push({ type: 'unchanged', sourceText: srcSentence, targetText: targetSentences[bestMatch], similarity: bestSim });
        } else {
          diffs.push({ type: 'modified', sourceText: srcSentence, targetText: targetSentences[bestMatch], similarity: bestSim });
        }
      } else {
        diffs.push({ type: 'removed', sourceText: srcSentence, targetText: '', similarity: 0 });
      }
    }

    for (let j = 0; j < targetSentences.length; j++) {
      if (!targetUsed.has(j)) {
        diffs.push({ type: 'added', sourceText: '', targetText: targetSentences[j], similarity: 0 });
      }
    }

    return diffs;
  }

  computeSimilarity(a: string, b: string): number {
    if (!a && !b) return 1;
    if (!a || !b) return 0;

    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
    const union = new Set([...wordsA, ...wordsB]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  private splitSentences(text: string): string[] {
    return text.split(/(?<=[.!?;])\s+/).filter(s => s.trim().length > 5);
  }

  private sentenceSimilarity(a: string, b: string): number {
    const wordsA = a.toLowerCase().split(/\s+/).filter(w => w.length > 1);
    const wordsB = b.toLowerCase().split(/\s+/).filter(w => w.length > 1);
    const setA = new Set(wordsA);
    const setB = new Set(wordsB);
    const intersection = new Set([...setA].filter(w => setB.has(w)));
    const union = new Set([...setA, ...setB]);
    return union.size > 0 ? intersection.size / union.size : 0;
  }

  private extractKeyDifferences(diffs: ComparisonDiff[]): string[] {
    const differences: string[] = [];
    for (const diff of diffs) {
      if (diff.type === 'added') {
        differences.push(`Added: "${diff.targetText.substring(0, 100)}..."`);
      } else if (diff.type === 'removed') {
        differences.push(`Removed: "${diff.sourceText.substring(0, 100)}..."`);
      } else if (diff.type === 'modified' && diff.similarity < 0.8) {
        differences.push(`Modified (${Math.round(diff.similarity * 100)}% similar): "${diff.sourceText.substring(0, 60)}..." → "${diff.targetText.substring(0, 60)}..."`);
      }
    }
    return differences.slice(0, 10);
  }

  private derivePracticalImplications(differences: string[], input: CompareInput): string[] {
    const implications: string[] = [];
    if (differences.length === 0) {
      implications.push(`Provisions are substantially similar across ${input.sourceJurisdiction} and ${input.targetJurisdiction}`);
    } else {
      implications.push(`${differences.length} difference(s) found between ${input.sourceJurisdiction} and ${input.targetJurisdiction} provisions`);
      if (differences.some(d => d.includes('penalty') || d.includes('punishment') || d.includes('fine'))) {
        implications.push('Penalty/punishment provisions differ — verify applicable sentencing in each jurisdiction');
      }
      if (differences.some(d => d.includes('limitation') || d.includes('period') || d.includes('days'))) {
        implications.push('Limitation periods or timelines may differ — check filing deadlines');
      }
    }
    return implications;
  }
}

export const nvNyayaCompareService = NvNyayaCompareService.getInstance();
