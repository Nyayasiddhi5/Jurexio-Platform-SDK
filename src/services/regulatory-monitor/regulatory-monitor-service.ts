/**
 * Jurexio Regulatory Monitor Service v3.1.2
 * NYV-SVC-REGMON-001
 *
 * Real-time regulatory intelligence monitoring for all 6 jurisdictions.
 * Continuously tracks regulatory changes, new statutes, amendments, and
 * enforcement actions — then alerts affected organizations.
 *
 * Monitors:
 *   India:     MoJ, MCA, SEBI, RBI, TRAI, CCI, IRDAI, MoLJ, DPIIT
 *   UK:        FCA, PRA, CMA, ICO, Ofcom, HMRC, Companies House
 *   GCC:       ADGM, DIFC, UAE Central Bank, SCA, CBUAE, SAMA (Saudi)
 *   EU:        EC, ESMA, EBA, EIOPA, EDPB, ENISA, EFSA, ECB
 *   US:        SEC, CFTC, FTC, FCC, CFPB, OCC, FDIC, DOJ, EPA
 *   Singapore: MAS, ACRA, SGX, PDPC, CAAS, Competition Commission of Singapore
 *
 * Alert Categories:
 *   - New legislation enacted
 *   - Existing law amended
 *   - Enforcement action filed
 *   - Consultation paper published (comment period open)
 *   - Deadline approaching (filing, compliance)
 *   - Court ruling with precedential impact
 *   - International treaty / cross-border agreement
 */

import { logger } from '../../utils/logger.js';
import { sql } from 'drizzle-orm';
import { db as rawDb } from '../../db/index.js';
import {
  isTavilyConfigured,
  tavilySweepJurisdiction,
  type TavilyJurisdiction,
  type TavilyNewsItem,
} from './jrx-tavily-client.js';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type JurisdictionCode = 'IN' | 'UK' | 'GC' | 'EU' | 'US' | 'SG';

export type RegulatoryEventType =
  | 'new-legislation'
  | 'law-amendment'
  | 'enforcement-action'
  | 'consultation-paper'
  | 'compliance-deadline'
  | 'court-ruling'
  | 'international-treaty'
  | 'guidance-update'
  | 'penalty-notice'
  | 'industry-alert';

export type AlertSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface RegulatoryEvent {
  id: string;
  jurisdiction: JurisdictionCode;
  regulator: string;                   // e.g., 'MCA', 'FCA', 'SEC'
  type: RegulatoryEventType;
  title: string;
  summary: string;
  effectiveDate?: Date;
  commentDeadline?: Date;
  affectedLaws: string[];              // e.g., ['Companies Act 2013', 'SEBI LODR']
  affectedSectors: string[];           // e.g., ['financial-services', 'fintech', 'all']
  affectedPracticeAreas: string[];     // e.g., ['corporate', 'compliance', 'securities']
  severity: AlertSeverity;
  sourceUrl?: string;
  fullTextUrl?: string;
  aiSummary?: string;                  // NS LRM-generated summary
  impactAssessment?: string;           // AI-generated impact assessment
  publishedAt: Date;
  detectedAt: Date;
  processed: boolean;
}

export interface RegulatoryAlert {
  id: string;
  organizationId: string;
  eventId: string;
  event: RegulatoryEvent;
  relevanceScore: number;             // 0–100 — how relevant to this org
  notified: boolean;
  notifiedAt?: Date;
  dismissed: boolean;
  actionTaken?: string;
  createdAt: Date;
}

export interface MonitoringSubscription {
  id: string;
  organizationId: string;
  jurisdictions: JurisdictionCode[];
  eventTypes: RegulatoryEventType[];
  sectors: string[];
  practiceAreas: string[];
  minimumSeverity: AlertSeverity;
  notificationChannels: Array<{
    type: 'email' | 'webhook' | 'in-app';
    destination: string;
  }>;
  active: boolean;
  createdAt: Date;
}

// ──────────────────────────────────────────────────────────────────────────────
// Regulator Catalogue (canonical list per jurisdiction)
// ──────────────────────────────────────────────────────────────────────────────

export const REGULATORS: Record<JurisdictionCode, Array<{ id: string; name: string; sectors: string[] }>> = {
  IN: [
    { id: 'MCA', name: 'Ministry of Corporate Affairs', sectors: ['corporate', 'all'] },
    { id: 'SEBI', name: 'Securities and Exchange Board of India', sectors: ['securities', 'capital-markets'] },
    { id: 'RBI', name: 'Reserve Bank of India', sectors: ['banking', 'fintech', 'payments'] },
    { id: 'CCI', name: 'Competition Commission of India', sectors: ['competition', 'mergers', 'antitrust'] },
    { id: 'IRDAI', name: 'Insurance Regulatory and Development Authority of India', sectors: ['insurance'] },
    { id: 'TRAI', name: 'Telecom Regulatory Authority of India', sectors: ['telecom', 'media'] },
    { id: 'DPIIT', name: 'Dept for Promotion of Industry and Internal Trade', sectors: ['ip', 'startup', 'trade'] },
    { id: 'MEITY', name: 'Ministry of Electronics and Information Technology', sectors: ['technology', 'data-protection'] },
    { id: 'NCLT', name: 'National Company Law Tribunal', sectors: ['insolvency', 'corporate'] },
  ],
  UK: [
    { id: 'FCA', name: 'Financial Conduct Authority', sectors: ['financial-services', 'fintech', 'crypto'] },
    { id: 'PRA', name: 'Prudential Regulation Authority', sectors: ['banking', 'insurance'] },
    { id: 'CMA', name: 'Competition and Markets Authority', sectors: ['competition', 'mergers'] },
    { id: 'ICO', name: 'Information Commissioner\'s Office', sectors: ['data-protection', 'privacy'] },
    { id: 'Ofcom', name: 'Office of Communications', sectors: ['telecom', 'media', 'online-safety'] },
    { id: 'HMRC', name: 'HM Revenue & Customs', sectors: ['tax', 'all'] },
  ],
  GC: [
    { id: 'ADGM', name: 'Abu Dhabi Global Market', sectors: ['financial-services', 'fintech'] },
    { id: 'DIFC', name: 'Dubai International Financial Centre', sectors: ['financial-services', 'fintech'] },
    { id: 'CBUAE', name: 'Central Bank of the UAE', sectors: ['banking', 'payments'] },
    { id: 'SCA', name: 'Securities and Commodities Authority (UAE)', sectors: ['securities'] },
    { id: 'SAMA', name: 'Saudi Central Bank', sectors: ['banking', 'fintech'] },
    { id: 'ZATCA', name: 'Zakat, Tax and Customs Authority (Saudi)', sectors: ['tax', 'customs'] },
  ],
  EU: [
    { id: 'EC', name: 'European Commission', sectors: ['all'] },
    { id: 'ESMA', name: 'European Securities and Markets Authority', sectors: ['securities', 'capital-markets'] },
    { id: 'EBA', name: 'European Banking Authority', sectors: ['banking', 'fintech'] },
    { id: 'EDPB', name: 'European Data Protection Board', sectors: ['data-protection', 'privacy'] },
    { id: 'ENISA', name: 'EU Agency for Cybersecurity', sectors: ['cybersecurity'] },
    { id: 'ECB', name: 'European Central Bank', sectors: ['banking', 'monetary'] },
    { id: 'EIOPA', name: 'European Insurance and Occupational Pensions Authority', sectors: ['insurance'] },
  ],
  US: [
    { id: 'SEC', name: 'Securities and Exchange Commission', sectors: ['securities', 'capital-markets'] },
    { id: 'CFTC', name: 'Commodity Futures Trading Commission', sectors: ['commodities', 'crypto'] },
    { id: 'FTC', name: 'Federal Trade Commission', sectors: ['competition', 'consumer-protection', 'privacy'] },
    { id: 'OCC', name: 'Office of the Comptroller of the Currency', sectors: ['banking'] },
    { id: 'CFPB', name: 'Consumer Financial Protection Bureau', sectors: ['consumer-finance'] },
    { id: 'DOJ', name: 'Department of Justice', sectors: ['antitrust', 'criminal', 'all'] },
    { id: 'USPTO', name: 'US Patent and Trademark Office', sectors: ['ip', 'patents', 'trademarks'] },
    // task-345: state-privacy + federal-cloud regulators added so the US
    // sweep surfaces VCDPA, CPA, and FedRAMP enforcement / authorisation
    // events distinctly from the FTC / SEC catch-all.
    { id: 'VA-OAG',     name: 'Virginia Office of the Attorney General',  sectors: ['data-protection', 'privacy', 'consumer-protection'] },
    { id: 'CO-AG',      name: 'Colorado Attorney General',                sectors: ['data-protection', 'privacy', 'consumer-protection'] },
    { id: 'FedRAMP-PMO', name: 'FedRAMP Program Management Office (GSA)', sectors: ['cloud', 'federal', 'cybersecurity'] },
    // task-399: post-CCPA-wave state privacy regulators (CTDPA, UCPA, TDPSA,
    // OCPA, DE-PDPA). Inserted alongside VA-OAG / CO-AG so the US sweep
    // surfaces enforcement events under the right statutory bucket instead
    // of being absorbed by the FTC catch-all.
    { id: 'CT-OAG',     name: 'Connecticut Office of the Attorney General', sectors: ['data-protection', 'privacy', 'consumer-protection'] },
    { id: 'UT-DCP',     name: 'Utah Division of Consumer Protection',       sectors: ['data-protection', 'privacy', 'consumer-protection'] },
    { id: 'TX-OAG',     name: 'Texas Office of the Attorney General — Consumer Protection Division', sectors: ['data-protection', 'privacy', 'consumer-protection'] },
    { id: 'OR-DOJ',     name: 'Oregon Department of Justice — Consumer Protection Section', sectors: ['data-protection', 'privacy', 'consumer-protection'] },
    { id: 'DE-DOJ',     name: 'Delaware Department of Justice — Consumer Protection Unit', sectors: ['data-protection', 'privacy', 'consumer-protection'] },
    // task-351: per-state breach-notification regulators so NY SHIELD,
    // IL BIPA, and MA 201 CMR 17 enforcement events surface in their own
    // bucket instead of being absorbed by the FTC / DOJ catch-all.
    { id: 'NY-OAG',     name: 'New York Office of the Attorney General',  sectors: ['data-protection', 'privacy', 'consumer-protection', 'cybersecurity'] },
    { id: 'IL-AG',      name: 'Illinois Attorney General',                sectors: ['data-protection', 'privacy', 'biometrics', 'consumer-protection'] },
    { id: 'MA-OCABR',   name: 'Massachusetts Office of Consumer Affairs and Business Regulation', sectors: ['data-protection', 'privacy', 'consumer-protection', 'cybersecurity'] },
  ],
  SG: [
    { id: 'MAS', name: 'Monetary Authority of Singapore', sectors: ['financial-services', 'fintech', 'banking'] },
    { id: 'ACRA', name: 'Accounting and Corporate Regulatory Authority', sectors: ['corporate', 'accounting'] },
    { id: 'SGX', name: 'Singapore Exchange', sectors: ['securities', 'capital-markets'] },
    { id: 'PDPC', name: 'Personal Data Protection Commission', sectors: ['data-protection', 'privacy'] },
    { id: 'CCS', name: 'Competition and Consumer Commission of Singapore', sectors: ['competition', 'consumer'] },
  ],
};

// ──────────────────────────────────────────────────────────────────────────────
// Regulatory Monitor Service
// ──────────────────────────────────────────────────────────────────────────────

export class RegulatoryMonitorService {
  private static instance: RegulatoryMonitorService;
  private readonly events = new Map<string, RegulatoryEvent>();
  private readonly alerts = new Map<string, RegulatoryAlert>();
  private readonly subscriptions = new Map<string, MonitoringSubscription>();
  private pollingInterval?: NodeJS.Timer;

  private constructor() {
    logger.info('[RegMon] Regulatory Monitor Service initialized — 6 jurisdictions, 40+ regulators');
  }

  static getInstance(): RegulatoryMonitorService {
    if (!RegulatoryMonitorService.instance) {
      RegulatoryMonitorService.instance = new RegulatoryMonitorService();
    }
    return RegulatoryMonitorService.instance;
  }

  /**
   * Add a regulatory event to the system.
   * In production: called by the web scraper/RSS feed poller for each regulator.
   */
  addRegulatoryEvent(event: Omit<RegulatoryEvent, 'id' | 'detectedAt' | 'processed'>): RegulatoryEvent {
    const id = `reg-event-${Date.now()}-${crypto.randomUUID().substring(0, 6)}`;
    const fullEvent: RegulatoryEvent = {
      ...event,
      id,
      detectedAt: new Date(),
      processed: false,
    };
    this.events.set(id, fullEvent);

    // Process alert distribution
    this.distributeAlerts(fullEvent).catch(err =>
      logger.error('[RegMon] Alert distribution failed', { err: err.message }),
    );

    logger.info('[RegMon] Regulatory event added', { id, jurisdiction: event.jurisdiction, type: event.type, severity: event.severity });
    return fullEvent;
  }

  /**
   * Create or update a monitoring subscription for an organization.
   */
  subscribe(input: Omit<MonitoringSubscription, 'id' | 'createdAt'>): MonitoringSubscription {
    const id = `reg-sub-${input.organizationId}-${Date.now()}`;
    const subscription: MonitoringSubscription = { ...input, id, createdAt: new Date() };
    this.subscriptions.set(id, subscription);
    logger.info('[RegMon] Subscription created', { orgId: input.organizationId, jurisdictions: input.jurisdictions });
    return subscription;
  }

  /**
   * Get all events for a jurisdiction, optionally filtered.
   */
  getEvents(filters?: {
    jurisdiction?: JurisdictionCode;
    type?: RegulatoryEventType;
    severity?: AlertSeverity;
    since?: Date;
    regulator?: string;
    sector?: string;
    limit?: number;
  }): RegulatoryEvent[] {
    let events = Array.from(this.events.values());
    if (filters?.jurisdiction) events = events.filter(e => e.jurisdiction === filters.jurisdiction);
    if (filters?.type) events = events.filter(e => e.type === filters.type);
    if (filters?.regulator) events = events.filter(e => e.regulator === filters.regulator);
    if (filters?.sector) events = events.filter(e => e.affectedSectors.includes(filters.sector!));
    if (filters?.since) events = events.filter(e => e.detectedAt >= filters.since!);
    if (filters?.severity) {
      const levels: AlertSeverity[] = ['info', 'low', 'medium', 'high', 'critical'];
      const minIdx = levels.indexOf(filters.severity);
      events = events.filter(e => levels.indexOf(e.severity) >= minIdx);
    }
    events.sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime());
    return events.slice(0, filters?.limit || 100);
  }

  /**
   * Get alerts for an organization.
   */
  getAlerts(organizationId: string, onlyUnread = false): RegulatoryAlert[] {
    let alerts = Array.from(this.alerts.values())
      .filter(a => a.organizationId === organizationId);
    if (onlyUnread) alerts = alerts.filter(a => !a.notified);
    return alerts.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Dismiss an alert.
   */
  dismissAlert(alertId: string, action?: string): void {
    const alert = this.alerts.get(alertId);
    if (!alert) return;
    alert.dismissed = true;
    if (action) alert.actionTaken = action;
    this.alerts.set(alertId, alert);
  }

  /**
   * Get all regulators for a jurisdiction.
   */
  getRegulatorsForJurisdiction(jurisdiction: JurisdictionCode): Array<{ id: string; name: string; sectors: string[] }> {
    return REGULATORS[jurisdiction] || [];
  }

  /**
   * Start polling regulators (in production: uses actual web scraping / RSS feeds).
   */
  startPolling(intervalMs = 3600000): void {
    if (this.pollingInterval) return;
    this.pollingInterval = setInterval(() => {
      this.pollAllRegulators().catch(err =>
        logger.error('[RegMon] Polling failed', { err: err.message }),
      );
    }, intervalMs);
    logger.info('[RegMon] Regulatory polling started', { intervalMs });
  }

  /**
   * Stop polling.
   */
  stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval as any);
      this.pollingInterval = undefined;
    }
  }

  healthCheck(): { status: 'healthy'; eventCount: number; alertCount: number; subscriptionCount: number; pollingActive: boolean } {
    return {
      status: 'healthy',
      eventCount: this.events.size,
      alertCount: this.alerts.size,
      subscriptionCount: this.subscriptions.size,
      pollingActive: !!this.pollingInterval,
    };
  }

  private async distributeAlerts(event: RegulatoryEvent): Promise<void> {
    for (const subscription of this.subscriptions.values()) {
      if (!subscription.active) continue;
      if (!subscription.jurisdictions.includes(event.jurisdiction)) continue;
      if (!subscription.eventTypes.includes(event.type)) continue;

      const severityLevels: AlertSeverity[] = ['info', 'low', 'medium', 'high', 'critical'];
      if (severityLevels.indexOf(event.severity) < severityLevels.indexOf(subscription.minimumSeverity)) continue;

      const sectorMatch = subscription.sectors.length === 0 ||
        event.affectedSectors.some(s => subscription.sectors.includes(s) || s === 'all');
      if (!sectorMatch) continue;

      const relevanceScore = this.calculateRelevance(event, subscription);
      const alertId = `alert-${subscription.organizationId}-${event.id}`;

      this.alerts.set(alertId, {
        id: alertId,
        organizationId: subscription.organizationId,
        eventId: event.id,
        event,
        relevanceScore,
        notified: false,
        dismissed: false,
        createdAt: new Date(),
      });
    }

    event.processed = true;
    this.events.set(event.id, event);
  }

  private calculateRelevance(event: RegulatoryEvent, subscription: MonitoringSubscription): number {
    let score = 50;
    if (subscription.practiceAreas.some(pa => event.affectedPracticeAreas.includes(pa))) score += 20;
    if (subscription.sectors.some(s => event.affectedSectors.includes(s))) score += 15;
    const severityBonus: Record<AlertSeverity, number> = { info: 0, low: 5, medium: 10, high: 20, critical: 30 };
    score += severityBonus[event.severity] || 0;
    return Math.min(100, score);
  }

  private async pollAllRegulators(): Promise<void> {
    // In production: fetch from real regulator APIs / RSS feeds / web scrapers
    // For each regulator, check for new publications and call addRegulatoryEvent()
    logger.debug('[RegMon] Regulatory poll cycle complete');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Tavily-backed live news (task #304 / Demo G3B)
  //
  // Sweeps Tavily with jurisdiction-tuned regulatory search terms, persists
  // each unique URL into nv_regulatory_feeds (feed_type='tavily-news') with
  // dedup-by-url, and refreshes lastChangeDetectedAt for re-emerges. Reads
  // are served from the same table by nv-operations-aggregators.ts.
  // ──────────────────────────────────────────────────────────────────────────

  private tavilyInterval?: NodeJS.Timer;
  private lastTavilyRunAt: Map<TavilyJurisdiction, Date> = new Map();
  private lastTavilyCount: Map<TavilyJurisdiction, number> = new Map();

  /** Returns true if the Tavily integration is wired (env var present). */
  isTavilyEnabled(): boolean {
    return isTavilyConfigured();
  }

  /**
   * Persist a single Tavily news item into nv_regulatory_feeds. Dedup is
   * performed by feed_url; duplicates only refresh lastChangeDetectedAt.
   */
  async upsertTavilyItem(item: TavilyNewsItem): Promise<'inserted' | 'refreshed' | 'skipped'> {
    if (!rawDb) return 'skipped';
    try {
      interface FeedIdRow { id: number }
      interface ExecResult { rows?: FeedIdRow[] }
      const existing = (await rawDb
        .execute(sql`
          SELECT id FROM nv_regulatory_feeds
          WHERE feed_url = ${item.url}
          LIMIT 1
        `)
        .catch(() => ({ rows: [] as FeedIdRow[] }))) as ExecResult | FeedIdRow[];
      const rows: FeedIdRow[] = Array.isArray(existing)
        ? existing
        : (existing.rows ?? []);
      const detectedIso = item.publishedAt
        ? new Date(item.publishedAt).toISOString()
        : new Date().toISOString();
      const metadata = {
        title: item.title,
        summary: item.summary,
        score: item.score,
        topic: item.topic,
        publishedAt: item.publishedAt,
        source: item.source,
      };

      if (rows.length > 0) {
        await rawDb.execute(sql`
          UPDATE nv_regulatory_feeds
          SET last_fetched_at = NOW(),
              last_change_detected_at = ${detectedIso}::timestamp,
              metadata = ${JSON.stringify(metadata)}::jsonb,
              updated_at = NOW()
          WHERE id = ${rows[0].id}
        `);
        return 'refreshed';
      }

      await rawDb.execute(sql`
        INSERT INTO nv_regulatory_feeds
          (source_name, jurisdiction, feed_type, feed_url, last_fetched_at,
           last_change_detected_at, fetch_interval_minutes, is_active,
           parser_type, metadata)
        VALUES
          (${item.source}, ${item.jurisdiction}, 'tavily-news', ${item.url},
           NOW(), ${detectedIso}::timestamp, 30, true, 'tavily',
           ${JSON.stringify(metadata)}::jsonb)
      `);
      return 'inserted';
    } catch (err: any) {
      logger.warn('[RegMon] tavily upsert failed', { url: item.url, err: err?.message });
      return 'skipped';
    }
  }

  /**
   * Sweep Tavily for one jurisdiction and persist results. Returns the count
   * of items actually written (inserted + refreshed).
   */
  async refreshTavilyForJurisdiction(jurisdiction: TavilyJurisdiction): Promise<number> {
    if (!isTavilyConfigured()) return 0;
    const items = await tavilySweepJurisdiction(jurisdiction, {
      perTermLimit: 5,
      cap: 30,
      daysBack: 7,
    });
    let written = 0;
    for (const item of items) {
      const r = await this.upsertTavilyItem(item);
      if (r !== 'skipped') written += 1;
    }
    this.lastTavilyRunAt.set(jurisdiction, new Date());
    this.lastTavilyCount.set(jurisdiction, items.length);
    logger.info('[RegMon] Tavily sweep complete', {
      jurisdiction,
      fetched: items.length,
      persisted: written,
    });
    return written;
  }

  /** Sweep all 6 jurisdictions sequentially (avoids slamming Tavily). */
  async refreshAllJurisdictions(): Promise<void> {
    const jurisdictions: TavilyJurisdiction[] = ['US', 'IN', 'UK', 'EU', 'SG', 'GC'];
    for (const j of jurisdictions) {
      try {
        await this.refreshTavilyForJurisdiction(j);
      } catch (err: any) {
        logger.warn('[RegMon] Tavily jurisdiction refresh failed', {
          jurisdiction: j,
          err: err?.message,
        });
      }
    }
  }

  private tavilyColumnsEnsured = false;
  private async ensureTavilyColumns(): Promise<void> {
    if (this.tavilyColumnsEnsured || !rawDb) {
      this.tavilyColumnsEnsured = true;
      return;
    }
    try {
      await rawDb.execute(sql`
        ALTER TABLE nv_regulatory_feeds
          ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          ADD COLUMN IF NOT EXISTS auth_config jsonb NOT NULL DEFAULT '{}'::jsonb
      `);
      this.tavilyColumnsEnsured = true;
    } catch (err: any) {
      logger.warn('[RegMon] ensureTavilyColumns failed (continuing)', {
        err: err?.message,
      });
    }
  }

  /**
   * Start a 30-minute Tavily sweep across all jurisdictions. Idempotent.
   * Called from src/index.ts during boot.
   */
  startTavilySweeps(intervalMs = 30 * 60_000): void {
    if (this.tavilyInterval) return;
    if (!isTavilyConfigured()) {
      logger.info('[RegMon] Tavily sweeps disabled — TAVILY_API_KEY not set');
      return;
    }
    // Idempotent ALTER: the original 2026-05-14 governance migration
    // didn't include the metadata/auth_config columns, but the Drizzle
    // schema (shared/schema.ts) declares them. Add them on demand so
    // task #304 inserts succeed regardless of which migration history
    // the live DB has applied.
    this.ensureTavilyColumns()
      .then(() => {
        // Kick off an immediate first sweep so first-load demos show data.
        return this.refreshAllJurisdictions();
      })
      .catch((err) =>
        logger.warn('[RegMon] initial Tavily sweep failed', { err: err?.message }),
      );
    this.tavilyInterval = setInterval(() => {
      this.refreshAllJurisdictions().catch((err) =>
        logger.warn('[RegMon] scheduled Tavily sweep failed', { err: err?.message }),
      );
    }, intervalMs);
    logger.info('[RegMon] Tavily sweeps started', { intervalMs });
  }

  stopTavilySweeps(): void {
    if (this.tavilyInterval) {
      clearInterval(this.tavilyInterval as any);
      this.tavilyInterval = undefined;
    }
  }

  getTavilyStatus(): {
    enabled: boolean;
    sweepsActive: boolean;
    lastRunAt: Record<string, string | null>;
    lastFetchCount: Record<string, number>;
  } {
    const lastRunAt: Record<string, string | null> = {};
    const lastFetchCount: Record<string, number> = {};
    for (const j of ['US', 'IN', 'UK', 'EU', 'SG', 'GC'] as const) {
      lastRunAt[j] = this.lastTavilyRunAt.get(j)?.toISOString() ?? null;
      lastFetchCount[j] = this.lastTavilyCount.get(j) ?? 0;
    }
    return {
      enabled: isTavilyConfigured(),
      sweepsActive: !!this.tavilyInterval,
      lastRunAt,
      lastFetchCount,
    };
  }
}

export const regulatoryMonitor = RegulatoryMonitorService.getInstance();
