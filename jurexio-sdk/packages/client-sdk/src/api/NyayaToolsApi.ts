import type { JrxHttpClient } from '../JrxClient.js';
import type {
  JrxJurisdiction,
  JrxGraphTraversalInput,
  JrxGraphTraversalResult,
  JrxCitationCheckResult,
  JrxLegalDiffResult,
  JrxTemplateListItem,
  JrxTemplateGenerateResult,
  JrxTemplateFillSession,
  JrxLimitationResult,
  JrxChecklistItem,
  JrxForensicVerifyResult,
  JrxAuditTrailEntry,
  JrxEDiscoveryResult,
  JrxGazetteProcessResult,
  JrxAffectedMattersResult,
} from '../types/index.js';

export class NyayaToolsApi {
  constructor(private http: JrxHttpClient) {}

  async graphTraverse(input: JrxGraphTraversalInput): Promise<JrxGraphTraversalResult> {
    return this.http.post('/api/jrx/jrx-legal-tools/graph/traverse', input);
  }

  async citationCheck(citation: string, jurisdiction: JrxJurisdiction): Promise<JrxCitationCheckResult> {
    return this.http.post('/api/jrx/jrx-legal-tools/graph/citation-check', { citation, jurisdiction });
  }

  async compareDiff(
    statuteId: string,
    fromVersion: string,
    toVersion: string
  ): Promise<JrxLegalDiffResult> {
    return this.http.post('/api/jrx/jrx-legal-tools/compare/diff', { statuteId, fromVersion, toVersion });
  }

  async templatesList(
    jurisdiction: JrxJurisdiction,
    category?: string
  ): Promise<JrxTemplateListItem[]> {
    const params = new URLSearchParams({ jurisdiction });
    if (category) params.set('category', category);
    return this.http.get(`/api/jrx/jrx-legal-tools/templates/list?${params.toString()}`);
  }

  async templateGenerate(
    templateId: string,
    fields: Record<string, string>,
    jurisdiction: JrxJurisdiction
  ): Promise<JrxTemplateGenerateResult> {
    return this.http.post('/api/jrx/jrx-legal-tools/templates/generate', { templateId, fields, jurisdiction });
  }

  async templateStartFillSession(
    templateId: string,
    jurisdiction: JrxJurisdiction
  ): Promise<JrxTemplateFillSession> {
    return this.http.post('/api/jrx/jrx-legal-tools/templates/fill-session', { templateId, jurisdiction });
  }

  async timelineLimitation(
    sectionId: string,
    jurisdiction: JrxJurisdiction,
    eventDate?: string
  ): Promise<JrxLimitationResult> {
    return this.http.post('/api/jrx/jrx-legal-tools/timeline/limitation', { sectionId, jurisdiction, eventDate });
  }

  async timelineChecklist(
    matterId: string,
    jurisdiction: JrxJurisdiction
  ): Promise<JrxChecklistItem[]> {
    return this.http.post('/api/jrx/jrx-legal-tools/timeline/checklist', { matterId, jurisdiction });
  }

  async forensicVerify(documentId: string): Promise<JrxForensicVerifyResult> {
    return this.http.post('/api/jrx/jrx-legal-tools/forensic/verify', { documentId });
  }

  async trailClassify(
    entries: { action: string; resourceType: string; resourceId: string }[]
  ): Promise<JrxAuditTrailEntry[]> {
    return this.http.post('/api/jrx/jrx-legal-tools/trail/classify', { entries });
  }

  async trailPrivilegeLog(
    matterId: string,
    jurisdiction: JrxJurisdiction
  ): Promise<JrxAuditTrailEntry[]> {
    return this.http.get(`/api/jrx/jrx-legal-tools/trail/privilege-log?matterId=${matterId}&jurisdiction=${jurisdiction}`);
  }

  async trailEDiscovery(
    matterId: string,
    searchTerms: string[]
  ): Promise<JrxEDiscoveryResult> {
    return this.http.post('/api/jrx/jrx-legal-tools/trail/ediscovery', { matterId, searchTerms });
  }

  async amendProcessGazette(
    gazetteUrl: string,
    jurisdiction: JrxJurisdiction
  ): Promise<JrxGazetteProcessResult> {
    return this.http.post('/api/jrx/jrx-legal-tools/amend/process-gazette', { gazetteUrl, jurisdiction });
  }

  async amendAffectedMatters(amendmentId: string): Promise<JrxAffectedMattersResult> {
    return this.http.post('/api/jrx/jrx-legal-tools/amend/affected-matters', { amendmentId });
  }

  async getStatus(): Promise<{ tools: { name: string; status: string; version: string }[]; totalTools: number }> {
    return this.http.get('/api/jrx/jrx-legal-tools/status');
  }

  /** NyayaWatch — list org/user watch rules (status: ok | unavailable). */
  async listNyayaWatchRules(userId?: string): Promise<unknown> {
    if (userId) {
      return this.http.get(`/api/jrx/jrx-legal-tools/watch/rules/${encodeURIComponent(userId)}`);
    }
    return this.http.get('/api/jrx/jrx-legal-tools/watch/rules');
  }

  async createNyayaWatchRule(body: Record<string, unknown>): Promise<unknown> {
    return this.http.post('/api/jrx/jrx-legal-tools/watch/rules', body);
  }

  async deleteNyayaWatchRule(ruleId: string): Promise<unknown> {
    return this.http.delete(`/api/jrx/jrx-legal-tools/watch/rules/${encodeURIComponent(ruleId)}`);
  }
}
