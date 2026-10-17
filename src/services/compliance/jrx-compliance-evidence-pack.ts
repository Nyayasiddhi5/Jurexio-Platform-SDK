/**
 * NV-COMPLIANCE-EVIDENCE-PACK-001 — Structured evidence checklist export.
 * Returns DPDPA / GDPR / SOC2 / ISO42001 evidence *structure* plus live
 * **platform evidence** snapshots (audit hash chain, residency, row counts).
 * Never fabricated certificates, SOC2 attestation, or audit passes.
 */
import { sql } from 'drizzle-orm';
import { db as _rawDb } from '../../db/index.js';
import { lazyRequire } from '../../utils/jrx-type-helpers.js';
import { isJrxFeatureOn } from '../../config/jrx-feature-flags.js';
import { getEnterpriseGovernanceDefaultSnapshot } from '../../config/jrx-enterprise-governance-defaults.js';
import { JRX_JURISDICTIONS } from '../../config/jrx-master-config.js';
import { runHashChainVerification } from '../hash-chain-verifier.js';

const db = lazyRequire(() => _rawDb, 'db');

export type EvidenceFramework = 'DPDPA' | 'GDPR' | 'SOC2' | 'ISO42001';

export interface EvidenceChecklistItem {
  controlId: string;
  title: string;
  description: string;
  automationLevel: 'manual' | 'hybrid' | 'automated';
  evidenceSource: string;
  collectionEndpoint?: string;
  status: 'structure_only' | 'collectable' | 'not_configured';
  notes?: string;
}

export interface PlatformEvidenceSnapshot {
  /** Explicit label — platform-collected artifacts, not third-party certification. */
  evidenceClass: 'platform_evidence';
  collectedAt: string;
  dataResidency: {
    primaryRegion: string;
    jurisdictions: Record<string, string>;
  };
  auditHashChain: Array<{
    platform: string;
    table: string;
    totalRecords: number;
    validRecords: number;
    brokenLinks: number;
    integrityScore: number;
    verified: boolean;
    verifiedAt: string;
  }>;
  complianceEvidenceRows: {
    total: number;
    byFramework: Record<string, number>;
    latestCreatedAt: string | null;
  };
  consentRecords: { total: number };
  auditLogHead: {
    latestRecordHash: string | null;
    latestCreatedAt: string | null;
    rowCount: number;
  };
  rlsPosture: {
    enforceEnvFlag: boolean;
    note: string;
  };
  collectionErrors: string[];
}

export interface ComplianceEvidencePack {
  generatedAt: string;
  disclaimer: string;
  frameworks: EvidenceFramework[];
  governanceDefaults: ReturnType<typeof getEnterpriseGovernanceDefaultSnapshot>;
  featureFlags: {
    auditWire: boolean;
    hitlRegistry: boolean;
    govMakerChecker: boolean;
    govSecurityMon: boolean;
  };
  /** Live DB / hash-chain snapshots — label is platform evidence, not SOC2 certified. */
  platformEvidence: PlatformEvidenceSnapshot;
  checklists: Record<EvidenceFramework, EvidenceChecklistItem[]>;
}

const DISCLAIMER =
  'Platform evidence pack — structured checklists plus live row/hash/residency snapshots. ' +
  'Not a SOC2 certification, ISO attestation, or external audit report. ' +
  'Operators must collect and validate artifacts from the cited sources before submission.';

function dpdpaChecklist(): EvidenceChecklistItem[] {
  return [
    {
      controlId: 'DPDPA-§6',
      title: 'Lawful purpose & consent records',
      description: 'Purpose-limited processing with verifiable consent artefacts per data principal.',
      automationLevel: 'hybrid',
      evidenceSource: 'nv_schema.consent_records + /api/jrx/consent/*',
      collectionEndpoint: '/api/jrx/consent/purposes',
      status: 'collectable',
    },
    {
      controlId: 'DPDPA-§8(6)',
      title: 'Personal data breach notification workflow',
      description: 'Breach notice drafts, CAM queue entries, and IronLedger hash-chain events.',
      automationLevel: 'hybrid',
      evidenceSource: './jrx-breach-notice-service + hitl_workflow_executions',
      collectionEndpoint: '/api/jrx/compliance/breach',
      status: 'collectable',
    },
    {
      controlId: 'DPDPA-§12',
      title: 'Data principal rights (access / correction / erasure)',
      description: 'DSAR handling logs and retention sweep dry-run counts.',
      automationLevel: 'manual',
      evidenceSource: 'nv_schema.compliance_evidence + retention service logs',
      collectionEndpoint: '/api/jrx/compliance/dashboard',
      status: 'structure_only',
    },
  ];
}

function gdprChecklist(): EvidenceChecklistItem[] {
  return [
    {
      controlId: 'GDPR-Art-30',
      title: 'Records of processing activities (ROPA)',
      description: 'AIMS inventory and data-lineage events for AI processing systems.',
      automationLevel: 'automated',
      evidenceSource: 'aims-ai-management-service',
      collectionEndpoint: '/api/jrx/compliance/aims/inventory',
      status: 'collectable',
    },
    {
      controlId: 'GDPR-Art-35',
      title: 'Data protection impact assessment (DPIA)',
      description: 'High-risk processing triggers and DPO review workflow artefacts.',
      automationLevel: 'hybrid',
      evidenceSource: 'nv_schema.compliance_evidence (framework=GDPR)',
      status: 'structure_only',
    },
    {
      controlId: 'GDPR-Art-32',
      title: 'Security of processing',
      description: 'Safety ring outputs, PII redaction logs, and audit hash chain.',
      automationLevel: 'automated',
      evidenceSource: 'nv_audit_logs + safety-pipeline metrics',
      collectionEndpoint: '/api/jrx/compliance/soc2/evidence',
      status: 'collectable',
    },
  ];
}

function soc2Checklist(): EvidenceChecklistItem[] {
  return [
    {
      controlId: 'CC6.1',
      title: 'Logical access controls',
      description: 'RBAC role matrix, API key rotation metadata, org RLS enforcement.',
      automationLevel: 'hybrid',
      evidenceSource: 'nv_rbac_* tables + /api/jrx/rbac/*',
      collectionEndpoint: '/api/jrx/compliance/soc2/evidence',
      status: 'collectable',
    },
    {
      controlId: 'CC7.2',
      title: 'System monitoring',
      description: 'Security monitor middleware events and platform health snapshots.',
      automationLevel: 'automated',
      evidenceSource: './jrx-security-monitor + /api/jrx/health/full',
      collectionEndpoint: '/api/jrx/health/full',
      status: 'collectable',
    },
    {
      controlId: 'CC8.1',
      title: 'Change management',
      description: 'Project-Tracker change log rows and deployment smoke evidence pointers.',
      automationLevel: 'manual',
      evidenceSource: 'Project-Tracker.md + UAT smoke reports',
      status: 'structure_only',
      notes: 'Export change-log rows manually; no auto-certification.',
    },
    {
      controlId: 'A1.2',
      title: 'Availability — Multi-AZ data plane',
      description: 'RDS Multi-AZ + ElastiCache Multi-AZ/failover for gateway persistence.',
      automationLevel: 'hybrid',
      evidenceSource: 'AWS RDS/ElastiCache console + /api/jrx/health/full',
      collectionEndpoint: '/api/jrx/health/full',
      status: 'collectable',
      notes: 'Infra evidence ready; SOC2 Type II observation window still requires auditor.',
    },
    {
      controlId: 'C1.2',
      title: 'Confidentiality — native document attestation',
      description: 'JRX-native HMAC e-sign attestation on nv_esign_sessions.metadata (not DocuSign).',
      automationLevel: 'automated',
      evidenceSource: './jrx-esign-adapter-service + nv_esign_sessions',
      status: 'collectable',
      notes: 'Platform-native intent attestation only; partner OAuth e-sign remains PARKED.',
    },
  ];
}

function iso42001Checklist(): EvidenceChecklistItem[] {
  return [
    {
      controlId: 'AIMS-6.1',
      title: 'AI risk register',
      description: 'ISO 42001 AIMS risk register entries per deployed AI system.',
      automationLevel: 'automated',
      evidenceSource: 'aims-ai-management-service',
      collectionEndpoint: '/api/jrx/compliance/aims/risk-register',
      status: 'collectable',
    },
    {
      controlId: 'AIMS-8.2',
      title: 'Model cards & system documentation',
      description: 'Published model cards for in-production LLM routes.',
      automationLevel: 'automated',
      evidenceSource: 'aims-ai-management-service',
      collectionEndpoint: '/api/jrx/compliance/aims/model-cards',
      status: 'collectable',
    },
  ];
}

async function collectPlatformEvidenceSnapshot(): Promise<PlatformEvidenceSnapshot> {
  const collectionErrors: string[] = [];
  const jurisdictions: Record<string, string> = {};
  for (const [code, cfg] of Object.entries(JRX_JURISDICTIONS)) {
    jurisdictions[code] = cfg.dataResidency;
  }

  let hashChainResults: PlatformEvidenceSnapshot['auditHashChain'] = [];
  try {
    const verified = await runHashChainVerification();
    hashChainResults = verified.map(r => ({
      platform: r.platform,
      table: r.table,
      totalRecords: r.totalRecords,
      validRecords: r.validRecords,
      brokenLinks: r.brokenLinks.length,
      integrityScore: r.integrityScore,
      verified: r.verified,
      verifiedAt: r.verifiedAt,
    }));
  } catch (err: any) {
    collectionErrors.push(`hash_chain: ${err?.message ?? String(err)}`);
  }

  let complianceTotal = 0;
  const byFramework: Record<string, number> = {};
  let latestCreatedAt: string | null = null;
  try {
    const fwRows = await db.execute(sql`
      SELECT framework, COUNT(*)::int AS cnt
      FROM nv_schema.compliance_evidence
      GROUP BY framework
    `);
    for (const row of (fwRows.rows ?? []) as Array<{ framework: string; cnt: number }>) {
      byFramework[row.framework] = Number(row.cnt) || 0;
      complianceTotal += Number(row.cnt) || 0;
    }
    const latest = await db.execute(sql`
      SELECT created_at::text AS created_at
      FROM nv_schema.compliance_evidence
      ORDER BY created_at DESC
      LIMIT 1
    `);
    latestCreatedAt = (latest.rows?.[0] as { created_at?: string })?.created_at ?? null;
  } catch (err: any) {
    collectionErrors.push(`compliance_evidence: ${err?.message ?? String(err)}`);
  }

  let consentTotal = 0;
  try {
    const consent = await db.execute(sql`
      SELECT COUNT(*)::int AS cnt FROM nv_schema.nv_consent_records
    `);
    consentTotal = Number((consent.rows?.[0] as { cnt?: number })?.cnt ?? 0);
  } catch (err: any) {
    collectionErrors.push(`nv_consent_records: ${err?.message ?? String(err)}`);
  }

  let auditRowCount = 0;
  let latestRecordHash: string | null = null;
  let auditLatestCreatedAt: string | null = null;
  try {
    const head = await db.execute(sql`
      SELECT record_hash, created_at::text AS created_at
      FROM nv_schema.nv_audit_logs
      ORDER BY id DESC
      LIMIT 1
    `);
    const headRow = head.rows?.[0] as { record_hash?: string; created_at?: string } | undefined;
    latestRecordHash = headRow?.record_hash ?? null;
    auditLatestCreatedAt = headRow?.created_at ?? null;

    const count = await db.execute(sql`
      SELECT COUNT(*)::int AS cnt FROM nv_schema.nv_audit_logs
    `);
    auditRowCount = Number((count.rows?.[0] as { cnt?: number })?.cnt ?? 0);
  } catch (err: any) {
    collectionErrors.push(`nv_audit_logs: ${err?.message ?? String(err)}`);
  }

  const enforceEnvFlag = (process.env.JRX_RLS_ENFORCE ?? '').toLowerCase() === 'true'
    || process.env.JRX_RLS_ENFORCE === '1';

  return {
    evidenceClass: 'platform_evidence',
    collectedAt: new Date().toISOString(),
    dataResidency: {
      primaryRegion: process.env.AWS_REGION || process.env.JRX_S3_REGION || 'ap-south-1',
      jurisdictions,
    },
    auditHashChain: hashChainResults,
    complianceEvidenceRows: {
      total: complianceTotal,
      byFramework,
      latestCreatedAt,
    },
    consentRecords: { total: consentTotal },
    auditLogHead: {
      latestRecordHash,
      latestCreatedAt: auditLatestCreatedAt,
      rowCount: auditRowCount,
    },
    rlsPosture: {
      enforceEnvFlag,
      note: enforceEnvFlag
        ? 'JRX_RLS_ENFORCE active in this process — confirm runtime DSN uses nv_app role.'
        : 'RLS policies installed; enforcement gated — see SOP/15-RLS-ENFORCE-AND-RDS-CA-PIN-2026-07.md.',
    },
    collectionErrors,
  };
}

export async function buildComplianceEvidencePack(
  frameworks?: EvidenceFramework[],
): Promise<ComplianceEvidencePack> {
  const selected = frameworks?.length
    ? frameworks
    : (['DPDPA', 'GDPR', 'SOC2', 'ISO42001'] as EvidenceFramework[]);

  const checklists = {} as Record<EvidenceFramework, EvidenceChecklistItem[]>;
  for (const f of selected) {
    if (f === 'DPDPA') checklists.DPDPA = dpdpaChecklist();
    if (f === 'GDPR') checklists.GDPR = gdprChecklist();
    if (f === 'SOC2') checklists.SOC2 = soc2Checklist();
    if (f === 'ISO42001') checklists.ISO42001 = iso42001Checklist();
  }

  const platformEvidence = await collectPlatformEvidenceSnapshot();

  return {
    generatedAt: new Date().toISOString(),
    disclaimer: DISCLAIMER,
    frameworks: selected,
    governanceDefaults: getEnterpriseGovernanceDefaultSnapshot(),
    featureFlags: {
      auditWire: isJrxFeatureOn('auditWire'),
      hitlRegistry: isJrxFeatureOn('hitlRegistry'),
      govMakerChecker: isJrxFeatureOn('govMakerChecker'),
      govSecurityMon: isJrxFeatureOn('govSecurityMon'),
    },
    platformEvidence,
    checklists,
  };
}
