/**
 * Regulatory intelligence — SSoT = own feed RDS (nv_regulatory_feeds) + legal-intel digests.
 * NO Tavily. Empty only when DB has no rows (reason: no_data).
 */
import { createLogger } from '../../utils/logger.js';
import { listOwnRegulatoryUpdates } from '../jrx-own-regulatory-feed-ingest.js';

const logger = createLogger('./jrx-regulatory-intelligence-service');

type JurisdictionCode = 'IN' | 'UK' | 'EU' | 'US' | 'GCC' | 'SG';
type LegalDomain = 'criminal' | 'civil' | 'corporate' | 'tax' | 'ip' | 'family' | 'constitutional' | 'labour' | 'banking' | 'other';

interface RegulatoryDigest {
  jurisdiction: JurisdictionCode;
  period: { start: Date; end: Date };
  updates: RegulatoryUpdate[];
  totalUpdates: number;
  criticalCount: number;
  generatedAt: Date;
  source: string;
  reason?: string;
}

interface RegulatoryUpdate {
  id: string;
  title: string;
  source: string;
  jurisdiction: JurisdictionCode;
  domain: LegalDomain;
  severity: 'informational' | 'moderate' | 'significant' | 'critical';
  effectiveDate: Date;
  summary: string;
  affectedAreas: string[];
  sourceUrl?: string;
  storageKey?: string | null;
}

interface ChangeTimeline {
  jurisdiction: JurisdictionCode;
  domain: LegalDomain;
  events: { date: Date; description: string; severity: string }[];
  reason?: string;
}

interface ComplianceCalendar {
  jurisdiction: JurisdictionCode;
  deadlines: ComplianceDeadline[];
}

interface ComplianceDeadline {
  date: Date;
  description: string;
  authority: string;
  domain: LegalDomain;
  penalty: string;
  isRecurring: boolean;
}

interface ChangeFilters {
  jurisdictions: JurisdictionCode[];
  domains?: LegalDomain[];
  minSeverity?: string;
}

interface Subscription {
  id: string;
  userId: string;
  filters: ChangeFilters;
  createdAt: Date;
  active: boolean;
  reason: string;
}

function mapSeverity(raw: string | undefined): RegulatoryUpdate['severity'] {
  const s = String(raw || '').toLowerCase();
  if (s.includes('critical')) return 'critical';
  if (s.includes('significant') || s.includes('major')) return 'significant';
  if (s.includes('moderate')) return 'moderate';
  return 'informational';
}

class NvRegulatoryIntelligenceService {
  async getRegulatoryDigest(jurisdiction: JurisdictionCode, days: number): Promise<RegulatoryDigest> {
    logger.info({ method: 'getRegulatoryDigest', jurisdiction, days });
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);

    const listed = await listOwnRegulatoryUpdates(jurisdiction, 80);
    const updates: RegulatoryUpdate[] = listed.updates.map((u) => ({
      id: String(u.id),
      title: String(u.title),
      source: String(u.source || 'own-feed'),
      jurisdiction: (u.jurisdiction || jurisdiction) as JurisdictionCode,
      domain: 'other' as LegalDomain,
      severity: mapSeverity(String(u.severity || '')),
      effectiveDate: u.publishedAt ? new Date(String(u.publishedAt)) : new Date(),
      summary: String(u.summary || ''),
      affectedAreas: [],
      sourceUrl: u.sourceUrl ? String(u.sourceUrl) : undefined,
      storageKey: (u as any).storageKey ?? null,
    }));

    // Prefer legal-intel digest items when RDS feed table is sparse
    if (updates.length < 3) {
      try {
        const { getLegalIntelligenceFeed } = await import('../jrx-legal-intelligence-feed-service.js');
        const digest = await getLegalIntelligenceFeed({ jurisdiction, limit: 20 });
        for (const item of digest?.items || []) {
          updates.push({
            id: String(item.id || `digest-${item.rank}`),
            title: item.title,
            source: item.sourceName || 'legal-intel-digest',
            jurisdiction,
            domain: 'other',
            severity: 'informational',
            effectiveDate: item.publishedAt ? new Date(item.publishedAt) : new Date(),
            summary: item.summary,
            affectedAreas: item.tags || [],
            sourceUrl: item.sourceUrl || undefined,
          });
        }
      } catch (err: any) {
        logger.warn({ method: 'getRegulatoryDigest', digestFallback: err?.message });
      }
    }

    const dedup = new Map<string, RegulatoryUpdate>();
    for (const u of updates) {
      const key = u.sourceUrl || u.title;
      if (!dedup.has(key)) dedup.set(key, u);
    }
    const finalUpdates = Array.from(dedup.values()).slice(0, 50);

    return {
      jurisdiction,
      period: { start, end },
      updates: finalUpdates,
      totalUpdates: finalUpdates.length,
      criticalCount: finalUpdates.filter((u) => u.severity === 'critical').length,
      generatedAt: new Date(),
      source: 'own-rds+legal-intel',
      reason: finalUpdates.length ? undefined : listed.reason || 'no_data',
    };
  }

  /** Alias used by Queen capability factory. */
  async fetchUpdates(input: { jurisdiction?: string; limit?: number }): Promise<RegulatoryDigest> {
    return this.getRegulatoryDigest((input.jurisdiction || 'IN') as JurisdictionCode, 30);
  }

  async list(input: { jurisdiction?: string; limit?: number }): Promise<RegulatoryDigest> {
    return this.fetchUpdates(input);
  }

  async search(input: { jurisdiction?: string; limit?: number }): Promise<RegulatoryDigest> {
    return this.fetchUpdates(input);
  }

  async getChangeTimeline(jurisdiction: JurisdictionCode, domain: LegalDomain): Promise<ChangeTimeline> {
    const digest = await this.getRegulatoryDigest(jurisdiction, 90);
    return {
      jurisdiction,
      domain,
      events: digest.updates.map((u) => ({
        date: u.effectiveDate,
        description: u.title,
        severity: u.severity,
      })),
      reason: digest.reason,
    };
  }

  async getComplianceCalendar(jurisdiction: JurisdictionCode): Promise<ComplianceCalendar> {
    logger.info({ method: 'getComplianceCalendar', jurisdiction });
    const deadlines: ComplianceDeadline[] = [];
    if (jurisdiction === 'IN') {
      deadlines.push(
        { date: new Date('2026-07-31'), description: 'Income Tax Return filing deadline (non-audit)', authority: 'CBDT', domain: 'tax', penalty: 'Rs. 5,000 late fee u/s 234F', isRecurring: true },
        { date: new Date('2026-10-31'), description: 'Income Tax Return filing deadline (audit)', authority: 'CBDT', domain: 'tax', penalty: 'Rs. 5,000 late fee u/s 234F', isRecurring: true },
        { date: new Date('2026-09-30'), description: 'Annual Return filing (Companies Act)', authority: 'MCA', domain: 'corporate', penalty: 'Rs. 100/day penalty', isRecurring: true },
      );
    }
    return { jurisdiction, deadlines };
  }

  async subscribeToChanges(userId: string, filters: ChangeFilters): Promise<Subscription> {
    // Persistence of subscriptions is Phase C — honest reason, not fake success.
    return {
      id: `sub-pending-${Date.now()}`,
      userId,
      filters,
      createdAt: new Date(),
      active: false,
      reason: 'subscription_persistence_phase_c',
    };
  }
}

export const nvRegulatoryIntelligenceService = new NvRegulatoryIntelligenceService();
export const regulatoryIntelligenceService = nvRegulatoryIntelligenceService;
