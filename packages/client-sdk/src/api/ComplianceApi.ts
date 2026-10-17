import type { NyvHttpClient } from '../NyvClient.js';
import type {
  NyvEuComplianceReport,
  NyvBiasAuditReport,
  NyvWatermarkResult,
  NyvSigningSession,
} from '../types/index.js';

export class ComplianceApi {
  constructor(private http: NyvHttpClient) {}

  async getEuComplianceReport(): Promise<NyvEuComplianceReport> {
    return this.http.get('/api/jrx/compliance/eu-ai-act/report');
  }

  async getBiasAudit(agentId: string): Promise<NyvBiasAuditReport> {
    return this.http.get(`/api/jrx/compliance/bias-audit/${agentId}`);
  }

  async getRiskManagementDoc(agentId: string): Promise<Record<string, unknown>> {
    return this.http.get(`/api/jrx/compliance/eu-ai-act/article9/${agentId}`);
  }

  async getTechnicalDoc(agentId: string): Promise<Record<string, unknown>> {
    return this.http.get(`/api/jrx/compliance/eu-ai-act/article11/${agentId}`);
  }

  async watermarkContent(content: string, method: 'invisible' | 'visible' | 'both' = 'invisible'): Promise<NyvWatermarkResult> {
    return this.http.post('/api/jrx/compliance/watermark', { content, method });
  }

  async verifyWatermark(content: string): Promise<{ verified: boolean; hash: string }> {
    return this.http.post('/api/jrx/compliance/watermark/verify', { content });
  }

  async createSigningSession(documentHash: string, signers: string[]): Promise<NyvSigningSession> {
    return this.http.post('/api/jrx/compliance/digital-sign/create', { documentHash, signers });
  }

  async getSigningStatus(sessionId: string): Promise<NyvSigningSession> {
    return this.http.get(`/api/jrx/compliance/digital-sign/${sessionId}`);
  }

  async getDashboard(): Promise<Record<string, unknown>> {
    return this.http.get('/api/jrx/compliance/dashboard');
  }

  /** Platform evidence pack (not SOC2 certification). */
  async getEvidencePack(frameworks?: string[]): Promise<unknown> {
    const qs = frameworks?.length ? `?frameworks=${encodeURIComponent(frameworks.join(','))}` : '';
    return this.http.get(`/api/jrx/compliance/evidence-pack${qs}`);
  }

  async createEvidencePack(body: Record<string, unknown> = {}): Promise<unknown> {
    return this.http.post('/api/jrx/compliance/evidence-pack', body);
  }
}
