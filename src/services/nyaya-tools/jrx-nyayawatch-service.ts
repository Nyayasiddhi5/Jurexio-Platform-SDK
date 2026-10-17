// NYV-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
import { createLogger } from '../../utils/logger.js';
import { db as _raw_db } from '../../db/index.js';
import { lazyRequire } from '../../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { nvAmendmentEvents, nvRegulatoryFeeds, nvStatuteVersions } from '../../../shared/schema.js';
import { eq, desc, and, gte, sql } from 'drizzle-orm';

const logger = createLogger('./jrx-nyayawatch');

type JurisdictionCode = 'IN' | 'UK' | 'EU' | 'US' | 'GC' | 'SG';

export interface WatchRule {
  id: string;
  userId: string;
  jurisdiction: JurisdictionCode;
  domains: string[];
  keywords: string[];
  statutes: string[];
  notifyEmail?: string;
  notifyWebhook?: string;
  isActive: boolean;
  createdAt: Date;
}

export interface AmendmentAlert {
  eventId: number;
  jurisdiction: JurisdictionCode;
  title: string;
  severity: string;
  affectedStatutes: string[];
  effectiveAt: Date | null;
  impactScore: number | null;
  matchedRules: string[];
}

export interface WatchDigest {
  period: string;
  jurisdiction: JurisdictionCode;
  alerts: AmendmentAlert[];
  totalEvents: number;
  highSeverityCount: number;
}

const RULES_TABLE = 'nv_schema.nv_nyayawatch_rules';

export class NvNyayaWatchService {
  private static instance: NvNyayaWatchService;
  private watchRules: Map<string, WatchRule> = new Map();
  private alertHistory: AmendmentAlert[] = [];
  private hydrated = false;
  private tableReady = false;

  private constructor() {}

  static getInstance(): NvNyayaWatchService {
    if (!NvNyayaWatchService.instance) {
      NvNyayaWatchService.instance = new NvNyayaWatchService();
    }
    return NvNyayaWatchService.instance;
  }

  private async ensureTable(): Promise<void> {
    if (this.tableReady) return;
    try {
      await db.execute(sql.raw(`
        CREATE TABLE IF NOT EXISTS ${RULES_TABLE} (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          jurisdiction TEXT NOT NULL,
          domains JSONB NOT NULL DEFAULT '[]'::jsonb,
          keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
          statutes JSONB NOT NULL DEFAULT '[]'::jsonb,
          notify_email TEXT,
          notify_webhook TEXT,
          is_active BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `));
      try {
        await db.execute(sql.raw(
          `CREATE INDEX IF NOT EXISTS nv_nyayawatch_rules_user_idx ON ${RULES_TABLE} (user_id)`,
        ));
        await db.execute(sql.raw(
          `CREATE INDEX IF NOT EXISTS nv_nyayawatch_rules_jurisdiction_idx ON ${RULES_TABLE} (jurisdiction)`,
        ));
      } catch { /* index may already exist */ }
      this.tableReady = true;
    } catch (error: any) {
      logger.warn({
        service: 'NvNyayaWatchService',
        method: 'ensureTable',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async hydrateFromDb(): Promise<void> {
    if (this.hydrated) return;
    await this.ensureTable();
    try {
      const rows = await db.execute(sql.raw(`
        SELECT id, user_id, jurisdiction, domains, keywords, statutes,
               notify_email, notify_webhook, is_active, created_at
        FROM ${RULES_TABLE}
        LIMIT 5000
      `));
      const list = (rows as any)?.rows ?? (Array.isArray(rows) ? rows : []);
      for (const row of list) {
        const rule: WatchRule = {
          id: String(row.id),
          userId: String(row.user_id),
          jurisdiction: row.jurisdiction as JurisdictionCode,
          domains: Array.isArray(row.domains) ? row.domains : [],
          keywords: Array.isArray(row.keywords) ? row.keywords : [],
          statutes: Array.isArray(row.statutes) ? row.statutes : [],
          notifyEmail: row.notify_email ?? undefined,
          notifyWebhook: row.notify_webhook ?? undefined,
          isActive: row.is_active !== false,
          createdAt: row.created_at ? new Date(row.created_at) : new Date(),
        };
        this.watchRules.set(rule.id, rule);
      }
      this.hydrated = true;
      logger.info({
        service: 'NvNyayaWatchService',
        method: 'hydrateFromDb',
        count: this.watchRules.size,
      });
    } catch (error: any) {
      this.hydrated = true; // avoid retry storm; in-memory still works
      logger.warn({
        service: 'NvNyayaWatchService',
        method: 'hydrateFromDb',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async persistRule(rule: WatchRule): Promise<void> {
    await this.ensureTable();
    try {
      await db.execute(sql`
        INSERT INTO nv_schema.nv_nyayawatch_rules (
          id, user_id, jurisdiction, domains, keywords, statutes,
          notify_email, notify_webhook, is_active, created_at, updated_at
        ) VALUES (
          ${rule.id},
          ${rule.userId},
          ${rule.jurisdiction},
          ${JSON.stringify(rule.domains)}::jsonb,
          ${JSON.stringify(rule.keywords)}::jsonb,
          ${JSON.stringify(rule.statutes)}::jsonb,
          ${rule.notifyEmail ?? null},
          ${rule.notifyWebhook ?? null},
          ${rule.isActive},
          ${rule.createdAt.toISOString()}::timestamptz,
          NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          jurisdiction = EXCLUDED.jurisdiction,
          domains = EXCLUDED.domains,
          keywords = EXCLUDED.keywords,
          statutes = EXCLUDED.statutes,
          notify_email = EXCLUDED.notify_email,
          notify_webhook = EXCLUDED.notify_webhook,
          is_active = EXCLUDED.is_active,
          updated_at = NOW()
      `);
    } catch (error: any) {
      logger.warn({
        service: 'NvNyayaWatchService',
        method: 'persistRule',
        ruleId: rule.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async deletePersisted(ruleId: string): Promise<void> {
    await this.ensureTable();
    try {
      await db.execute(sql`
        DELETE FROM nv_schema.nv_nyayawatch_rules WHERE id = ${ruleId}
      `);
    } catch (error: any) {
      logger.warn({
        service: 'NvNyayaWatchService',
        method: 'deletePersisted',
        ruleId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Sync add (Queen / tools). Fire-and-forget RDS persist. */
  addWatchRule(rule: WatchRule): void {
    this.watchRules.set(rule.id, rule);
    void this.persistRule(rule);
    logger.info({ service: 'NvNyayaWatchService', method: 'addWatchRule', ruleId: rule.id, jurisdiction: rule.jurisdiction });
  }

  /** Alias for mesh factories. */
  createWatch(rule: WatchRule): WatchRule {
    this.addWatchRule(rule);
    return rule;
  }

  async addWatchRuleAsync(rule: WatchRule): Promise<WatchRule> {
    this.watchRules.set(rule.id, rule);
    await this.persistRule(rule);
    return rule;
  }

  removeWatchRule(ruleId: string): boolean {
    const ok = this.watchRules.delete(ruleId);
    if (ok) void this.deletePersisted(ruleId);
    return ok;
  }

  /** Alias for mesh. */
  deleteWatch(ruleId: string): boolean {
    return this.removeWatchRule(ruleId);
  }

  getWatchRules(userId: string): WatchRule[] {
    void this.hydrateFromDb();
    return Array.from(this.watchRules.values()).filter(r => r.userId === userId);
  }

  /** Alias for mesh. */
  listWatches(userId: string): WatchRule[] {
    return this.getWatchRules(userId);
  }

  async listWatchRules(userId?: string): Promise<WatchRule[]> {
    await this.hydrateFromDb();
    const all = Array.from(this.watchRules.values());
    return userId ? all.filter(r => r.userId === userId) : all;
  }

  async scanForChanges(jurisdiction: JurisdictionCode, sinceDays: number = 7): Promise<AmendmentAlert[]> {
    await this.hydrateFromDb();
    const startTime = Date.now();
    const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

    try {
      const events = await db.select()
        .from(nvAmendmentEvents)
        .where(
          and(
            eq(nvAmendmentEvents.jurisdiction, jurisdiction),
            gte(nvAmendmentEvents.createdAt, sinceDate)
          )
        )
        .orderBy(desc(nvAmendmentEvents.createdAt))
        .limit(100);

      const alerts: AmendmentAlert[] = [];

      for (const event of events) {
        const matchedRules = this.matchRules(event, jurisdiction);

        if (matchedRules.length > 0 || event.severity === 'critical' || event.severity === 'major') {
          alerts.push({
            eventId: event.id,
            jurisdiction,
            title: event.title,
            severity: event.severity,
            affectedStatutes: (event.affectedStatutes as string[]) || [],
            effectiveAt: event.effectiveAt,
            impactScore: event.impactScore,
            matchedRules: matchedRules.map(r => r.id),
          });
        }
      }

      this.alertHistory.push(...alerts);
      if (this.alertHistory.length > 500) {
        this.alertHistory.splice(0, this.alertHistory.length - 500);
      }

      logger.info({
        service: 'NvNyayaWatchService',
        method: 'scanForChanges',
        jurisdiction,
        eventsScanned: events.length,
        alertsGenerated: alerts.length,
        durationMs: Date.now() - startTime,
      });

      return alerts;
    } catch (error: any) {
      logger.error({
        service: 'NvNyayaWatchService',
        method: 'scanForChanges',
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      });
      return [];
    }
  }

  async generateDigest(jurisdiction: JurisdictionCode, days: number = 7): Promise<WatchDigest> {
    const alerts = await this.scanForChanges(jurisdiction, days);
    return {
      period: `Last ${days} days`,
      jurisdiction,
      alerts,
      totalEvents: alerts.length,
      highSeverityCount: alerts.filter(a => a.severity === 'critical' || a.severity === 'major').length,
    };
  }

  async getActiveFeeds(jurisdiction: JurisdictionCode): Promise<any[]> {
    try {
      return await db.select()
        .from(nvRegulatoryFeeds)
        .where(
          and(
            eq(nvRegulatoryFeeds.jurisdiction, jurisdiction),
            eq(nvRegulatoryFeeds.isActive, true)
          )
        )
        .orderBy(desc(nvRegulatoryFeeds.lastFetchedAt))
        .limit(50);
    } catch (error: any) {
      logger.error({ service: 'NvNyayaWatchService', method: 'getActiveFeeds', error: (error as Error).message });
      return [];
    }
  }

  async checkStatuteValidity(statuteId: string, sectionNumber: string): Promise<{ valid: boolean; currentVersion?: any; supersededBy?: any }> {
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
        .limit(5);

      if (versions.length === 0) return { valid: false };

      const current = versions.find(v => !v.validTo);
      if (current) return { valid: true, currentVersion: current };

      return { valid: false, currentVersion: versions[0], supersededBy: versions[0].supersededBy };
    } catch (error: any) {
      logger.error({ service: 'NvNyayaWatchService', method: 'checkStatuteValidity', error: (error as Error).message });
      return { valid: false };
    }
  }

  getAlertHistory(limit: number = 50): AmendmentAlert[] {
    return this.alertHistory.slice(-limit);
  }

  private matchRules(event: any, jurisdiction: JurisdictionCode): WatchRule[] {
    return Array.from(this.watchRules.values()).filter(rule => {
      if (!rule.isActive) return false;
      if (rule.jurisdiction !== jurisdiction) return false;

      const title = event.title?.toLowerCase() || '';
      const description = event.description?.toLowerCase() || '';
      const affected = ((event.affectedStatutes as string[]) || []).map((s: string) => s.toLowerCase());

      if (rule.keywords.length > 0) {
        const hasKeyword = rule.keywords.some(kw => title.includes(kw.toLowerCase()) || description.includes(kw.toLowerCase()));
        if (hasKeyword) return true;
      }

      if (rule.statutes.length > 0) {
        const hasStatute = rule.statutes.some(s => affected.includes(s.toLowerCase()));
        if (hasStatute) return true;
      }

      return false;
    });
  }
}

export const nvNyayaWatchService = NvNyayaWatchService.getInstance();
