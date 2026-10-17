export type DpdpaConsentPurpose =
  | 'ai_processing' | 'legal_research' | 'document_storage'
  | 'analytics' | 'marketing' | 'third_party_sharing'
  | 'biometric' | 'sensitive_legal_data';

export interface DpdpaConsentGrant {
  purposes: DpdpaConsentPurpose[];
  consentMethod: 'explicit' | 'implied';
  dataProcessorId?: string;
  retentionOverrideDays?: number;
  jurisdiction?: string;
}

export interface DpdpaConsentStatus {
  userId: string;
  consents: {
    purposeId: string;
    status: 'granted' | 'withdrawn' | 'expired';
    grantedAt: string;
    expiresAt: string | null;
  }[];
  activeConsents: DpdpaConsentPurpose[];
  withdrawnConsents: DpdpaConsentPurpose[];
  dpdpaCompliant: boolean;
  lastUpdated: string;
}

export interface AiSystemInventory {
  systemId: string;
  name: string;
  riskLevel: 'minimal' | 'limited' | 'high' | 'unacceptable';
  purpose: string;
  deployer: string;
  status: 'active' | 'deprecated' | 'suspended' | 'under_review';
  registeredAt: string;
}

export interface AiRiskRegisterEntry {
  riskId: string;
  systemId: string;
  riskTitle: string;
  riskCategory: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  riskScore: number;
  mitigationStatus: 'mitigated' | 'accepted' | 'pending';
  status: 'open' | 'mitigated' | 'accepted' | 'closed';
  description: string;
}

export interface Iso42001Summary {
  orgId: string;
  certificationStatus: 'certified' | 'in-progress' | 'not-started';
  iso42001: Record<string, string>;
  overallStatus: string;
  lastAuditDate: string | null;
  nextAuditDate: string | null;
  controls: { controlId: string; status: 'compliant' | 'non-compliant' | 'partial'; evidence: string }[];
  overallScore: number;
  openRisks: number;
  systemsInventoried: number;
}

export interface Soc2EvidenceReport {
  orgId: string;
  generatedAt: string;
  reportDate: string;
  overallStatus: 'compliant' | 'partial' | 'non_compliant' | 'pass' | 'fail' | 'conditional';
  trustServiceCriteria: {
    category: 'security' | 'availability' | 'processing-integrity' | 'confidentiality' | 'privacy';
    status: 'met' | 'not-met' | 'partial';
    evidenceCount: number;
  }[];
  controlsTotal: number;
  controlsPassing: number;
}

export interface EuAiActClassification {
  systemId: string;
  systemName: string;
  riskCategory: 'unacceptable' | 'high' | 'limited' | 'minimal';
  article: string;
  annexIIICategory?: string;
  obligations: string[];
  complianceStatus: 'compliant' | 'non-compliant' | 'pending-review';
}

export interface BiasAssessmentReport {
  agentId: string;
  systemId: string;
  overallBiasScore: number;
  overallFairnessScore: number;
  assessmentDate: string;
  nextAssessmentDate: string;
  dimensionScores: Record<string, number>;
  recommendations: string[];
  status: 'pass' | 'fail' | 'warning';
}
