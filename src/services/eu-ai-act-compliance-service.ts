/**
 * EU AI Act Compliance Service
 * Implements classification, conformity assessment, and risk management
 * per EU AI Act (Regulation 2024/1689).
 *
 * Also includes Bias Assessment Framework (G16, G17).
 *
 * @version 3.1.2
 */
import { createLogger } from '../utils/logger.js';
import {
  writeCamActionAsync,
  camActionId,
} from './compliance/jrx-cam-writer.js';

const logger = createLogger('eu-ai-act');

export type EUAIRiskCategory = 'unacceptable' | 'high' | 'limited' | 'minimal';

export interface AISystemClassification {
  systemId: string;
  systemName: string;
  riskCategory: EUAIRiskCategory;
  annexIIICategory?: string;
  rationale: string;
  prohibitions: string[];
  obligations: string[];
  conformityAssessment: ConformityAssessment;
  biasAssessment: BiasAssessmentReport;
}

export interface ConformityAssessment {
  status: 'conformant' | 'partial' | 'non_conformant' | 'pending';
  lastAssessmentDate: string;
  technicalDocumentation: Record<string, boolean>;
  transparencyMeasures: string[];
  humanOversightMeasures: string[];
  accuracyRobustness: Record<string, string>;
  cyberSecurityMeasures: string[];
}

export interface BiasAssessmentReport {
  systemId: string;
  assessmentDate: string;
  protectedAttributes: string[];
  metrics: BiasMetric[];
  overallFairnessScore: number;
  mitigations: string[];
  nextAssessmentDate: string;
}

export interface BiasMetric {
  attribute: string;
  metric: string;
  value: number;
  threshold: number;
  status: 'pass' | 'fail' | 'warning';
  description: string;
}

// EU AI Act Annex III High-Risk Categories
const HIGH_RISK_CATEGORIES = {
  '8a': 'Administration of justice and democratic processes — AI used in legal proceedings',
  '8b': 'AI used in court decisions or dispute resolution',
  '6a': 'Employment and workers management — AI for recruitment, performance assessment',
  '5a': 'Access to public services — AI used in public benefits assessment',
};

const NYAYAVIGYA_CLASSIFICATIONS: AISystemClassification[] = [
  {
    systemId: 'jrx-ns-queen',
    systemName: 'Jurexio NS-Queen Legal AI',
    riskCategory: 'high',
    annexIIICategory: 'Annex III §8(a) — Administration of justice',
    rationale: 'Platform assists with legal research, document analysis, and court-related guidance. Classified as high-risk per EU AI Act Annex III §8(a) as it is used in administration of justice contexts.',
    prohibitions: [
      'Must not make autonomous court decisions',
      'Must not be used as sole basis for legal determinations affecting fundamental rights',
      'Must not be presented as a substitute for licensed legal counsel',
    ],
    obligations: [
      'Article 9 — Risk management system: AIMS implemented (ISO 42001)',
      'Article 10 — Data governance: DPDPA consent framework active',
      'Article 11 — Technical documentation: Model cards maintained',
      'Article 13 — Transparency: Governance badge on all outputs',
      'Article 14 — Human oversight: LawyerConfirmationGate for HIGH risk outputs',
      'Article 15 — Accuracy and robustness: GRPO continuous monitoring + correctiveRAG',
      'Article 51 — Registration: Must register in EU AI Act database before EU deployment',
    ],
    conformityAssessment: {
      status: 'partial',
      lastAssessmentDate: '2026-04-06',
      technicalDocumentation: {
        'System description': true,
        'Training data description': true,
        'Architecture documentation': true,
        'Performance metrics': true,
        'Risk assessment (AIMS)': true,
        'Bias assessment': true,
        'Post-market monitoring plan': false,
        'EU conformity declaration': false,
        'Notified body assessment': false,
      },
      transparencyMeasures: [
        'JrxGovernanceBadge on all AI outputs with risk level indicator',
        'Clear "AI-generated legal research" labeling',
        'Source citations included for all statute references',
        'Confidence indicators on pattern outputs',
      ],
      humanOversightMeasures: [
        'LawyerConfirmationGate required for HIGH/CRITICAL risk outputs',
        'Maker-Checker pattern (P07) for court filings above ₹10Cr',
        'Human review required before submitting AI-assisted court documents',
      ],
      accuracyRobustness: {
        'Hallucination rate': '6% (target: <5%)',
        'Citation accuracy': '82% (target: >90%)',
        'Jurisdiction compliance': '94% (target: >95%)',
        'Corrective RAG verification': 'Active on all P11 outputs',
      },
      cyberSecurityMeasures: [
        'Quantum Security Framework v8.0 (post-quantum crypto ready)',
        'Zero Trust Architecture (Verify explicitly, Least privilege, Assume breach)',
        'Prompt injection detection in safety pipeline',
        'HMAC-SHA256 API request signing',
      ],
    },
    biasAssessment: {
      systemId: 'jrx-ns-queen',
      assessmentDate: '2026-04-06',
      protectedAttributes: ['Gender', 'Religion', 'Caste', 'Socioeconomic status', 'Geography (rural/urban)', 'Language'],
      metrics: [
        {
          attribute: 'Gender',
          metric: 'Equalized Odds Difference',
          value: 0.08,
          threshold: 0.10,
          status: 'pass',
          description: 'Legal advice quality parity across gender — within acceptable range',
        },
        {
          attribute: 'Caste',
          metric: 'Demographic Parity Ratio',
          value: 0.91,
          threshold: 0.90,
          status: 'pass',
          description: 'Scheduled caste/tribe representation in positive legal outcomes',
        },
        {
          attribute: 'Socioeconomic',
          metric: 'Individual Fairness Score',
          value: 0.78,
          threshold: 0.80,
          status: 'warning',
          description: 'Lower socioeconomic class queries receive slightly fewer citations — under investigation',
        },
        {
          attribute: 'Language',
          metric: 'Accuracy Parity Across 22 Languages',
          value: 0.84,
          threshold: 0.85,
          status: 'warning',
          description: 'Hindi and regional language accuracy slightly below English — Sarvam AI integration addresses this',
        },
        {
          attribute: 'Geography',
          metric: 'Rural Legal Query Accuracy',
          value: 0.86,
          threshold: 0.85,
          status: 'pass',
          description: 'Rural legal queries (panchayat, land rights) handled adequately',
        },
      ],
      overallFairnessScore: 0.85,
      mitigations: [
        'Diverse preference data collection across all socioeconomic groups in GRPO training',
        'Sarvam AI integration for 22 Indian language parity',
        'Jurexio Citizen product specifically designed for rural/citizen legal access',
        'Regular quarterly bias audits with independent review',
        'GRPO reward function includes fairness dimension (weight: 0.05)',
      ],
      nextAssessmentDate: '2026-07-06',
    },
  },
];

class EuAiActComplianceService {
  classifySystem(systemId: string): AISystemClassification | null {
    return NYAYAVIGYA_CLASSIFICATIONS.find(c => c.systemId === systemId) || null;
  }

  getAllClassifications(): AISystemClassification[] {
    return NYAYAVIGYA_CLASSIFICATIONS;
  }

  getComplianceGap(orgId?: string): {
    highRiskSystems: number;
    obligationsFulfilled: number;
    obligationsTotal: number;
    criticalGaps: string[];
    nextActions: string[];
  } {
    const highRisk = NYAYAVIGYA_CLASSIFICATIONS.filter(c => c.riskCategory === 'high');
    const allObligations = highRisk.flatMap(c => c.obligations);

    const criticalGaps = [
      'EU AI Act registration (Article 51) — Required before EU commercial deployment (August 2026)',
      'Notified body conformity assessment — Required for high-risk AI (contact: TÜV SÜD or BSI)',
      'Post-market monitoring plan — Technical documentation incomplete',
      'EU AI Act database registration — https://ai-act-database.ec.europa.eu',
    ];

    // Task #201: emit one CAM reviewer-queue row per critical gap.
    // Idempotent via stable action_id (orgId|gap-text hash); repeated
    // gap-analysis calls collapse to the existing row.
    for (const gap of criticalGaps) {
      writeCamActionAsync({
        actionId: camActionId(['eu_ai_act', orgId ?? 'platform', gap]),
        orgId: orgId ?? null,
        framework: 'eu_ai_act',
        controlId: 'annex-iii-8a',
        severity: 'high',
        title: `EU AI Act gap: ${gap.split(' — ')[0]}`,
        description: gap,
        triggeredBy: 'eu_ai_act_gap_analysis',
        evidenceRef: 'jrx-ns-queen',
        metadata: { systemId: 'jrx-ns-queen', source: 'getComplianceGap' },
      });
    }

    return {
      highRiskSystems: highRisk.length,
      obligationsFulfilled: allObligations.filter(o => !o.includes('Must register') && !o.includes('Notified body')).length,
      obligationsTotal: allObligations.length,
      criticalGaps,
      nextActions: [
        'Appoint EU AI Act compliance officer (Q2 2026)',
        'Complete technical documentation package (Q2 2026)',
        'Engage notified body for conformity assessment (Q3 2026)',
        'Register in EU AI Act database before EU launch (Q3 2026)',
        'Resolve bias warnings for socioeconomic and language attributes (Q2 2026)',
      ],
    };
  }

  getBiasReport(systemId?: string): BiasAssessmentReport[] {
    const systems = systemId
      ? NYAYAVIGYA_CLASSIFICATIONS.filter(c => c.systemId === systemId)
      : NYAYAVIGYA_CLASSIFICATIONS;
    return systems.map(c => c.biasAssessment);
  }
}

export const euAiActComplianceService = new EuAiActComplianceService();
export default euAiActComplianceService;
