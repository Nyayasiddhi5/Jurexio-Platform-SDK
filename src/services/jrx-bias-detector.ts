// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * Jurexio ML-Grade Bias Detector v2.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Multi-dimensional legal-domain bias scoring engine.
 *
 * Dimensions scored (0–100 each, higher = more biased):
 *   gender       — gendered language, asymmetric framing
 *   caste        — caste-based framing, reservations rhetoric
 *   religious    — faith-based stereotyping, communal framing
 *   regional     — linguistic/regional prejudice
 *   economic     — wealth-based access language, classist framing
 *   legalOutcome — outcome-presupposing language (pre-judgment)
 *
 * Scoring approach:
 *   1. Lexical feature extraction (weighted n-gram signals)
 *   2. Contextual valence (negation handling, compound signals)
 *   3. Frequency–severity weighting (rare but extreme signals score higher)
 *   4. Aggregate composite score with confidence band
 *
 * @module jrx-bias-detector
 */

import { db as _raw_db } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { sql } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('bias-detector');

// ─── Types ─────────────────────────────────────────────────────────────────

export interface BiasFeature {
  token: string;
  weight: number;
  dimension: BiasDimension;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export type BiasDimension =
  | 'gender'
  | 'caste'
  | 'religious'
  | 'regional'
  | 'economic'
  | 'legalOutcome';

export interface DimensionScore {
  dimension: BiasDimension;
  score: number;           // 0–100
  confidence: number;      // 0–1
  signals: string[];       // matched features
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  mitigation: string;
}

export interface BiasAnalysisResult {
  compositeScore: number;         // 0–100 weighted average
  overallSeverity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  dimensions: DimensionScore[];
  flagged: boolean;               // true if compositeScore > 30
  confidence: number;             // 0–1
  textLength: number;
  signalCount: number;
  analysedAt: string;
  mitigationSummary: string;
  rawSignals: string[];
}

// ─── Feature Lexicons ──────────────────────────────────────────────────────

const LEXICON: BiasFeature[] = [
  // ── Gender dimension ────────────────────────────────────────────────────
  { token: 'hysterical woman', weight: 0.92, dimension: 'gender', severity: 'critical' },
  { token: 'emotional female', weight: 0.88, dimension: 'gender', severity: 'high' },
  { token: 'the fairer sex', weight: 0.75, dimension: 'gender', severity: 'high' },
  { token: 'typical woman', weight: 0.82, dimension: 'gender', severity: 'high' },
  { token: 'like a woman', weight: 0.70, dimension: 'gender', severity: 'medium' },
  { token: 'womanly', weight: 0.55, dimension: 'gender', severity: 'medium' },
  { token: 'manly', weight: 0.50, dimension: 'gender', severity: 'low' },
  { token: 'feminism', weight: 0.30, dimension: 'gender', severity: 'low' },
  { token: 'ladies are', weight: 0.65, dimension: 'gender', severity: 'medium' },
  { token: 'women tend to', weight: 0.60, dimension: 'gender', severity: 'medium' },
  { token: 'men are better', weight: 0.85, dimension: 'gender', severity: 'high' },
  { token: 'maternal instinct', weight: 0.55, dimension: 'gender', severity: 'medium' },
  { token: 'female judge', weight: 0.40, dimension: 'gender', severity: 'low' },
  { token: 'lady lawyer', weight: 0.50, dimension: 'gender', severity: 'medium' },
  { token: 'girl lawyer', weight: 0.60, dimension: 'gender', severity: 'medium' },

  // ── Caste dimension ─────────────────────────────────────────────────────
  { token: 'lower caste', weight: 0.80, dimension: 'caste', severity: 'high' },
  { token: 'upper caste', weight: 0.65, dimension: 'caste', severity: 'medium' },
  { token: 'dalit people', weight: 0.55, dimension: 'caste', severity: 'medium' },
  { token: 'dalit are', weight: 0.75, dimension: 'caste', severity: 'high' },
  { token: 'untouchable', weight: 0.90, dimension: 'caste', severity: 'critical' },
  { token: 'reservation quota', weight: 0.55, dimension: 'caste', severity: 'medium' },
  { token: 'quota beneficiary', weight: 0.65, dimension: 'caste', severity: 'medium' },
  { token: 'merit vs reservation', weight: 0.70, dimension: 'caste', severity: 'high' },
  { token: 'brahmin dominated', weight: 0.75, dimension: 'caste', severity: 'high' },
  { token: 'sc st', weight: 0.35, dimension: 'caste', severity: 'low' },
  { token: 'obc quota', weight: 0.55, dimension: 'caste', severity: 'medium' },
  { token: 'caste based', weight: 0.60, dimension: 'caste', severity: 'medium' },
  { token: 'backward class', weight: 0.40, dimension: 'caste', severity: 'low' },
  { token: 'high caste privilege', weight: 0.70, dimension: 'caste', severity: 'high' },

  // ── Religious dimension ──────────────────────────────────────────────────
  { token: 'muslim criminal', weight: 0.95, dimension: 'religious', severity: 'critical' },
  { token: 'islamic extremist', weight: 0.85, dimension: 'religious', severity: 'high' },
  { token: 'hindu fanaticism', weight: 0.85, dimension: 'religious', severity: 'high' },
  { token: 'religious minority', weight: 0.35, dimension: 'religious', severity: 'low' },
  { token: 'communal riot', weight: 0.55, dimension: 'religious', severity: 'medium' },
  { token: 'jihad', weight: 0.80, dimension: 'religious', severity: 'high' },
  { token: 'crusade', weight: 0.65, dimension: 'religious', severity: 'medium' },
  { token: 'kafir', weight: 0.80, dimension: 'religious', severity: 'high' },
  { token: 'infidel', weight: 0.75, dimension: 'religious', severity: 'high' },
  { token: 'they always riot', weight: 0.88, dimension: 'religious', severity: 'critical' },
  { token: 'anti-hindu', weight: 0.70, dimension: 'religious', severity: 'high' },
  { token: 'anti-muslim', weight: 0.70, dimension: 'religious', severity: 'high' },
  { token: 'religious mob', weight: 0.65, dimension: 'religious', severity: 'medium' },
  { token: 'conversion agenda', weight: 0.72, dimension: 'religious', severity: 'high' },
  { token: 'christians are', weight: 0.60, dimension: 'religious', severity: 'medium' },
  { token: 'sikh extremism', weight: 0.75, dimension: 'religious', severity: 'high' },

  // ── Regional dimension ───────────────────────────────────────────────────
  { token: 'north indian', weight: 0.35, dimension: 'regional', severity: 'low' },
  { token: 'south indian are', weight: 0.65, dimension: 'regional', severity: 'medium' },
  { token: 'outsider worker', weight: 0.55, dimension: 'regional', severity: 'medium' },
  { token: 'anti-marathi', weight: 0.70, dimension: 'regional', severity: 'high' },
  { token: 'bhaiya people', weight: 0.75, dimension: 'regional', severity: 'high' },
  { token: 'immigrant labour', weight: 0.50, dimension: 'regional', severity: 'medium' },
  { token: 'alien worker', weight: 0.55, dimension: 'regional', severity: 'medium' },
  { token: 'local vs outsider', weight: 0.60, dimension: 'regional', severity: 'medium' },
  { token: 'son of the soil', weight: 0.55, dimension: 'regional', severity: 'medium' },
  { token: 'linguistic chauvinism', weight: 0.80, dimension: 'regional', severity: 'high' },
  { token: 'hindi imperialism', weight: 0.70, dimension: 'regional', severity: 'high' },

  // ── Economic dimension ───────────────────────────────────────────────────
  { token: 'poor people commit', weight: 0.85, dimension: 'economic', severity: 'critical' },
  { token: 'poverty breeds crime', weight: 0.88, dimension: 'economic', severity: 'critical' },
  { token: 'slum dweller', weight: 0.55, dimension: 'economic', severity: 'medium' },
  { token: 'street criminal', weight: 0.65, dimension: 'economic', severity: 'medium' },
  { token: 'rich can afford', weight: 0.55, dimension: 'economic', severity: 'medium' },
  { token: 'afford bail', weight: 0.45, dimension: 'economic', severity: 'low' },
  { token: 'elite clientele', weight: 0.40, dimension: 'economic', severity: 'low' },
  { token: 'destitute accused', weight: 0.60, dimension: 'economic', severity: 'medium' },
  { token: 'beggar class', weight: 0.80, dimension: 'economic', severity: 'high' },
  { token: 'labour class crime', weight: 0.72, dimension: 'economic', severity: 'high' },
  { token: 'white collar vs', weight: 0.55, dimension: 'economic', severity: 'medium' },

  // ── Legal outcome dimension ──────────────────────────────────────────────
  { token: 'obviously guilty', weight: 0.88, dimension: 'legalOutcome', severity: 'critical' },
  { token: 'clearly committed', weight: 0.82, dimension: 'legalOutcome', severity: 'high' },
  { token: 'undoubtedly the culprit', weight: 0.90, dimension: 'legalOutcome', severity: 'critical' },
  { token: 'must be convicted', weight: 0.92, dimension: 'legalOutcome', severity: 'critical' },
  { token: 'definitely did it', weight: 0.85, dimension: 'legalOutcome', severity: 'high' },
  { token: 'has to be sentenced', weight: 0.88, dimension: 'legalOutcome', severity: 'critical' },
  { token: 'no doubt criminal', weight: 0.90, dimension: 'legalOutcome', severity: 'critical' },
  { token: 'deserve imprisonment', weight: 0.75, dimension: 'legalOutcome', severity: 'high' },
  { token: 'should be hanged', weight: 0.95, dimension: 'legalOutcome', severity: 'critical' },
  { token: 'obviously innocent', weight: 0.70, dimension: 'legalOutcome', severity: 'high' },
  { token: 'will be acquitted', weight: 0.55, dimension: 'legalOutcome', severity: 'medium' },
  { token: 'biased judgment', weight: 0.65, dimension: 'legalOutcome', severity: 'medium' },
  { token: 'predetermined verdict', weight: 0.85, dimension: 'legalOutcome', severity: 'high' },
  { token: 'judge already decided', weight: 0.88, dimension: 'legalOutcome', severity: 'critical' },
];

// ─── Negation tokens that flip/reduce a signal ────────────────────────────
const NEGATION_TOKENS = ['not', 'never', 'no', 'without', 'denying', 'reject', 'false'];

// ─── Severity to numeric weight ───────────────────────────────────────────
const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 1.0,
  high: 0.8,
  medium: 0.55,
  low: 0.30,
};

// ─── Mitigation messages by dimension ─────────────────────────────────────
const MITIGATIONS: Record<BiasDimension, string> = {
  gender:       'Use gender-neutral language. Avoid gendered role assumptions in legal framing.',
  caste:        'Avoid caste-identifying labels. Focus on legal rights and universal applicability.',
  religious:    'Remove faith-based characterizations. Apply neutrality across all religious groups.',
  regional:     'Eliminate regional/linguistic stereotypes. Legal analysis must transcend geography.',
  economic:     'Avoid economic-class assumptions in outcome prediction. Every person deserves equal legal analysis.',
  legalOutcome: 'Remove presumptive language. Maintain presumption of innocence until proven otherwise.',
};

// ─── Core scoring engine ───────────────────────────────────────────────────

class NvBiasDetector {
  private readonly dimensionList: BiasDimension[] = [
    'gender', 'caste', 'religious', 'regional', 'economic', 'legalOutcome',
  ];

  /**
   * Tokenise text into lowercase bigrams + trigrams + unigrams.
   * Returns a map of ngram → normalised frequency.
   */
  private tokenise(text: string): Map<string, number> {
    const clean = text.toLowerCase().replace(/[^\w\s]/g, ' ');
    const words = clean.split(/\s+/).filter(Boolean);
    const freq = new Map<string, number>();

    for (let i = 0; i < words.length; i++) {
      const unigram = words[i];
      freq.set(unigram, (freq.get(unigram) || 0) + 1);

      if (i + 1 < words.length) {
        const bigram = `${words[i]} ${words[i + 1]}`;
        freq.set(bigram, (freq.get(bigram) || 0) + 1);
      }

      if (i + 2 < words.length) {
        const trigram = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
        freq.set(trigram, (freq.get(trigram) || 0) + 1);
      }
    }

    return freq;
  }

  /**
   * Check if a negation word precedes a feature within a 3-word window.
   */
  private isNegated(text: string, featureToken: string): boolean {
    const idx = text.toLowerCase().indexOf(featureToken.toLowerCase());
    if (idx === -1) return false;
    const preceding = text.slice(Math.max(0, idx - 30), idx).toLowerCase();
    return NEGATION_TOKENS.some(neg => preceding.includes(neg));
  }

  /**
   * Score a single dimension against tokenised text.
   */
  private scoreDimension(
    dimension: BiasDimension,
    text: string,
    ngrams: Map<string, number>,
    wordCount: number,
  ): DimensionScore {
    const features = LEXICON.filter(f => f.dimension === dimension);
    const signals: string[] = [];
    let rawScore = 0;
    let signalCount = 0;

    for (const feature of features) {
      const freq = ngrams.get(feature.token) || 0;
      if (freq === 0) continue;

      const negated = this.isNegated(text, feature.token);
      const effectiveWeight = negated
        ? feature.weight * 0.15  // negation reduces but doesn't eliminate
        : feature.weight;

      const severityBoost = SEVERITY_WEIGHT[feature.severity] || 0.5;

      // TF-style: more occurrences = higher signal, but logarithmically damped
      const tfSignal = effectiveWeight * severityBoost * (1 + Math.log(freq + 1));
      rawScore += tfSignal;
      signalCount++;
      signals.push(negated ? `[negated] ${feature.token}` : feature.token);
    }

    // Length normalisation: longer texts get slight penalty to avoid inflation
    const lengthFactor = Math.max(0.5, 1 - Math.log(wordCount + 1) * 0.05);
    const normalised = Math.min(100, rawScore * 30 * lengthFactor);

    // Confidence scales with signal count and text length
    const confidence = Math.min(1, signalCount * 0.25 + (wordCount > 50 ? 0.2 : 0));

    const severity = this.scoreToSeverity(normalised);

    return {
      dimension,
      score: Math.round(normalised * 10) / 10,
      confidence: Math.round(confidence * 100) / 100,
      signals,
      severity,
      mitigation: MITIGATIONS[dimension],
    };
  }

  private scoreToSeverity(score: number): 'none' | 'low' | 'medium' | 'high' | 'critical' {
    if (score < 10) return 'none';
    if (score < 25) return 'low';
    if (score < 50) return 'medium';
    if (score < 75) return 'high';
    return 'critical';
  }

  /**
   * Main analysis entry point.
   */
  async analyse(text: string, agentKey?: string, sessionId?: string): Promise<BiasAnalysisResult> {
    const words = text.split(/\s+/).filter(Boolean);
    const wordCount = words.length;
    const ngrams = this.tokenise(text);

    const dimensions: DimensionScore[] = this.dimensionList.map(dim =>
      this.scoreDimension(dim, text, ngrams, wordCount),
    );

    // Weighted composite: legalOutcome and religious weighted slightly higher
    const weights: Record<BiasDimension, number> = {
      gender: 1.0,
      caste: 1.0,
      religious: 1.2,
      regional: 0.8,
      economic: 0.9,
      legalOutcome: 1.3,
    };

    const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
    const compositeScore = dimensions.reduce((sum, d) => {
      return sum + d.score * (weights[d.dimension] || 1.0);
    }, 0) / totalWeight;

    const roundedComposite = Math.round(compositeScore * 10) / 10;
    const overallSeverity = this.scoreToSeverity(roundedComposite);
    const flagged = roundedComposite > 30;

    const allSignals = dimensions.flatMap(d => d.signals);
    const signalCount = allSignals.length;

    const avgConfidence = dimensions.reduce((s, d) => s + d.confidence, 0) / dimensions.length;

    const flaggedDimensions = dimensions.filter(d => d.score > 20).map(d => d.dimension);
    const mitigationSummary = flaggedDimensions.length > 0
      ? `Bias detected in: ${flaggedDimensions.join(', ')}. ${dimensions.find(d => d.score === Math.max(...dimensions.map(x => x.score)))?.mitigation || ''}`
      : 'No significant bias signals detected. Content appears neutral for legal use.';

    const result: BiasAnalysisResult = {
      compositeScore: roundedComposite,
      overallSeverity,
      dimensions,
      flagged,
      confidence: Math.round(avgConfidence * 100) / 100,
      textLength: wordCount,
      signalCount,
      analysedAt: new Date().toISOString(),
      mitigationSummary,
      rawSignals: allSignals.slice(0, 20),
    };

    // Persist to DB async (non-blocking)
    this.persist(result, agentKey, sessionId).catch(() => {});

    return result;
  }

  /**
   * Persist analysis to bias_analysis_log table.
   */
  private async persist(
    result: BiasAnalysisResult,
    agentKey?: string,
    sessionId?: string,
  ): Promise<void> {
    try {
      await db.execute(sql`
        INSERT INTO nv_schema.bias_analysis_log
          (agent_key, session_id, composite_score, overall_severity, flagged,
           dimension_scores, signal_count, analysed_at)
        VALUES
          (${agentKey || null}, ${sessionId || null}, ${result.compositeScore},
           ${result.overallSeverity}, ${result.flagged},
           ${JSON.stringify(result.dimensions)}, ${result.signalCount},
           NOW())
        ON CONFLICT DO NOTHING
      `);
    } catch {
      // Table may not exist yet — silently ignore
    }
  }

  /**
   * Retrieve historical bias analysis for an agent.
   */
  async getHistory(agentKey: string, limit = 50): Promise<any[]> {
    try {
      await this.ensureTable();
      const result = await db.execute(sql`
        SELECT id, agent_key, session_id, composite_score, overall_severity, flagged,
               dimension_scores, signal_count, analysed_at
        FROM nv_schema.bias_analysis_log
        WHERE agent_key = ${agentKey}
        ORDER BY analysed_at DESC
        LIMIT ${limit}
      `);
      return result.rows || [];
    } catch {
      return [];
    }
  }

  /**
   * Get aggregate bias stats for an agent.
   */
  async getAggregateStats(agentKey: string): Promise<{
    totalAnalyses: number;
    avgCompositeScore: number;
    flaggedCount: number;
    lastAnalysedAt: string | null;
  }> {
    try {
      await this.ensureTable();
      const result = await db.execute(sql`
        SELECT
          COUNT(*) AS total,
          AVG(composite_score) AS avg_score,
          SUM(CASE WHEN flagged THEN 1 ELSE 0 END) AS flagged_count,
          MAX(analysed_at) AS last_analysed
        FROM nv_schema.bias_analysis_log
        WHERE agent_key = ${agentKey}
      `);
      const row = result.rows?.[0] as any;
      return {
        totalAnalyses: Number(row?.total || 0),
        avgCompositeScore: Math.round(Number(row?.avg_score || 0) * 10) / 10,
        flaggedCount: Number(row?.flagged_count || 0),
        lastAnalysedAt: row?.last_analysed ? new Date(row.last_analysed).toISOString() : null,
      };
    } catch {
      return { totalAnalyses: 0, avgCompositeScore: 0, flaggedCount: 0, lastAnalysedAt: null };
    }
  }

  private async ensureTable(): Promise<void> {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS nv_schema.bias_analysis_log (
        id SERIAL PRIMARY KEY,
        agent_key TEXT,
        session_id TEXT,
        composite_score FLOAT,
        overall_severity TEXT,
        flagged BOOLEAN DEFAULT FALSE,
        dimension_scores JSONB DEFAULT '[]',
        signal_count INT DEFAULT 0,
        analysed_at TIMESTAMPTZ DEFAULT NOW()
      )
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_bias_log_agent ON nv_schema.bias_analysis_log(agent_key, analysed_at DESC)
    `).catch(() => {});
  }
}

export const nvBiasDetector = new NvBiasDetector();
export default nvBiasDetector;
