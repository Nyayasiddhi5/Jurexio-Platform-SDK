/**
 * Nyayavigya Platform — Canonical Policies Seeder
 * Seeds nv_policies + nv_policy_versions + nv_policy_assignments + nv_policy_violations
 * with the platform's standing operational policies.
 */

import { makePgSql } from './_pg-pool.js';
import { assertColumns } from './_assert-columns.js';
import * as dotenv from 'dotenv';

dotenv.config();
const sql = makePgSql();

// task #347: schema-drift guard — fail loud before any INSERT.
const REQUIRED_COLUMNS = {
  'public.nv_policies': [
    'org_id', 'policy_code', 'name', 'category', 'jurisdiction', 'severity',
    'status', 'owner_team', 'description', 'rules', 'current_version',
    'effective_at', 'review_at', 'framework_refs',
  ],
  'public.nv_policy_versions': [
    'policy_id', 'version', 'body_md', 'changelog', 'published_by', 'published_at',
  ],
  'public.nv_policy_assignments': [
    'policy_id', 'scope_type', 'scope_value', 'assigned_by', 'assigned_at',
    'ack_required', 'ack_count',
  ],
} as const;

interface PolicyDef {
  code: string;
  name: string;
  category: 'ai-safety' | 'security' | 'privacy' | 'data' | 'people' | 'legal-ethics' | 'operations';
  jurisdiction: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'active' | 'draft';
  owner: string;
  description: string;
  rules: string[];
  framework_refs: string[];
  body_md: string;
  assignments: Array<{ scope_type: string; scope_value: string; ack_required: boolean }>;
}

const POLICIES: PolicyDef[] = [
  {
    code:'POL-AI-001', name:'No-Bypass Safety Ring', category:'ai-safety', jurisdiction:'ALL',
    severity:'critical', status:'active', owner:'AI Safety',
    description:'Every LLM call MUST go through realLLMService.executeRequest → orchestrateLLM(req). No direct provider SDK calls in application code.',
    rules:[
      'No direct openai/anthropic/google SDK imports in app code (CI-enforced via NV-LLM-001).',
      'realLLMService.executeRequest is the only entry point for LLM traffic.',
      'PII redaction MUST run before any external provider call.',
      'Hallucination + bias + citation checks run on every output.',
    ],
    framework_refs:['EU-AI-ACT:Art-9','NIST-AI-RMF:MANAGE-1.1','ISO-42001:Anx-A.6.2.2'],
    body_md:'# No-Bypass Safety Ring\n\nThis policy enforces NV-LLM-001. All LLM traffic flows through the safety ring; the last statement of `realLLMService.executeRequest` MUST be `return orchestrateLLM(req)`. Violations fail CI.',
    assignments:[{ scope_type:'role', scope_value:'engineer', ack_required:true },{ scope_type:'team', scope_value:'AI Safety', ack_required:true }],
  },
  {
    code:'POL-AI-002', name:'Generative AI Citation Verification', category:'legal-ethics', jurisdiction:'ALL',
    severity:'critical', status:'active', owner:'AI Safety',
    description:'Every legal citation produced by a generative agent MUST be programmatically verified against the case-law datastore before delivery.',
    rules:['Unverified citations are blocked.','HITL review is required when verifier confidence < 0.85.','Citation verification logs persist to nv_audit_logs.'],
    framework_refs:['ABA-MR:MR-3.3','ABA-512:512-MERIT','BCI-IT:BCI-4'],
    body_md:'# Citation Verification\n\nProtects the platform and its lawyer-users against ABA Model Rule 3.3 violations from hallucinated citations.',
    assignments:[{ scope_type:'platform', scope_value:'NSP', ack_required:false },{ scope_type:'platform', scope_value:'NSI', ack_required:false },{ scope_type:'platform', scope_value:'JRX', ack_required:false }],
  },
  {
    code:'POL-AI-003', name:'Human-in-the-Loop Review Triggers', category:'ai-safety', jurisdiction:'ALL',
    severity:'high', status:'active', owner:'AI Safety',
    description:'Defines when an AI decision MUST be routed to a human reviewer.',
    rules:['Confidence < threshold for jurisdictional advice.','Detected PII categories: SSN/Aadhaar/financial-identifier.','Output references statutory penalty or court filing.','User explicitly requests review.'],
    framework_refs:['EU-AI-ACT:Art-14','NIST-AI-RMF:GENAI-6','ISO-42001:Anx-A.6.2.7'],
    body_md:'# HITL Triggers\n\nDeterministic triggers for routing requests into nv_hitl_queue with SLA.',
    assignments:[{ scope_type:'role', scope_value:'org_admin', ack_required:false },{ scope_type:'team', scope_value:'AI Safety', ack_required:true }],
  },
  {
    code:'POL-AI-004', name:'Bias Audit and Disparate Impact Threshold', category:'ai-safety', jurisdiction:'ALL',
    severity:'high', status:'active', owner:'AI Safety',
    description:'Output disparity across protected attributes must be ≤ 0.10; breaches trigger model rollback.',
    rules:['Daily bias evaluation per agent + jurisdiction.','Score persisted in nv_llm_evaluations.','Breaches generate POL-VIOL events on this policy.'],
    framework_refs:['EU-AI-ACT:Art-10','NIST-AI-RMF:GENAI-5','IL-AI-ACT:IL-AI-3'],
    body_md:'# Bias Audit\n\nProtects against disparate impact in employment + decisioning use cases.',
    assignments:[{ scope_type:'team', scope_value:'AI Safety', ack_required:true }],
  },
  {
    code:'POL-AI-005', name:'Adversarial Red-Team Cadence', category:'ai-safety', jurisdiction:'ALL',
    severity:'high', status:'active', owner:'AI Safety',
    description:'Weekly adversarial / prompt-injection corpus run against every production agent.',
    rules:['100% pass rate required.','Failures auto-suspend the affected agent.','Corpus refreshed quarterly.'],
    framework_refs:['EU-AI-ACT:GPAI-4','NIST-AI-RMF:GENAI-12'],
    body_md:'# Adversarial Cadence\n\nRed team is the only customer who is *supposed* to break things.',
    assignments:[{ scope_type:'team', scope_value:'AI Safety', ack_required:true }],
  },

  {
    code:'POL-SEC-001', name:'SDK Key Rotation', category:'security', jurisdiction:'ALL',
    severity:'critical', status:'active', owner:'Platform Security',
    description:'All 7 platform SDK keys rotate on a 180-day cadence; emergency rotation < 1 hour.',
    rules:['Cadence: 180d.','Emergency rotation route: POST /api/jrx/auth/rotate.','Both old + new keys honoured for 24h overlap.'],
    framework_refs:['SOC2-TSC:CC6.1','ISO-27001:A.8.4','NYDFS-500:500.7'],
    body_md:'# SDK Key Rotation\n\nKeys rotate quarterly with overlap; emergency runbook on file.',
    assignments:[{ scope_type:'team', scope_value:'Platform Security', ack_required:true }],
  },
  {
    code:'POL-SEC-002', name:'Password and Authentication Policy', category:'security', jurisdiction:'ALL',
    severity:'critical', status:'active', owner:'Platform Security',
    description:'Minimum 12-char passwords, complexity, MFA mandatory for org_admin and super_admin.',
    rules:['≥12 chars, mixed case + digit + symbol.','MFA TOTP for org_admin/super_admin/billing.','5 failed attempts → 15-min lockout.','bcrypt cost factor 12.'],
    framework_refs:['SOC2-TSC:CC6.6','HIPAA:164.308(a)(5)','NIST-AI-RMF:GOVERN-1.2'],
    body_md:'# Password & Auth\n\nApplies to all human and machine principals.',
    assignments:[{ scope_type:'role', scope_value:'all-users', ack_required:true }],
  },
  {
    code:'POL-SEC-003', name:'RBAC and Least-Privilege', category:'security', jurisdiction:'ALL',
    severity:'high', status:'active', owner:'Platform Security',
    description:'Role grants follow least-privilege; quarterly access review.',
    rules:['7-tier role hierarchy enforced.','Cross-org access requires super_admin.','Access reviews quarterly with org_admin attestation.'],
    framework_refs:['SOC2-TSC:CC6.3','ISO-27001:A.5.18'],
    body_md:'# RBAC\n\nLeast-privilege is the default; elevations are time-bounded and logged.',
    assignments:[{ scope_type:'role', scope_value:'org_admin', ack_required:true }],
  },
  {
    code:'POL-SEC-004', name:'EC2 Hardening Baseline', category:'security', jurisdiction:'ALL',
    severity:'high', status:'active', owner:'Platform Infra',
    description:'EC2 instances must meet CIS Amazon Linux 2023 L1; SSH disabled; SSM-only access.',
    rules:['No 22/tcp open.','Patch SLA: critical 7d, high 30d.','GuardDuty findings 1-hour triage SLA.'],
    framework_refs:['ISO-27001:A.8.9','SOC2-TSC:CC7.1'],
    body_md:'# EC2 Hardening\n\nCIS L1 baseline. Inspector findings auto-ticketed.',
    assignments:[{ scope_type:'team', scope_value:'Platform Infra', ack_required:true }],
  },
  {
    code:'POL-SEC-005', name:'Network Egress Filtering', category:'security', jurisdiction:'ALL',
    severity:'high', status:'active', owner:'Platform Infra',
    description:'Outbound traffic from app tier limited to documented LLM-provider FQDNs and AWS endpoints.',
    rules:['Egress allowlist enforced via VPC endpoints + NAT instance ACL.','New provider requires architecture-review approval.'],
    framework_refs:['ISO-27001:A.8.20','NIS2:NIS2-CRYPTO'],
    body_md:'# Network Egress\n\nDeny-by-default outbound; provider allowlist reviewed monthly.',
    assignments:[{ scope_type:'team', scope_value:'Platform Infra', ack_required:true }],
  },
  {
    code:'POL-SEC-006', name:'Incident Response and Disclosure', category:'security', jurisdiction:'ALL',
    severity:'critical', status:'active', owner:'Incident Response',
    description:'SEV-1 acknowledged ≤ 5 min; customer notification within 72 hours of confirmed breach.',
    rules:['Page on-call within 5 min of SEV-1 detection.','Customer notification within 72 hours.','Regulator notification per jurisdiction matrix.','Post-mortem within 7 calendar days.'],
    framework_refs:['GDPR:Art-33','DPDP-2023:§8','HIPAA:164.404','NIS2:NIS2-INC-EARLY'],
    body_md:'# Incident Response\n\nDriven by 13 documented runbooks; quarterly drill cadence.',
    assignments:[{ scope_type:'team', scope_value:'Incident Response', ack_required:true }],
  },

  {
    code:'POL-PRI-001', name:'PII Redaction Before LLM Call', category:'privacy', jurisdiction:'ALL',
    severity:'critical', status:'active', owner:'AI Safety',
    description:'Detected PII MUST be redacted/tokenised before any external LLM provider call.',
    rules:['redactPII() runs in nv-sdk-orchestration-wrapper.','Detection log persisted in nv_pii_detections.','Vault tokens are reversible only via vault service with break-glass audit.'],
    framework_refs:['DPDP-2023:§4','GDPR:Art-25','HIPAA:164.502','CCPA-CPRA:1798.100'],
    body_md:'# PII Redaction\n\nNo raw PII ever leaves the safety ring.',
    assignments:[{ scope_type:'team', scope_value:'AI Safety', ack_required:true }],
  },
  {
    code:'POL-PRI-002', name:'DSAR / Data-Subject Rights Handling', category:'privacy', jurisdiction:'ALL',
    severity:'high', status:'active', owner:'Compliance',
    description:'30-day SLA on access/correct/delete requests; audit-trailed.',
    rules:['Self-service portal at /console/account.','Workflow: triage → verify → execute → confirm.','Audit-trailed in nv_audit_logs.'],
    framework_refs:['GDPR:Art-15','DPDP-2023:§11','CCPA-CPRA:1798.100','UAE-PDPL:UAE-Art13'],
    body_md:'# DSAR Handling\n\nOne canonical workflow across all privacy jurisdictions.',
    assignments:[{ scope_type:'role', scope_value:'org_admin', ack_required:false },{ scope_type:'team', scope_value:'Compliance', ack_required:true }],
  },
  {
    code:'POL-PRI-003', name:'Cross-Border Data Transfer', category:'privacy', jurisdiction:'ALL',
    severity:'high', status:'active', owner:'Legal',
    description:'Personal data transfers across borders use SCCs / DPF / adequacy decisions; documented.',
    rules:['EU-US: Module 2 SCCs + DPF participation.','UK-US: UK Addendum.','UAE/KSA: explicit consent or controller authorisation.'],
    framework_refs:['GDPR:Art-44','UK-GDPR:UK-Art-44','UAE-PDPL:UAE-Art21'],
    body_md:'# Cross-Border Transfers\n\nLegal-team-maintained transfer matrix.',
    assignments:[{ scope_type:'team', scope_value:'Legal', ack_required:true }],
  },
  {
    code:'POL-PRI-004', name:'Consent Management', category:'privacy', jurisdiction:'ALL',
    severity:'high', status:'active', owner:'Compliance',
    description:'Granular, purpose-bound consent recorded in nv_consent_records with revocation support.',
    rules:['Per-purpose consent capture.','Revocation honoured within 24 hours.','Children: parental consent (DPDP §9, GDPR Art-8).'],
    framework_refs:['DPDP-2023:§6','GDPR:Art-7','PDPA-SG:PDPA-1'],
    body_md:'# Consent\n\nSingle consent service used across all jurisdictions and platforms.',
    assignments:[{ scope_type:'team', scope_value:'Compliance', ack_required:true }],
  },

  {
    code:'POL-DAT-001', name:'Data Classification', category:'data', jurisdiction:'ALL',
    severity:'high', status:'active', owner:'Compliance',
    description:'4-tier data classification (public, internal, confidential, restricted); applied at dataset registration.',
    rules:['New dataset requires classification before production use.','Restricted requires CISO sign-off.'],
    framework_refs:['ISO-27001:A.5.12','SOC2-TSC:C1.1'],
    body_md:'# Data Classification\n\nMandatory classification at the moment of dataset creation.',
    assignments:[{ scope_type:'team', scope_value:'Compliance', ack_required:true }],
  },
  {
    code:'POL-DAT-002', name:'Retention and Disposal', category:'data', jurisdiction:'ALL',
    severity:'high', status:'active', owner:'Compliance',
    description:'Per-dataset retention with daily purge job; legal-hold flag overrides.',
    rules:['Retention windows codified in nv_data_governance_records.','Purge job runs daily.','Legal-hold suspends purge for matter scope.'],
    framework_refs:['GDPR:Art-5','DPDP-2023:§8','HIPAA:164.530'],
    body_md:'# Retention\n\nDaily reconciler enforces retention; legal hold via case-management API.',
    assignments:[{ scope_type:'team', scope_value:'Compliance', ack_required:true }],
  },
  {
    code:'POL-DAT-003', name:'Backup, Restore, and DR', category:'data', jurisdiction:'ALL',
    severity:'high', status:'active', owner:'Platform Infra',
    description:'Daily encrypted RDS snapshots, weekly restore drill, quarterly DR exercise; RPO ≤ 15m, RTO ≤ 4h.',
    rules:['Snapshot retention: 35 days.','Cross-region copy enabled.','DR test outcomes archived in nv_compliance_evidence.'],
    framework_refs:['SOC2-TSC:A1.2','ISO-27001:A.8.13','HIPAA:164.308(a)(7)'],
    body_md:'# Backup & DR\n\nQuarterly DR drill is non-negotiable.',
    assignments:[{ scope_type:'team', scope_value:'Platform Infra', ack_required:true }],
  },
  {
    code:'POL-DAT-004', name:'Database Hash-Chain Audit', category:'data', jurisdiction:'ALL',
    severity:'critical', status:'active', owner:'Platform Security',
    description:'IronLedger hash-chain integrity verified hourly; mismatch pages on-call.',
    rules:['Hourly walker job over nv_audit_logs.','Genesis block immutable.','Verifier exposed at /api/jrx/audit/verify.'],
    framework_refs:['SOC2-TSC:PI1.2','HIPAA:164.312(c)','ISO-27001:A.8.5'],
    body_md:'# Hash-Chain Audit\n\nFirst defence against tamper.',
    assignments:[{ scope_type:'team', scope_value:'Platform Security', ack_required:true }],
  },

  {
    code:'POL-PPL-001', name:'Engineering Guardrails (NV-* Series)', category:'people', jurisdiction:'ALL',
    severity:'high', status:'active', owner:'Engineering',
    description:'14 NV-* guardrails published in AGENT-GOTCHAS.md; CI-enforced where possible.',
    rules:['NV-ARCH-001 No-bypass safety ring.','NV-LLM-001 Single-router rule (CI).','NV-NAMING-001 Pre-flight grep.','NV-WIRING-001 Built ≠ live.','NV-DOC-001 Active md whitelist.','NV-SECRETS-001 One canonical name per secret.','NV-CONTRACT-001 Pre-flight grep before naming.','NV-OWNERSHIP-001 Reproduce → trace → fix.','NV-AUTH-HEADER-001 X-API-Key canonical (CI).','NV-DB-SCRIPT-001 makePgSql() (CI).','NV-API-CONTRACT-001 OpenAPI snapshot frozen (CI).','NV-WIRING-BUDGET-001 Effective orphan budget = 0.','NV-AGENT-REGISTRY-FRESH-001 Auto-generated (CI).','NV-CLIENT-BUILD-001 Console served from dist/public/.'],
    framework_refs:['SOC2-TSC:CC8.1','ISO-42001:Cl-7.5'],
    body_md:'# Engineering Guardrails\n\nThese are the inviolable rules of the codebase.',
    assignments:[{ scope_type:'team', scope_value:'Engineering', ack_required:true }],
  },
  {
    code:'POL-PPL-002', name:'Acceptable Use Policy', category:'people', jurisdiction:'ALL',
    severity:'medium', status:'active', owner:'People Ops',
    description:'Acceptable use of platform, customer data, AI tools, and corporate accounts.',
    rules:['No customer-data downloads to personal devices.','AI-generated content for client work disclosed per ABA Op 512.','Social media: no client-confidential information.'],
    framework_refs:['ISO-27001:A.5.10'],
    body_md:'# AUP\n\nSigned at hire and on annual refresh.',
    assignments:[{ scope_type:'role', scope_value:'all-employees', ack_required:true }],
  },
  {
    code:'POL-PPL-003', name:'Background Verification', category:'people', jurisdiction:'ALL',
    severity:'medium', status:'active', owner:'People Ops',
    description:'Pre-hire background verification mandatory; refreshed every 3 years for prod-access roles.',
    rules:['BGV before access provisioning.','3-year refresh for prod-access.','Country-appropriate checks (criminal, employment, education).'],
    framework_refs:['SOC2-TSC:CC1.4','ISO-27001:A.6.1'],
    body_md:'# BGV\n\nProvider: third-party verification vendor.',
    assignments:[{ scope_type:'team', scope_value:'People Ops', ack_required:true }],
  },
  {
    code:'POL-PPL-004', name:'Annual Security and AI-Ethics Training', category:'people', jurisdiction:'ALL',
    severity:'high', status:'active', owner:'People Ops',
    description:'Annual mandatory training for all employees: OWASP Top 10, phishing, AI ethics (ABA Op 512).',
    rules:['Completion gate for prod-access.','Quarterly phishing simulations.','Tracked per-employee, attested annually.'],
    framework_refs:['HIPAA:164.308(a)(5)','ISO-27001:A.6.3','ABA-512:512-CMP'],
    body_md:'# Training\n\nCompletion is a prerequisite for prod access.',
    assignments:[{ scope_type:'role', scope_value:'all-employees', ack_required:true }],
  },

  {
    code:'POL-LEG-001', name:'Lawyer Supervision of AI Output (ABA Op 512 Compliance)', category:'legal-ethics', jurisdiction:'US',
    severity:'critical', status:'active', owner:'AI Safety',
    description:'AI-generated work product MUST be reviewed by a competent attorney before client delivery.',
    rules:['Disclosure to client when GAI is materially relied upon.','Attorney attestation captured in nv_audit_logs.','Bills reflect attorney time, not LLM compute.'],
    framework_refs:['ABA-MR:MR-1.1','ABA-MR:MR-5.3','ABA-512:512-CMP'],
    body_md:'# Lawyer Supervision\n\nApplies to JRX (US) clients and US-state-bar holders using NSP/NSI.',
    assignments:[{ scope_type:'platform', scope_value:'JRX', ack_required:true }],
  },
  {
    code:'POL-LEG-002', name:'Unauthorized Practice of Law Guardrails', category:'legal-ethics', jurisdiction:'ALL',
    severity:'critical', status:'active', owner:'AI Safety',
    description:'Citizen-facing platforms MUST not provide jurisdiction-specific advice without disclaimer + attorney handoff.',
    rules:['NYM responses include "informational, not legal advice" footer.','Jurisdiction-binding middleware enforces UPL boundaries.','Out-of-jurisdiction queries trigger attorney-locator widget.'],
    framework_refs:['ABA-MR:MR-5.5','BCI-IT:BCI-3','SRA-STD:SRA-2.1'],
    body_md:'# UPL Guardrails\n\nApplies to NYM (citizen platform) and any consumer-facing surface.',
    assignments:[{ scope_type:'platform', scope_value:'NYM', ack_required:true }],
  },

  {
    code:'POL-OPS-001', name:'Change Management', category:'operations', jurisdiction:'ALL',
    severity:'high', status:'active', owner:'Engineering',
    description:'All production changes via PR with two approvers; post-deploy verification mandatory.',
    rules:['Two-approver PR rule.','Post-deploy /api/jrx/health gate.','Rollback procedure documented per service.'],
    framework_refs:['SOC2-TSC:CC8.1','ISO-27001:A.8.32'],
    body_md:'# Change Management\n\nNo solo deploys to production.',
    assignments:[{ scope_type:'team', scope_value:'Engineering', ack_required:true }],
  },
  {
    code:'POL-OPS-002', name:'Vulnerability Management', category:'operations', jurisdiction:'ALL',
    severity:'high', status:'active', owner:'AppSec',
    description:'pnpm audit + CodeQL gate in CI; CVE patch SLAs codified.',
    rules:['Critical patch within 7 days.','High patch within 30 days.','SBOM published per release.'],
    framework_refs:['ISO-27001:A.8.8','SOC2-TSC:CC7.1','NIS2:NIS2-VULN'],
    body_md:'# Vulnerability Management\n\nFail-CI gates ensure no high/critical CVEs reach prod.',
    assignments:[{ scope_type:'team', scope_value:'AppSec', ack_required:true }],
  },
  {
    code:'POL-OPS-003', name:'On-Call and SLA', category:'operations', jurisdiction:'ALL',
    severity:'high', status:'active', owner:'Incident Response',
    description:'24×7 PagerDuty rotation across 3 timezones; SEV-1 ≤ 5 min response.',
    rules:['SEV-1: 5-min response.','SEV-2: 30-min response.','SEV-3: 4-hour response.','Annual on-call training.'],
    framework_refs:['SOC2-TSC:CC7.3'],
    body_md:'# On-Call\n\nFollow-the-sun rotation with handover at 8am local.',
    assignments:[{ scope_type:'team', scope_value:'Incident Response', ack_required:true }],
  },
  {
    code:'POL-OPS-004', name:'Vendor and Sub-Processor Management', category:'operations', jurisdiction:'ALL',
    severity:'high', status:'active', owner:'Compliance',
    description:'All sub-processors registered with DPA + SOC2 review; annual reassessment.',
    rules:['DPA signed before access.','Annual SOC2 / equivalent review.','Sub-processor list public on trust portal.'],
    framework_refs:['GDPR:Art-28','ISO-27701:Anx-B.8.5','SOC2-TSC:CC9.2'],
    body_md:'# Vendor Management\n\nSub-processor onboarding requires Compliance sign-off.',
    assignments:[{ scope_type:'team', scope_value:'Compliance', ack_required:true }],
  },
];

async function seed() {
  console.log('  ── Seeding canonical policies ──');
  await assertColumns(sql, './jrx-seed-policies', REQUIRED_COLUMNS);

  for (const p of POLICIES) {
    // upsert policy
    const rows = await sql`
      INSERT INTO nv_policies
        (org_id, policy_code, name, category, jurisdiction, severity, status, owner_team,
         description, rules, current_version, effective_at, review_at, framework_refs)
      VALUES
        (1, ${p.code}, ${p.name}, ${p.category}, ${p.jurisdiction}, ${p.severity}, ${p.status},
         ${p.owner}, ${p.description}, ${JSON.stringify(p.rules)}::jsonb, '1.0.0',
         NOW() - interval '60 days', NOW() + interval '305 days',
         ${JSON.stringify(p.framework_refs)}::jsonb)
      ON CONFLICT (org_id, policy_code) DO UPDATE SET
        name           = EXCLUDED.name,
        category       = EXCLUDED.category,
        severity       = EXCLUDED.severity,
        status         = EXCLUDED.status,
        owner_team     = EXCLUDED.owner_team,
        description    = EXCLUDED.description,
        rules          = EXCLUDED.rules,
        framework_refs = EXCLUDED.framework_refs,
        updated_at     = NOW()
      RETURNING id
    `;
    const policyId = rows[0].id;

    // version 1
    await sql`
      INSERT INTO nv_policy_versions (policy_id, version, body_md, changelog, published_by, published_at)
      VALUES (${policyId}, '1.0.0', ${p.body_md}, 'Initial publication.', 'platform-security@nyayavigya', NOW() - interval '60 days')
      ON CONFLICT (policy_id, version) DO NOTHING
    `;

    // assignments
    for (const a of p.assignments) {
      await sql`
        INSERT INTO nv_policy_assignments (policy_id, scope_type, scope_value, assigned_by, assigned_at, ack_required, ack_count)
        VALUES (${policyId}, ${a.scope_type}, ${a.scope_value}, 'compliance@nyayavigya',
                NOW() - interval '50 days', ${a.ack_required}, 0)
        ON CONFLICT (policy_id, scope_type, scope_value) DO NOTHING
      `;
    }
  }

  console.log(`  ✓ ${POLICIES.length} policies seeded with versions + assignments`);
}

seed()
  .catch((err) => { console.error('Policies seed failed:', err); process.exit(1); })
  .finally(() => sql.end());
