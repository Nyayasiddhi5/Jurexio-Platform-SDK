// JRX-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
import { createLogger } from '../../utils/logger.js';
import { db as _raw_db } from '../../db/index.js';
import { lazyRequire } from '../../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { nvAmendmentEvents, nvStatuteVersions, nvLegalTemplates, nvTemplateClauses } from '../../../shared/schema.js';
import { eq, and, desc, gte, isNull } from 'drizzle-orm';

const logger = createLogger('./jrx-nyayaamend');

type JurisdictionCode = 'IN' | 'UK' | 'EU' | 'US' | 'GC' | 'SG';

export interface AmendmentRecord {
  statuteId: string;
  sectionNumber: string;
  jurisdiction: JurisdictionCode;
  oldText: string;
  newText: string;
  amendmentReference: string;
  effectiveDate: Date;
  reason: string;
}

export interface TemporalSection {
  sectionNumber: string;
  validText: string;
  validFrom: Date;
  validTo: Date | null;
  isCurrentlyValid: boolean;
  version: number;
}

export interface AmendmentTimeline {
  statuteId: string;
  sectionNumber: string;
  jurisdiction: JurisdictionCode;
  versions: TemporalSection[];
  totalAmendments: number;
}

export interface ImpactAssessment {
  amendmentId: number;
  affectedTemplates: Array<{ templateId: number; templateName: string; clauseCount: number }>;
  affectedClauses: Array<{ clauseId: number; clauseName: string; riskLevel: number }>;
  impactSeverity: 'low' | 'medium' | 'high' | 'critical';
  recommendedActions: string[];
}

export class NvNyayaAmendService {
  private static instance: NvNyayaAmendService;

  private constructor() {}

  static getInstance(): NvNyayaAmendService {
    if (!NvNyayaAmendService.instance) {
      NvNyayaAmendService.instance = new NvNyayaAmendService();
    }
    return NvNyayaAmendService.instance;
  }

  async recordAmendment(record: AmendmentRecord): Promise<void> {
    const startTime = Date.now();

    try {
      const existing = await db.select()
        .from(nvStatuteVersions)
        .where(
          and(
            eq(nvStatuteVersions.statuteId, record.statuteId),
            eq(nvStatuteVersions.sectionNumber, record.sectionNumber),
            eq(nvStatuteVersions.jurisdiction, record.jurisdiction),
            isNull(nvStatuteVersions.validTo)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        await db.update(nvStatuteVersions)
          .set({ validTo: record.effectiveDate, updatedAt: new Date() })
          .where(eq(nvStatuteVersions.id, existing[0].id));
      }

      await db.insert(nvStatuteVersions).values({
        statuteId: record.statuteId,
        jurisdiction: record.jurisdiction,
        sectionNumber: record.sectionNumber,
        sectionTitle: `${record.statuteId} S.${record.sectionNumber}`,
        sectionText: record.newText,
        amendmentReference: record.amendmentReference,
        validFrom: record.effectiveDate,
        supersededBy: existing.length > 0 ? existing[0].id : undefined,
      });

      await db.insert(nvAmendmentEvents).values({
        jurisdiction: record.jurisdiction,
        eventType: 'amendment',
        title: `Amendment to ${record.statuteId} S.${record.sectionNumber}`,
        description: record.reason,
        affectedStatutes: [`${record.statuteId} S.${record.sectionNumber}`],
        severity: 'major',
        effectiveAt: record.effectiveDate,
        processedAt: new Date(),
      });

      logger.info({
        service: 'NvNyayaAmendService',
        method: 'recordAmendment',
        statuteId: record.statuteId,
        sectionNumber: record.sectionNumber,
        durationMs: Date.now() - startTime,
      });
    } catch (error: any) {
      logger.error({
        service: 'NvNyayaAmendService',
        method: 'recordAmendment',
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      });
      throw error;
    }
  }

  async getTemporalTimeline(statuteId: string, sectionNumber: string, jurisdiction?: JurisdictionCode): Promise<AmendmentTimeline> {
    try {
      let query = db.select()
        .from(nvStatuteVersions)
        .where(
          and(
            eq(nvStatuteVersions.statuteId, statuteId),
            eq(nvStatuteVersions.sectionNumber, sectionNumber),
            jurisdiction ? eq(nvStatuteVersions.jurisdiction, jurisdiction) : undefined
          )
        )
        .orderBy(desc(nvStatuteVersions.validFrom))
        .limit(50);

      const versions = await query;

      const timeline: TemporalSection[] = versions.map((v, i) => ({
        sectionNumber: v.sectionNumber,
        validText: v.sectionText,
        validFrom: v.validFrom,
        validTo: v.validTo,
        isCurrentlyValid: !v.validTo,
        version: versions.length - i,
      }));

      return {
        statuteId,
        sectionNumber,
        jurisdiction: jurisdiction || 'IN',
        versions: timeline,
        totalAmendments: Math.max(0, timeline.length - 1),
      };
    } catch (error: any) {
      logger.error({ service: 'NvNyayaAmendService', method: 'getTemporalTimeline', error: (error as Error).message });
      return { statuteId, sectionNumber, jurisdiction: jurisdiction || 'IN', versions: [], totalAmendments: 0 };
    }
  }

  async getSectionAsOf(statuteId: string, sectionNumber: string, asOfDate: Date): Promise<TemporalSection | null> {
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
        .limit(50);

      for (const v of versions) {
        const validFrom = v.validFrom;
        const validTo = v.validTo;
        if (validFrom <= asOfDate && (!validTo || validTo >= asOfDate)) {
          return {
            sectionNumber: v.sectionNumber,
            validText: v.sectionText,
            validFrom,
            validTo,
            isCurrentlyValid: !validTo,
            version: 0,
          };
        }
      }

      return null;
    } catch (error: any) {
      logger.error({ service: 'NvNyayaAmendService', method: 'getSectionAsOf', error: (error as Error).message });
      return null;
    }
  }

  async assessAmendmentImpact(amendmentId: number): Promise<ImpactAssessment> {
    const startTime = Date.now();

    try {
      const events = await db.select()
        .from(nvAmendmentEvents)
        .where(eq(nvAmendmentEvents.id, amendmentId))
        .limit(1);

      if (events.length === 0) {
        return { amendmentId, affectedTemplates: [], affectedClauses: [], impactSeverity: 'low', recommendedActions: [] };
      }

      const event = events[0];
      const affectedStatutes = (event.affectedStatutes as string[]) || [];

      const allTemplates = await db.select().from(nvLegalTemplates).limit(100);
      const affectedTemplates: ImpactAssessment['affectedTemplates'] = [];

      for (const template of allTemplates) {
        const templateText = template.templateText.toLowerCase();
        let hasMatch = false;
        for (const statute of affectedStatutes) {
          if (templateText.includes(statute.toLowerCase())) {
            hasMatch = true;
            break;
          }
        }
        if (hasMatch) {
          const clauses = await db.select()
            .from(nvTemplateClauses)
            .where(eq(nvTemplateClauses.templateId, template.id))
            .limit(100);
          affectedTemplates.push({ templateId: template.id, templateName: template.name, clauseCount: clauses.length });
        }
      }

      const allClauses = await db.select().from(nvTemplateClauses).limit(200);
      const affectedClauses: ImpactAssessment['affectedClauses'] = [];

      for (const clause of allClauses) {
        const clauseText = clause.clauseText.toLowerCase();
        for (const statute of affectedStatutes) {
          if (clauseText.includes(statute.toLowerCase())) {
            affectedClauses.push({ clauseId: clause.id, clauseName: clause.clauseName, riskLevel: clause.riskLevel });
            break;
          }
        }
      }

      const impactSeverity: ImpactAssessment['impactSeverity'] =
        affectedTemplates.length > 5 || affectedClauses.some(c => c.riskLevel >= 4) ? 'critical' :
        affectedTemplates.length > 2 || affectedClauses.some(c => c.riskLevel >= 3) ? 'high' :
        affectedTemplates.length > 0 ? 'medium' : 'low';

      const recommendedActions: string[] = [];
      if (affectedTemplates.length > 0) {
        recommendedActions.push(`Review ${affectedTemplates.length} affected template(s) for compliance`);
      }
      if (affectedClauses.length > 0) {
        recommendedActions.push(`Update ${affectedClauses.length} clause(s) referencing amended provisions`);
      }
      if (impactSeverity === 'critical' || impactSeverity === 'high') {
        recommendedActions.push('Notify all users with active matters referencing affected provisions');
      }
      recommendedActions.push('Re-run citation verification on all documents citing affected provisions');

      logger.info({
        service: 'NvNyayaAmendService',
        method: 'assessAmendmentImpact',
        amendmentId,
        affectedTemplates: affectedTemplates.length,
        affectedClauses: affectedClauses.length,
        impactSeverity,
        durationMs: Date.now() - startTime,
      });

      return { amendmentId, affectedTemplates, affectedClauses, impactSeverity, recommendedActions };
    } catch (error: any) {
      logger.error({ service: 'NvNyayaAmendService', method: 'assessAmendmentImpact', error: (error as Error).message });
      return { amendmentId, affectedTemplates: [], affectedClauses: [], impactSeverity: 'low', recommendedActions: [] };
    }
  }

  async getRecentAmendments(jurisdiction: JurisdictionCode, days: number = 30): Promise<any[]> {
    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    try {
      return await db.select()
        .from(nvAmendmentEvents)
        .where(
          and(
            eq(nvAmendmentEvents.jurisdiction, jurisdiction),
            gte(nvAmendmentEvents.createdAt, sinceDate)
          )
        )
        .orderBy(desc(nvAmendmentEvents.createdAt))
        .limit(50);
    } catch (error: any) {
      logger.error({ service: 'NvNyayaAmendService', method: 'getRecentAmendments', error: (error as Error).message });
      return [];
    }
  }
}

export const nvNyayaAmendService = NvNyayaAmendService.getInstance();
