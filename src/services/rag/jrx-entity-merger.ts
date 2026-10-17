/**
 * JRX Legal Entity Merger v1.0.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Inspired by LightRAG's entity merging: semantic deduplication of legal entities
 * with legal-domain-aware normalization, alias resolution, and BNS/BNSS/BSA
 * statute mapping.
 *
 * MERGE STRATEGIES:
 *   1. Exact Normalization  — case/punctuation/whitespace insensitive matching
 *   2. Alias Resolution     — "IPC" ↔ "Indian Penal Code" ↔ "BNS 2023" (supersession)
 *   3. Jaccard Similarity   — token-level overlap for fuzzy matching (threshold: 0.7)
 *   4. Statute Supersession — maps old statutes to BNS/BNSS/BSA 2023 equivalents
 *   5. Section Mapping      — Section 302 IPC → Section 103 BNS 2023
 *
 * LEGAL-AWARE NORMALIZATION:
 *   - Removes case variations: "SEBI" = "Securities and Exchange Board of India"
 *   - Handles statute year variations: "Companies Act" = "Companies Act 2013"
 *   - Normalizes court names: "SC" = "Supreme Court of India"
 *   - Maps deprecated to current statutes
 *
 * TOKEN OPTIMIZATION: Cleaner graph = fewer redundant retrieval results = fewer tokens
 *
 * @module jrx-entity-merger
 * @version 1.0.0
 */

import crypto from 'crypto';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('jrx-entity-merger');

export interface MergeableEntity {
  id: string;
  type: string;
  value: string;
  normalizedValue: string;
  aliases: string[];
  jurisdiction?: string;
  docIds: string[];
  importance: number;
  metadata: Record<string, unknown>;
}

export interface MergeResult {
  totalEntities: number;
  mergedCount: number;
  mergeGroups: MergeGroup[];
  processingTimeMs: number;
  statueRemappings: number;
  aliasesResolved: number;
}

export interface MergeGroup {
  canonicalId: string;
  canonicalValue: string;
  mergedIds: string[];
  mergedValues: string[];
  mergeReason: string;
  confidence: number;
}

export interface EntityMergerConfig {
  jaccardThreshold: number;
  enableStatuteSupersession: boolean;
  enableAliasResolution: boolean;
  enableFuzzyMatching: boolean;
  maxMergeGroupSize: number;
  preserveJurisdictionBoundaries: boolean;
}

const DEFAULT_CONFIG: EntityMergerConfig = {
  jaccardThreshold: 0.7,
  enableStatuteSupersession: true,
  enableAliasResolution: true,
  enableFuzzyMatching: true,
  maxMergeGroupSize: 10,
  preserveJurisdictionBoundaries: false,
};

const STATUTE_SUPERSESSION_MAP: Record<string, { current: string; year: number; type: string }> = {
  'indian penal code': { current: 'Bharatiya Nyaya Sanhita', year: 2023, type: 'statute' },
  'ipc': { current: 'Bharatiya Nyaya Sanhita', year: 2023, type: 'statute' },
  'ipc 1860': { current: 'Bharatiya Nyaya Sanhita', year: 2023, type: 'statute' },
  'code of criminal procedure': { current: 'Bharatiya Nagarik Suraksha Sanhita', year: 2023, type: 'statute' },
  'crpc': { current: 'Bharatiya Nagarik Suraksha Sanhita', year: 2023, type: 'statute' },
  'crpc 1973': { current: 'Bharatiya Nagarik Suraksha Sanhita', year: 2023, type: 'statute' },
  'evidence act': { current: 'Bharatiya Sakshya Adhiniyam', year: 2023, type: 'statute' },
  'indian evidence act': { current: 'Bharatiya Sakshya Adhiniyam', year: 2023, type: 'statute' },
  'evidence act 1872': { current: 'Bharatiya Sakshya Adhiniyam', year: 2023, type: 'statute' },
};

const SECTION_MAPPING_IPC_TO_BNS: Record<string, string> = {
  '299': '100', '300': '101', '302': '103', '304': '105', '304a': '106',
  '304b': '80', '306': '108', '307': '109', '308': '110', '309': '111',
  '319': '114', '320': '115', '321': '116', '322': '117', '323': '115',
  '324': '118', '325': '119', '326': '120', '354': '74', '354a': '75',
  '363': '137', '365': '140', '366': '88', '370': '143', '375': '63',
  '376': '64', '377': '65', '378': '303', '379': '303', '380': '305',
  '381': '306', '384': '308', '390': '309', '392': '309', '395': '310',
  '396': '310', '397': '310', '398': '310', '399': '310', '406': '316',
  '415': '318', '417': '319', '418': '319', '420': '316', '463': '336',
  '464': '337', '465': '338', '468': '340', '471': '341', '489a': '178',
  '497': '', '498a': '85', '499': '356', '500': '357', '503': '351',
  '504': '352', '506': '351', '509': '79',
};

const ALIAS_MAP: Record<string, string[]> = {
  'bharatiya nyaya sanhita': ['bns', 'bns 2023', 'indian penal code', 'ipc'],
  'bharatiya nagarik suraksha sanhita': ['bnss', 'bnss 2023', 'code of criminal procedure', 'crpc'],
  'bharatiya sakshya adhiniyam': ['bsa', 'bsa 2023', 'evidence act', 'indian evidence act'],
  'companies act 2013': ['companies act', 'co act 2013'],
  'sebi act 1992': ['sebi act', 'securities and exchange board of india act'],
  'income tax act 1961': ['income tax act', 'it act 1961'],
  'goods and services tax act 2017': ['gst act', 'cgst act', 'sgst act', 'igst act'],
  'insolvency and bankruptcy code 2016': ['ibc', 'ibc 2016', 'insolvency code'],
  'digital personal data protection act 2023': ['dpdpa', 'dpdpa 2023', 'data protection act'],
  'information technology act 2000': ['it act', 'it act 2000'],
  'real estate regulation act 2016': ['rera', 'rera 2016'],
  'prevention of money laundering act 2002': ['pmla', 'pmla 2002'],
  'foreign exchange management act 1999': ['fema', 'fema 1999'],
  'arbitration and conciliation act 1996': ['arbitration act', 'a&c act'],
  'supreme court of india': ['sc', 'supreme court', 'hon\'ble supreme court', 'apex court'],
  'general data protection regulation': ['gdpr', 'eu gdpr'],
  'california consumer privacy act': ['ccpa'],
  'health insurance portability act': ['hipaa'],
};

export class JrxEntityMerger {
  private config: EntityMergerConfig;
  private reverseAliasMap: Map<string, string> = new Map();
  private mergeHistory: MergeGroup[] = [];

  constructor(config: Partial<EntityMergerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.buildReverseAliasMap();
    logger.info('[EntityMerger] Initialized', {
      jaccardThreshold: this.config.jaccardThreshold,
      statuteSupersession: this.config.enableStatuteSupersession,
      aliasResolution: this.config.enableAliasResolution,
    });
  }

  private buildReverseAliasMap(): void {
    for (const [canonical, aliases] of Object.entries(ALIAS_MAP)) {
      for (const alias of aliases) {
        this.reverseAliasMap.set(alias.toLowerCase(), canonical);
      }
      this.reverseAliasMap.set(canonical, canonical);
    }
  }

  merge(entities: MergeableEntity[]): MergeResult {
    const start = Date.now();
    const mergeGroups: MergeGroup[] = [];
    let statueRemappings = 0;
    let aliasesResolved = 0;

    if (this.config.enableStatuteSupersession) {
      const result = this.applyStatuteSupersession(entities);
      statueRemappings = result.remappings;
      entities = result.entities;
    }

    const normalized = entities.map(e => ({
      ...e,
      normalizedValue: this.legalNormalize(e.value),
    }));

    const groups = new Map<string, MergeableEntity[]>();
    const assigned = new Set<string>();

    for (const entity of normalized) {
      if (assigned.has(entity.id)) continue;

      const groupKey = this.findGroupKey(entity, groups, normalized, assigned);

      if (groupKey) {
        groups.get(groupKey)!.push(entity);
        assigned.add(entity.id);
      } else {
        groups.set(entity.id, [entity]);
        assigned.add(entity.id);
      }
    }

    for (const [canonicalId, group] of groups) {
      if (group.length <= 1) continue;

      const canonical = group.reduce((best, e) =>
        e.importance > best.importance ? e : best
      );

      const mergeGroup: MergeGroup = {
        canonicalId: canonical.id,
        canonicalValue: canonical.value,
        mergedIds: group.filter(e => e.id !== canonical.id).map(e => e.id),
        mergedValues: group.filter(e => e.id !== canonical.id).map(e => e.value),
        mergeReason: this.determineMergeReason(canonical, group),
        confidence: this.computeGroupConfidence(group),
      };

      mergeGroups.push(mergeGroup);
      aliasesResolved += mergeGroup.mergedIds.length;

      for (const merged of group) {
        if (merged.id !== canonical.id) {
          for (const docId of merged.docIds) {
            if (!canonical.docIds.includes(docId)) canonical.docIds.push(docId);
          }
          if (!canonical.aliases.includes(merged.value)) {
            canonical.aliases.push(merged.value);
          }
          canonical.importance = Math.max(canonical.importance, merged.importance);
        }
      }
    }

    this.mergeHistory.push(...mergeGroups);

    const result: MergeResult = {
      totalEntities: entities.length,
      mergedCount: mergeGroups.reduce((sum, g) => sum + g.mergedIds.length, 0),
      mergeGroups,
      processingTimeMs: Date.now() - start,
      statueRemappings,
      aliasesResolved,
    };

    logger.info('[EntityMerger] Merge complete', {
      total: result.totalEntities,
      merged: result.mergedCount,
      groups: result.mergeGroups.length,
      remappings: result.statueRemappings,
    });

    return result;
  }

  private findGroupKey(
    entity: MergeableEntity,
    groups: Map<string, MergeableEntity[]>,
    allEntities: MergeableEntity[],
    assigned: Set<string>
  ): string | null {
    for (const [key, group] of groups) {
      const representative = group[0];
      if (this.config.preserveJurisdictionBoundaries &&
          entity.jurisdiction && representative.jurisdiction &&
          entity.jurisdiction !== representative.jurisdiction) continue;

      if (entity.type !== representative.type) continue;

      if (entity.normalizedValue === representative.normalizedValue) return key;

      if (this.config.enableAliasResolution) {
        const canonicalA = this.reverseAliasMap.get(entity.normalizedValue);
        const canonicalB = this.reverseAliasMap.get(representative.normalizedValue);
        if (canonicalA && canonicalB && canonicalA === canonicalB) return key;
      }

      if (this.config.enableFuzzyMatching) {
        const similarity = this.computeJaccard(entity.normalizedValue, representative.normalizedValue);
        if (similarity >= this.config.jaccardThreshold) return key;
      }
    }

    return null;
  }

  private applyStatuteSupersession(entities: MergeableEntity[]): { entities: MergeableEntity[]; remappings: number } {
    let remappings = 0;

    for (const entity of entities) {
      if (entity.type !== 'statute') continue;
      const normalized = entity.value.toLowerCase().replace(/\s+/g, ' ').trim();
      const supersession = STATUTE_SUPERSESSION_MAP[normalized];
      if (supersession) {
        entity.aliases.push(entity.value);
        entity.value = `${supersession.current} ${supersession.year}`;
        entity.normalizedValue = this.legalNormalize(entity.value);
        entity.metadata.supersededFrom = normalized;
        entity.metadata.supersessionApplied = true;
        remappings++;
      }
    }

    return { entities, remappings };
  }

  mapSectionToCurrentLaw(
    sectionNumber: string,
    fromStatute: string
  ): { currentSection: string; currentStatute: string; confidence: number } | null {
    const fromNormalized = fromStatute.toLowerCase().replace(/\s+/g, ' ').trim();

    if (fromNormalized.includes('ipc') || fromNormalized.includes('indian penal code')) {
      const mapped = SECTION_MAPPING_IPC_TO_BNS[sectionNumber];
      if (mapped !== undefined) {
        return {
          currentSection: mapped || '(repealed)',
          currentStatute: 'Bharatiya Nyaya Sanhita 2023',
          confidence: mapped ? 0.95 : 0.8,
        };
      }
    }

    return null;
  }

  private legalNormalize(value: string): string {
    let normalized = value.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    normalized = normalized
      .replace(/\b(\d{4})\b/g, '') // Remove years for comparison
      .replace(/\bact\b/g, '')
      .replace(/\bthe\b/g, '')
      .replace(/\bof\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    return normalized || value.toLowerCase().trim();
  }

  private computeJaccard(a: string, b: string): number {
    const setA = new Set(a.split(/\s+/));
    const setB = new Set(b.split(/\s+/));
    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  private determineMergeReason(canonical: MergeableEntity, group: MergeableEntity[]): string {
    const hasSupersession = group.some(e => (e.metadata as any).supersessionApplied);
    if (hasSupersession) return 'statute-supersession';

    const hasAlias = group.some(e => {
      const ca = this.reverseAliasMap.get(e.normalizedValue);
      return ca && ca === this.reverseAliasMap.get(canonical.normalizedValue);
    });
    if (hasAlias) return 'alias-resolution';

    return 'jaccard-similarity';
  }

  private computeGroupConfidence(group: MergeableEntity[]): number {
    if (group.length <= 1) return 1;
    const base = 0.7;
    const sizeBonus = Math.min(group.length * 0.05, 0.2);
    return Math.min(1, base + sizeBonus);
  }

  getStats(): {
    totalMergeGroups: number;
    totalMerged: number;
    mergeReasons: Record<string, number>;
  } {
    const reasons: Record<string, number> = {};
    for (const g of this.mergeHistory) {
      reasons[g.mergeReason] = (reasons[g.mergeReason] || 0) + 1;
    }
    return {
      totalMergeGroups: this.mergeHistory.length,
      totalMerged: this.mergeHistory.reduce((sum, g) => sum + g.mergedIds.length, 0),
      mergeReasons: reasons,
    };
  }
}

let entityMergerInstance: JrxEntityMerger | null = null;

export function getEntityMerger(config?: Partial<EntityMergerConfig>): JrxEntityMerger {
  if (!entityMergerInstance) {
    entityMergerInstance = new JrxEntityMerger(config);
  }
  return entityMergerInstance;
}
