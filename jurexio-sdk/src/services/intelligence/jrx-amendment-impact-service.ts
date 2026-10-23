/**
 * Amendment impact — thin adapter over NyayaAmend DB SSoT (nv_amendment_events / nv_statute_versions).
 * No fake gazette IDs. Empty results carry reason: no_recorded_amendments.
 */
import { createLogger } from '../../utils/logger.js';
import { nvNyayaAmendService } from '../jrx-legal-tools/jrx-nyayaamend-service.js';

const logger = createLogger('./jrx-amendment-impact-service');

type JurisdictionCode = 'IN' | 'UK' | 'EU' | 'US' | 'GCC' | 'SG';

function toNyayaAmendJurisdiction(j: JurisdictionCode): 'IN' | 'UK' | 'EU' | 'US' | 'GC' | 'SG' {
  return j === 'GCC' ? 'GC' : j;
}
type AmendmentSeverity = 'minor' | 'significant' | 'major' | 'critical';

interface AmendmentImpactAnalysis {
  changedSection: string;
  jurisdiction: JurisdictionCode;
  effectiveDate: Date;
  affectedMatters: AffectedMatter[];
  impactHeatmap: ImpactHeatmap;
  severity: AmendmentSeverity;
  recommendations: string[];
  draftedNotice?: string;
  analyzedAt: Date;
  amendmentId?: number;
  reason?: string;
  source: 'nyaya-amend';
}

interface AffectedMatter {
  matterId: string;
  matterTitle: string;
  impactLevel: 'low' | 'medium' | 'high' | 'critical';
  affectedAspect: string;
  actionRequired: string;
}

interface ImpactHeatmap {
  entries: ImpactHeatmapEntry[];
  totalAffected: number;
  criticalCount: number;
}

interface ImpactHeatmapEntry {
  jurisdiction: JurisdictionCode;
  domain: string;
  affectedMatterCount: number;
  severity: AmendmentSeverity;
}

interface StatuteHistory {
  sectionRef: string;
  jurisdiction: JurisdictionCode;
  versions: StatuteVersion[];
  totalAmendments: number;
  reason?: string;
  source: 'nyaya-amend';
}

interface StatuteVersion {
  version: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  changeType: 'added' | 'modified' | 'deleted';
  summary: string;
  gazetteRef: string;
}

interface NotificationResult {
  notificationsSent: number;
  affectedLawyers: string[];
  deliveryStatus: Record<string, string>;
  reason: string;
}

function mapSeverity(s: string | undefined): AmendmentSeverity {
  const v = String(s || '').toLowerCase();
  if (v === 'critical') return 'critical';
  if (v === 'high') return 'major';
  if (v === 'medium') return 'significant';
  return 'minor';
}

class NvAmendmentImpactService {
  /**
   * Accept sectionId / amendmentId / changedSection for SDK + route compatibility.
   */
  async analyzeImpact(
    changedSection: string,
    jurisdiction: JurisdictionCode,
    effectiveDate: Date,
    opts?: { amendmentId?: number | string },
  ): Promise<AmendmentImpactAnalysis> {
    logger.info({ method: 'analyzeImpact', changedSection, jurisdiction, effectiveDate });

    let amendmentId = opts?.amendmentId != null ? Number(opts.amendmentId) : NaN;
    if (!Number.isFinite(amendmentId)) {
      // If caller passed a numeric section/amendment id string
      const n = Number(changedSection);
      if (Number.isFinite(n) && n > 0) amendmentId = n;
    }

    if (Number.isFinite(amendmentId) && amendmentId > 0) {
      const assessment = await nvNyayaAmendService.assessAmendmentImpact(amendmentId);
      const affectedMatters: AffectedMatter[] = (assessment.affectedTemplates || []).map((t) => ({
        matterId: String(t.templateId),
        matterTitle: t.templateName,
        impactLevel: assessment.impactSeverity === 'critical' ? 'critical'
          : assessment.impactSeverity === 'high' ? 'high'
          : assessment.impactSeverity === 'medium' ? 'medium' : 'low',
        affectedAspect: `template clauses=${t.clauseCount}`,
        actionRequired: 'Review template for amended provisions',
      }));
      const severity = mapSeverity(assessment.impactSeverity);
      return {
        changedSection,
        jurisdiction,
        effectiveDate,
        affectedMatters,
        impactHeatmap: {
          entries: [{
            jurisdiction,
            domain: 'templates',
            affectedMatterCount: affectedMatters.length,
            severity,
          }],
          totalAffected: affectedMatters.length,
          criticalCount: severity === 'critical' ? 1 : 0,
        },
        severity,
        recommendations: assessment.recommendedActions || [],
        analyzedAt: new Date(),
        amendmentId,
        reason: affectedMatters.length ? undefined : 'no_affected_templates',
        source: 'nyaya-amend',
      };
    }

    // Section-number path: recent amendments + timeline
    const recent = await nvNyayaAmendService.getRecentAmendments(toNyayaAmendJurisdiction(jurisdiction), 365);
    const match = (recent || []).find((e: any) => {
      const statutes = (e.affectedStatutes as string[]) || [];
      return statutes.some((s) => String(s).toLowerCase().includes(String(changedSection).toLowerCase()))
        || String(e.title || '').toLowerCase().includes(String(changedSection).toLowerCase());
    });

    if (match?.id) {
      return this.analyzeImpact(changedSection, jurisdiction, effectiveDate, { amendmentId: match.id });
    }

    const timeline = await nvNyayaAmendService.getTemporalTimeline(
      String(changedSection),
      String(changedSection),
      toNyayaAmendJurisdiction(jurisdiction),
    );

    return {
      changedSection,
      jurisdiction,
      effectiveDate,
      affectedMatters: [],
      impactHeatmap: { entries: [], totalAffected: 0, criticalCount: 0 },
      severity: 'minor',
      recommendations: timeline.totalAmendments
        ? ['Review statute timeline versions via NyayaAmend as-of API']
        : ['No recorded amendment events for this section in nv_amendment_events'],
      analyzedAt: new Date(),
      reason: timeline.totalAmendments ? 'timeline_only_no_event_id' : 'no_recorded_amendments',
      source: 'nyaya-amend',
    };
  }

  /** Queen factory aliases */
  async analyze(input: any): Promise<AmendmentImpactAnalysis> {
    const section = String(input?.sectionId || input?.amendmentId || input?.changedSection || input?.statuteId || '');
    const jurisdiction = (input?.jurisdiction || 'IN') as JurisdictionCode;
    const effectiveDate = input?.effectiveDate ? new Date(input.effectiveDate) : new Date();
    return this.analyzeImpact(section, jurisdiction, effectiveDate, {
      amendmentId: input?.amendmentId,
    });
  }

  async assessImpact(input: any): Promise<AmendmentImpactAnalysis> {
    return this.analyze(input);
  }

  async evaluate(input: any): Promise<AmendmentImpactAnalysis> {
    return this.analyze(input);
  }

  async getStatuteHistory(sectionRef: string, jurisdiction: JurisdictionCode): Promise<StatuteHistory> {
    logger.info({ method: 'getStatuteHistory', sectionRef, jurisdiction });
    const timeline = await nvNyayaAmendService.getTemporalTimeline(
      sectionRef,
      sectionRef,
      toNyayaAmendJurisdiction(jurisdiction),
    );
    const versions: StatuteVersion[] = (timeline.versions || []).map((v: any, i: number) => ({
      version: String(v.version ?? i + 1),
      effectiveFrom: v.validFrom ? new Date(v.validFrom) : new Date(0),
      effectiveTo: v.validTo ? new Date(v.validTo) : null,
      changeType: (v.changeType || 'modified') as StatuteVersion['changeType'],
      summary: String(v.summary || v.sectionText || '').slice(0, 500),
      gazetteRef: String(v.gazetteRef || v.source || 'recorded'),
    }));
    return {
      sectionRef,
      jurisdiction,
      versions,
      totalAmendments: timeline.totalAmendments ?? versions.length,
      reason: versions.length ? undefined : 'no_recorded_amendments',
      source: 'nyaya-amend',
    };
  }

  async notifyAffectedLawyers(_impact: AmendmentImpactAnalysis): Promise<NotificationResult> {
    return {
      notificationsSent: 0,
      affectedLawyers: [],
      deliveryStatus: {},
      reason: 'lawyer_notify_phase_c',
    };
  }
}

export const nvAmendmentImpactService = new NvAmendmentImpactService();
export const amendmentImpactService = nvAmendmentImpactService;
