import type { NyvHttpClient } from '../NyvClient.js';
import type {
  NyvJurisdiction,
  NyvGraphTraversalInput,
  NyvGraphTraversalResult,
  NyvCitationCheckResult,
  NyvLegalDiffResult,
  NyvTemplateListItem,
  NyvTemplateGenerateResult,
  NyvTemplateFillSession,
  NyvLimitationResult,
  NyvChecklistItem,
  NyvForensicVerifyResult,
  NyvAuditTrailEntry,
  NyvEDiscoveryResult,
  NyvGazetteProcessResult,
  NyvAffectedMattersResult,
} from '../types/index.js';

export class NyayaToolsApi {
  constructor(private http: NyvHttpClient) {}

  async graphTraverse(input: NyvGraphTraversalInput): Promise<NyvGraphTraversalResult> {
    return this.http.post('/api/jrx/nyaya-tools/graph/traverse', input);
  }

  async citationCheck(citation: string, jurisdiction: NyvJurisdiction): Promise<NyvCitationCheckResult> {
    return this.http.post('/api/jrx/nyaya-tools/graph/citation-check', { citation, jurisdiction });
  }

  async compareDiff(
    statuteId: string,
    fromVersion: string,
    toVersion: string
  ): Promise<NyvLegalDiffResult> {
    return this.http.post('/api/jrx/nyaya-tools/compare/diff', { statuteId, fromVersion, toVersion });
  }

  async templatesList(
    jurisdiction: NyvJurisdiction,
    category?: string
  ): Promise<NyvTemplateListItem[]> {
    const params = new URLSearchParams({ jurisdiction });
    if (category) params.set('category', category);
    return this.http.get(`/api/jrx/nyaya-tools/templates/list?${params.toString()}`);
  }

  async templateGenerate(
    templateId: string,
    fields: Record<string, string>,
    jurisdiction: NyvJurisdiction
  ): Promise<NyvTemplateGenerateResult> {
    return this.http.post('/api/jrx/nyaya-tools/templates/generate', { templateId, fields, jurisdiction });
  }

  async templateStartFillSession(
    templateId: string,
    jurisdiction: NyvJurisdiction
  ): Promise<NyvTemplateFillSession> {
    return this.http.post('/api/jrx/nyaya-tools/templates/fill-session', { templateId, jurisdiction });
  }

  async timelineLimitation(
    sectionId: string,
    jurisdiction: NyvJurisdiction,
    eventDate?: string
  ): Promise<NyvLimitationResult> {
    return this.http.post('/api/jrx/nyaya-tools/timeline/limitation', { sectionId, jurisdiction, eventDate });
  }

  async timelineChecklist(
    matterId: string,
    jurisdiction: NyvJurisdiction
  ): Promise<NyvChecklistItem[]> {
    return this.http.post('/api/jrx/nyaya-tools/timeline/checklist', { matterId, jurisdiction });
  }

  async forensicVerify(documentId: string): Promise<NyvForensicVerifyResult> {
    return this.http.post('/api/jrx/nyaya-tools/forensic/verify', { documentId });
  }

  async trailClassify(
    entries: { action: string; resourceType: string; resourceId: string }[]
  ): Promise<NyvAuditTrailEntry[]> {
    return this.http.post('/api/jrx/nyaya-tools/trail/classify', { entries });
  }

  async trailPrivilegeLog(
    matterId: string,
    jurisdiction: NyvJurisdiction
  ): Promise<NyvAuditTrailEntry[]> {
    return this.http.get(`/api/jrx/nyaya-tools/trail/privilege-log?matterId=${matterId}&jurisdiction=${jurisdiction}`);
  }

  async trailEDiscovery(
    matterId: string,
    searchTerms: string[]
  ): Promise<NyvEDiscoveryResult> {
    return this.http.post('/api/jrx/nyaya-tools/trail/ediscovery', { matterId, searchTerms });
  }

  async amendProcessGazette(
    gazetteUrl: string,
    jurisdiction: NyvJurisdiction
  ): Promise<NyvGazetteProcessResult> {
    return this.http.post('/api/jrx/nyaya-tools/amend/process-gazette', { gazetteUrl, jurisdiction });
  }

  async amendAffectedMatters(amendmentId: string): Promise<NyvAffectedMattersResult> {
    return this.http.post('/api/jrx/nyaya-tools/amend/affected-matters', { amendmentId });
  }

  async getStatus(): Promise<{ tools: { name: string; status: string; version: string }[]; totalTools: number }> {
    return this.http.get('/api/jrx/nyaya-tools/status');
  }

  /** NyayaWatch — list org/user watch rules (status: ok | unavailable). */
  async listNyayaWatchRules(userId?: string): Promise<unknown> {
    if (userId) {
      return this.http.get(`/api/jrx/nyaya-tools/watch/rules/${encodeURIComponent(userId)}`);
    }
    return this.http.get('/api/jrx/nyaya-tools/watch/rules');
  }

  async createNyayaWatchRule(body: Record<string, unknown>): Promise<unknown> {
    return this.http.post('/api/jrx/nyaya-tools/watch/rules', body);
  }

  async deleteNyayaWatchRule(ruleId: string): Promise<unknown> {
    return this.http.delete(`/api/jrx/nyaya-tools/watch/rules/${encodeURIComponent(ruleId)}`);
  }
}
