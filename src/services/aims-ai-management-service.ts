/**
 * ISO 42001 AI Management System (AIMS) Service
 * Implements AI governance, risk register, and model cards per ISO/IEC 42001:2023.
 *
 * @version 3.1.2
 */
import { db as _raw_db } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { sql } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('aims-service');

export type AIRiskLevel = 'minimal' | 'limited' | 'high' | 'unacceptable';
export type AISystemStatus = 'active' | 'deprecated' | 'suspended' | 'under_review';

export interface AISystemInventoryItem {
  systemId: string;
  name: string;
  description: string;
  version: string;
  purpose: string;
  riskLevel: AIRiskLevel;
  status: AISystemStatus;
  jurisdiction: string[];
  modelProvider: string;
  modelName: string;
  capabilities: string[];
  limitations: string[];
  dataCategories: string[];
  humanOversight: boolean;
  auditTrail: boolean;
  lastAuditDate?: string;
}

export interface AIRiskRegisterEntry {
  riskId: string;
  systemId: string;
  riskTitle: string;
  riskDescription: string;
  likelihood: 'rare' | 'unlikely' | 'possible' | 'likely' | 'almost_certain';
  impact: 'negligible' | 'minor' | 'moderate' | 'major' | 'catastrophic';
  riskScore: number;
  controls: string[];
  residualRisk: string;
  owner: string;
  reviewDate: string;
  status: 'open' | 'mitigated' | 'accepted' | 'closed';
}

export interface ModelCard {
  modelId: string;
  systemId: string;
  modelName: string;
  provider: string;
  version: string;
  trainingData: string;
  evaluationMetrics: Record<string, number>;
  intendedUses: string[];
  outOfScopeUses: string[];
  biasConsiderations: string;
  fairnessMetrics: Record<string, number>;
  explainability: string;
  euAiActClassification: string;
  iso42001Controls: string[];
}

// Jurexio AI System Inventory (per ISO 42001 §6.1)
const AI_SYSTEMS: AISystemInventoryItem[] = [
  {
    systemId: 'nyv-ns-queen',
    name: 'Jurexio NS-Queen Orchestrator',
    description: 'Master orchestration agent routing legal queries to 149 specialist agents',
    version: '3.1.2',
    purpose: 'Route and orchestrate legal queries across jurisdictions and practice areas',
    riskLevel: 'high',
    status: 'active',
    jurisdiction: ['IN', 'UK', 'EU', 'US', 'GC', 'SG'],
    modelProvider: 'OpenRouter',
    modelName: 'claude-3-5-sonnet / gpt-4o / gemini-1.5-pro',
    capabilities: ['Legal query routing', 'Multi-agent orchestration', 'Jurisdiction detection'],
    limitations: ['Not a licensed legal advisor', 'May hallucinate statute citations', 'Requires human review for HIGH risk outputs'],
    dataCategories: ['Legal queries', 'Case documents (PII-redacted)', 'Jurisdiction context'],
    humanOversight: true,
    auditTrail: true,
    lastAuditDate: '2026-04-06',
  },
  {
    systemId: 'nyv-grpo',
    name: 'GRPO Legal Preference Optimizer',
    description: 'Group Relative Policy Optimization for continuous legal AI improvement via RLHF',
    version: '3.1.2',
    purpose: 'Improve legal reasoning quality through lawyer feedback accumulation',
    riskLevel: 'limited',
    status: 'active',
    jurisdiction: ['IN', 'UK', 'EU', 'US', 'GC', 'SG'],
    modelProvider: 'Internal',
    modelName: 'GRPO v3.1.2 (8 reward dimensions)',
    capabilities: ['Preference learning', 'Policy optimization', 'Quality scoring'],
    limitations: ['Requires human preference data', 'Cold start with limited feedback data'],
    dataCategories: ['Legal reasoning trajectories', 'Lawyer preference signals'],
    humanOversight: true,
    auditTrail: true,
    lastAuditDate: '2026-04-06',
  },
  {
    systemId: 'nyv-rag-p11',
    name: 'NyayaRAG Hybrid Retrieval System',
    description: 'BM25 + pgvector hybrid RAG for statute and precedent retrieval (P11)',
    version: '3.1.2',
    purpose: 'Retrieve relevant legal statutes and judgments for legal research',
    riskLevel: 'limited',
    status: 'active',
    jurisdiction: ['IN', 'UK', 'EU', 'US', 'GC', 'SG'],
    modelProvider: 'Internal + OpenAI',
    modelName: 'text-embedding-3-small + BM25',
    capabilities: ['Statute retrieval', 'Semantic search', 'BM25 keyword matching', 'RRF fusion'],
    limitations: ['Limited to seeded statute corpus', 'UK/US corpora partially seeded'],
    dataCategories: ['Legal queries', 'Statute text (public domain)'],
    humanOversight: false,
    auditTrail: true,
    lastAuditDate: '2026-04-06',
  },
  {
    systemId: 'nyv-safety-pipeline',
    name: '10-Step AI Safety Pipeline',
    description: 'Pre/post processing safety pipeline for all AI outputs',
    version: '3.1.2',
    purpose: 'Ensure AI outputs are safe, non-hallucinated, jurisdiction-compliant',
    riskLevel: 'minimal',
    status: 'active',
    jurisdiction: ['IN', 'UK', 'EU', 'US', 'GC', 'SG'],
    modelProvider: 'Internal',
    modelName: 'Rules-based + NLP',
    capabilities: ['PII detection', 'Hallucination check', 'Jurisdiction compliance', 'Prompt injection detection'],
    limitations: ['May flag legitimate content as unsafe in edge cases'],
    dataCategories: ['AI query/response pairs'],
    humanOversight: false,
    auditTrail: true,
    lastAuditDate: '2026-04-06',
  },
];

// Risk register per ISO 42001 §6.1.2
const RISK_REGISTER: AIRiskRegisterEntry[] = [
  {
    riskId: 'R001',
    systemId: 'nyv-ns-queen',
    riskTitle: 'AI Hallucination in Statute Citations',
    riskDescription: 'LLM may generate plausible but incorrect statute section numbers or case citations',
    likelihood: 'possible',
    impact: 'major',
    riskScore: 12,
    controls: ['Corrective RAG verification', 'Citation grounding against statute DB', 'Mandatory human review for HIGH risk', 'Confidence threshold enforcement'],
    residualRisk: 'Low — after RAG grounding and human review gate',
    owner: 'AI Safety Team',
    reviewDate: '2026-07-01',
    status: 'mitigated',
  },
  {
    riskId: 'R002',
    systemId: 'nyv-ns-queen',
    riskTitle: 'Unauthorised Legal Advice',
    riskDescription: 'Platform output may be interpreted as formal legal advice by laypersons',
    likelihood: 'likely',
    impact: 'major',
    riskScore: 16,
    controls: ['Mandatory disclaimer on all outputs', 'Governance badge for HIGH/CRITICAL risk', 'Lawyer confirmation gate for sensitive actions', 'ToS requiring professional review'],
    residualRisk: 'Medium — disclaimer and UX controls reduce but cannot eliminate risk',
    owner: 'Legal & Compliance Team',
    reviewDate: '2026-07-01',
    status: 'mitigated',
  },
  {
    riskId: 'R003',
    systemId: 'nyv-grpo',
    riskTitle: 'Bias Amplification in Legal Reasoning',
    riskDescription: 'GRPO may amplify biases present in lawyer preference data',
    likelihood: 'possible',
    impact: 'moderate',
    riskScore: 9,
    controls: ['Diverse preference data collection', 'Bias monitoring across protected classes', 'Regular fairness audits', 'Reward function includes fairness dimension'],
    residualRisk: 'Low — with monitoring and diverse training data',
    owner: 'AI Safety Team',
    reviewDate: '2026-10-01',
    status: 'open',
  },
  {
    riskId: 'R004',
    systemId: 'nyv-rag-p11',
    riskTitle: 'Outdated Statute Retrieval',
    riskDescription: 'Statute corpus may not reflect latest amendments leading to incorrect advice',
    likelihood: 'possible',
    impact: 'major',
    riskScore: 12,
    controls: ['Regulatory monitor for amendment alerts', 'Statute amendment date displayed in citations', 'Quarterly corpus refresh schedule'],
    residualRisk: 'Medium — quarterly refresh cycle leaves amendment window',
    owner: 'Data Team',
    reviewDate: '2026-07-01',
    status: 'open',
  },
];

const MODEL_CARDS: ModelCard[] = [
  {
    modelId: 'mc-001',
    systemId: 'nyv-ns-queen',
    modelName: 'Claude 3.5 Sonnet (Primary)',
    provider: 'Anthropic via OpenRouter',
    version: 'claude-3-5-sonnet-20241022',
    trainingData: 'Internet text corpus up to April 2024; no fine-tuning on Jurexio data',
    evaluationMetrics: {
      'legal_accuracy': 0.87,
      'citation_precision': 0.82,
      'jurisdiction_compliance': 0.94,
      'hallucination_rate': 0.06,
    },
    intendedUses: ['Legal research assistance', 'Document analysis', 'Statute interpretation guidance'],
    outOfScopeUses: ['Formal legal advice', 'Court submissions without lawyer review', 'High-stakes decisions without human oversight'],
    biasConsiderations: 'Model may reflect biases in training data. Jurexio applies post-processing safety pipeline. Regular bias audits conducted quarterly.',
    fairnessMetrics: {
      'gender_bias_score': 0.12,
      'socioeconomic_bias_score': 0.18,
      'jurisdictional_parity': 0.89,
    },
    explainability: 'Chain-of-thought reasoning surfaced via CoT pattern (P02). All citations include source statute and section.',
    euAiActClassification: 'High-risk AI system (Annex III §8 — Administration of justice)',
    iso42001Controls: ['6.1.2 Risk assessment', '7.5 Documented information', '9.1 Monitoring', '10.2 Continual improvement'],
  },
];

class AimsService {
  getInventory(): AISystemInventoryItem[] {
    return AI_SYSTEMS;
  }

  getRiskRegister(filters?: { systemId?: string; status?: string; riskLevel?: string }): AIRiskRegisterEntry[] {
    let risks = RISK_REGISTER;
    if (filters?.systemId) risks = risks.filter(r => r.systemId === filters.systemId);
    if (filters?.status) risks = risks.filter(r => r.status === filters.status);
    return risks;
  }

  getModelCards(systemId?: string): ModelCard[] {
    return systemId ? MODEL_CARDS.filter(m => m.systemId === systemId) : MODEL_CARDS;
  }

  getComplianceSummary(): {
    iso42001: Record<string, string>;
    overallStatus: string;
    lastReview: string;
    openRisks: number;
    systemsInventoried: number;
  } {
    const openRisks = RISK_REGISTER.filter(r => r.status === 'open').length;
    return {
      iso42001: {
        '4 — Context': '✅ Organisational context defined (6 jurisdictions, 5 products)',
        '5 — Leadership': '✅ AI Policy established; roles assigned',
        '6 — Planning': `⚠️ Risk register has ${openRisks} open items`,
        '7 — Support': '✅ Resources, training, documentation in place',
        '8 — Operation': '✅ AI system development controls operational',
        '9 — Performance': '✅ GRPO monitoring; bias audits scheduled',
        '10 — Improvement': '✅ GRPO continuous improvement loop active',
      },
      overallStatus: openRisks > 2 ? 'Partial Compliance — Actions Required' : 'Substantially Compliant',
      lastReview: '2026-04-06',
      openRisks,
      systemsInventoried: AI_SYSTEMS.length,
    };
  }

  async logAiUsage(entry: { systemId: string; userId: string; action: string; jurisdiction: string; riskLevel: AIRiskLevel }): Promise<void> {
    logger.info('aims_ai_usage', entry);
  }
}

export const aimsService = new AimsService();
export default aimsService;
