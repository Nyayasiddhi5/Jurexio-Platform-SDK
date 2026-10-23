import crypto from 'crypto';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('./jrx-conflict-detector-service');

type JurisdictionCode = 'IN' | 'UK' | 'EU' | 'US' | 'GCC' | 'SG';
type ConflictNature = 'direct-contradiction' | 'gap' | 'uncertainty' | 'stricter-requirement';
type ConflictSeverity = 'low' | 'medium' | 'high' | 'critical';
type RiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

interface ConflictDetectionOptions {
  depth?: 'surface' | 'deep';
  includeResolutions?: boolean;
  context?: string;
}

interface ConflictItem {
  conflictType: string;
  jurisdictionA: JurisdictionCode;
  ruleA: string;
  jurisdictionB: JurisdictionCode;
  ruleB: string;
  nature: ConflictNature;
  severity: ConflictSeverity;
  resolution: string[];
}

interface ConflictDetectionReport {
  strategy: string;
  jurisdictionsAnalyzed: JurisdictionCode[];
  conflicts: ConflictItem[];
  resolutionSuggestions: string[];
  riskLevel: RiskLevel;
  traceId: string;
  analyzedAt: Date;
}

interface JurisdictionRule {
  jurisdiction: JurisdictionCode;
  domain: string;
  rule: string;
  statute: string;
  description: string;
}

const KNOWN_CONFLICT_PATTERNS: ConflictItem[] = [
  {
    conflictType: 'data-transfer',
    jurisdictionA: 'UK',
    ruleA: 'UK GDPR — data transfers require adequacy decision or SCCs',
    jurisdictionB: 'US',
    ruleB: 'CLOUD Act — US government can compel data disclosure from US companies globally',
    nature: 'direct-contradiction',
    severity: 'critical',
    resolution: ['Use EU-US Data Privacy Framework', 'Implement supplementary measures (encryption)', 'Store data only in UK jurisdiction'],
  },
  {
    conflictType: 'consent-requirements',
    jurisdictionA: 'IN',
    ruleA: 'DPDPA 2023 — consent must be free, specific, informed, unconditional, unambiguous',
    jurisdictionB: 'EU',
    ruleB: 'GDPR Art.7 — consent must be freely given, specific, informed, unambiguous + right to withdraw',
    nature: 'stricter-requirement',
    severity: 'medium',
    resolution: ['Adopt stricter standard (GDPR) as baseline', 'Implement jurisdiction-specific consent flows', 'Document compliance with both frameworks'],
  },
  {
    conflictType: 'islamic-finance',
    jurisdictionA: 'GCC',
    ruleA: 'Islamic finance — prohibition of riba (interest) in financial transactions',
    jurisdictionB: 'EU',
    ruleB: 'MiFID II — interest-bearing instruments are standard in EU financial regulation',
    nature: 'direct-contradiction',
    severity: 'high',
    resolution: ['Use Sharia-compliant financial instruments (sukuk, murabaha)', 'Separate GCC and EU financial operations', 'Engage dual-qualified advisors'],
  },
  {
    conflictType: 'detention-duration',
    jurisdictionA: 'IN',
    ruleA: 'BNSS 2023 — police custody up to 15 days, judicial custody up to 60/90 days',
    jurisdictionB: 'UK',
    ruleB: 'PACE 1984 — pre-charge detention max 96 hours (terrorism: 14 days)',
    nature: 'stricter-requirement',
    severity: 'high',
    resolution: ['Apply stricter UK standard for cross-border matters', 'Ensure legal representation available per both frameworks'],
  },
  {
    conflictType: 'data-localization',
    jurisdictionA: 'IN',
    ruleA: 'DPDPA 2023 — government may restrict data transfers to certain countries',
    jurisdictionB: 'SG',
    ruleB: 'PDPA — data transfers allowed with comparable protection or consent',
    nature: 'uncertainty',
    severity: 'medium',
    resolution: ['Monitor DPDPA transfer restriction notifications', 'Implement data localization in India for restricted categories', 'Use SG as APAC processing hub with contractual safeguards'],
  },
];

class NvConflictDetectorService {
  async detectConflicts(
    strategy: string,
    jurisdictions: JurisdictionCode[],
    options: ConflictDetectionOptions = {}
  ): Promise<ConflictDetectionReport> {
    const traceId = `cdt-${crypto.randomBytes(8).toString('hex')}`;
    logger.info({ method: 'detectConflicts', strategy, jurisdictions, traceId });

    const conflicts: ConflictItem[] = [];

    for (let i = 0; i < jurisdictions.length; i++) {
      for (let j = i + 1; j < jurisdictions.length; j++) {
        const pairConflicts = this.findKnownConflicts(jurisdictions[i], jurisdictions[j], strategy);
        conflicts.push(...pairConflicts);
      }
    }

    const strategyLower = strategy.toLowerCase();
    if (strategyLower.includes('data') || strategyLower.includes('transfer') || strategyLower.includes('privacy')) {
      const dataConflicts = KNOWN_CONFLICT_PATTERNS.filter(c =>
        c.conflictType.includes('data') || c.conflictType.includes('consent')
      ).filter(c =>
        jurisdictions.includes(c.jurisdictionA) && jurisdictions.includes(c.jurisdictionB)
      );
      for (const dc of dataConflicts) {
        if (!conflicts.find(c => c.conflictType === dc.conflictType && c.jurisdictionA === dc.jurisdictionA && c.jurisdictionB === dc.jurisdictionB)) {
          conflicts.push(dc);
        }
      }
    }

    let riskLevel: RiskLevel = 'none';
    if (conflicts.length > 0) {
      const maxSeverity = conflicts.reduce((max, c) => {
        const order: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
        return (order[c.severity] || 0) > (order[max] || 0) ? c.severity : max;
      }, 'low' as string);
      riskLevel = maxSeverity as RiskLevel;
    }

    const resolutionSuggestions = [...new Set(conflicts.flatMap(c => c.resolution))];

    return {
      strategy,
      jurisdictionsAnalyzed: jurisdictions,
      conflicts,
      resolutionSuggestions,
      riskLevel,
      traceId,
      analyzedAt: new Date(),
    };
  }

  private findKnownConflicts(jurisdictionA: JurisdictionCode, jurisdictionB: JurisdictionCode, strategy: string): ConflictItem[] {
    return KNOWN_CONFLICT_PATTERNS.filter(c =>
      (c.jurisdictionA === jurisdictionA && c.jurisdictionB === jurisdictionB) ||
      (c.jurisdictionA === jurisdictionB && c.jurisdictionB === jurisdictionA)
    );
  }

  private async loadJurisdictionRules(jurisdiction: JurisdictionCode): Promise<JurisdictionRule[]> {
    const rules: Record<JurisdictionCode, JurisdictionRule[]> = {
      'IN': [
        { jurisdiction: 'IN', domain: 'data-protection', rule: 'DPDPA 2023', statute: 'Digital Personal Data Protection Act 2023', description: 'India data protection framework' },
        { jurisdiction: 'IN', domain: 'criminal', rule: 'BNS 2023', statute: 'Bharatiya Nyaya Sanhita 2023', description: 'Criminal law' },
      ],
      'UK': [
        { jurisdiction: 'UK', domain: 'data-protection', rule: 'UK GDPR + DPA 2018', statute: 'Data Protection Act 2018', description: 'UK data protection framework' },
      ],
      'EU': [
        { jurisdiction: 'EU', domain: 'data-protection', rule: 'GDPR', statute: 'General Data Protection Regulation', description: 'EU data protection framework' },
      ],
      'US': [
        { jurisdiction: 'US', domain: 'data-access', rule: 'CLOUD Act', statute: 'Clarifying Lawful Overseas Use of Data Act', description: 'US cross-border data access' },
      ],
      'GCC': [
        { jurisdiction: 'GCC', domain: 'finance', rule: 'Islamic Finance Principles', statute: 'Sharia-compliant finance regulations', description: 'Islamic finance framework' },
      ],
      'SG': [
        { jurisdiction: 'SG', domain: 'data-protection', rule: 'PDPA', statute: 'Personal Data Protection Act 2012', description: 'Singapore data protection' },
      ],
    };
    return rules[jurisdiction] || [];
  }

  private async analyzeConflict(ruleA: JurisdictionRule, ruleB: JurisdictionRule): Promise<ConflictItem | null> {
    if (ruleA.domain !== ruleB.domain) return null;

    return {
      conflictType: ruleA.domain,
      jurisdictionA: ruleA.jurisdiction,
      ruleA: ruleA.rule,
      jurisdictionB: ruleB.jurisdiction,
      ruleB: ruleB.rule,
      nature: 'uncertainty',
      severity: 'medium',
      resolution: ['Consult jurisdiction-specific legal counsel', 'Apply stricter standard as baseline'],
    };
  }
}

export const nvConflictDetectorService = new NvConflictDetectorService();
