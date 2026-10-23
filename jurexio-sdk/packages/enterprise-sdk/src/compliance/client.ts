import type { EnterpriseHttpClient } from '../client.js';
import type {
  DpdpaConsentGrant, DpdpaConsentStatus, Iso42001Summary,
  Soc2EvidenceReport, EuAiActClassification, BiasAssessmentReport,
} from './types.js';

export class ComplianceClient {
  constructor(private http: EnterpriseHttpClient) {}

  async checkDPDPA(userId: string): Promise<DpdpaConsentStatus> {
    return this.http.get(`/api/jrx/consent/status?userId=${userId}`);
  }

  /** Alias for DPDPA consent status — GA surface used by enterprise consumers. */
  async getConsentStatus(userId: string): Promise<DpdpaConsentStatus> {
    return this.checkDPDPA(userId);
  }

  async grantConsent(userId: string, grant: DpdpaConsentGrant): Promise<{ success: boolean }> {
    return this.http.post('/api/jrx/consent/grant', { userId, ...grant });
  }

  async withdrawConsent(userId: string, purposes: string[]): Promise<{ success: boolean }> {
    return this.http.post('/api/jrx/consent/withdraw', { userId, purposes });
  }

  async checkGDPR(userId: string): Promise<{ compliant: boolean; details: Record<string, unknown> }> {
    return this.http.get(`/api/jrx/compliance/gdpr/status?userId=${userId}`);
  }

  async checkEuAiAct(): Promise<EuAiActClassification[]> {
    return this.http.get('/api/jrx/compliance/eu-ai-act/classifications');
  }

  async getAimsInventory(): Promise<{ systems: any[] }> {
    return this.http.get('/api/jrx/compliance/aims/inventory');
  }

  async getRiskRegister(): Promise<{ risks: any[] }> {
    return this.http.get('/api/jrx/compliance/aims/risk-register');
  }

  async getIso42001Summary(): Promise<Iso42001Summary> {
    return this.http.get('/api/jrx/compliance/aims/summary');
  }

  async getSoc2Evidence(): Promise<Soc2EvidenceReport> {
    return this.http.get('/api/jrx/compliance/soc2/evidence');
  }

  async runBiasAudit(agentId: string): Promise<BiasAssessmentReport> {
    return this.http.post('/api/jrx/compliance/bias/audit', { agentId });
  }

  async getBiasReports(): Promise<BiasAssessmentReport[]> {
    return this.http.get('/api/jrx/compliance/bias/report');
  }

  async verifyHashChain(from?: string, to?: string): Promise<{ valid: boolean; entries: number; lastHash: string }> {
    return this.http.post('/api/jrx/compliance/hash-chain/verify', { from, to });
  }

  async getComplianceDashboard(): Promise<Record<string, unknown>> {
    return this.http.get('/api/jrx/compliance/dashboard');
  }
}
