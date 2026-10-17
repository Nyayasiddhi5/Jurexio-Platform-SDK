/**
 * nv-iso-control-catalogue.ts — Task #299
 *
 * Source-of-truth catalogue for the three frameworks surfaced on
 * /console/eu-ai-compliance (renamed "AI Governance Compliance"):
 *
 *   - ISO/IEC 42001:2023 — AI Management System (AIMS) — 38 controls
 *     (10 clauses + Annex A controls A.2..A.10)
 *   - ISO/IEC 27001:2022 Annex A — 93 controls
 *     (A.5 Organizational 37 + A.6 People 8 + A.7 Physical 14 + A.8 Technological 34)
 *   - SOC 2 Type II — 64 controls across the 5 Trust Service Criteria
 *     (Security CC1..CC9, Availability A1, Confidentiality C1, Processing
 *     Integrity PI1, Privacy P1..P8)
 *
 * Each control carries:
 *   - default verdict (PASS / PARTIAL / FAIL / N-A) for the demo posture
 *   - per-jurisdiction posture overrides (US, IN) where applicable
 *   - remediation copy for PARTIAL/FAIL
 *   - owner role
 *   - evidence sources — string keys resolved by nv-iso-evidence-mapper.ts
 *     against existing CAM rows, e2e reports, audit logs, and security scans
 *
 * NV-NAMING-001: nv- prefix, lives under src/data/ alongside the agent
 * registries. NV-WIRING-001: imported by nv-iso-compliance-routes.ts.
 */

export type IsoFramework =
  | 'iso_42001'
  | 'iso_27001'
  | 'soc2'
  | 'dpdpa'
  | 'eu_ai_act'
  | 'gdpr';
export type IsoVerdict = 'PASS' | 'PARTIAL' | 'FAIL' | 'N-A';
export type IsoJurisdiction = 'US' | 'IN' | 'GLOBAL';

export interface IsoControl {
  controlId: string;            // unique across all 3 frameworks
  framework: IsoFramework;
  category: string;
  title: string;
  text: string;                 // full control statement
  verdict: IsoVerdict;          // default (GLOBAL) verdict
  /**
   * Per-jurisdiction posture overrides. If absent, default verdict applies
   * to every jurisdiction. Only US / IN are surfaced today.
   */
  jurisdictionVerdicts?: Partial<Record<IsoJurisdiction, IsoVerdict>>;
  reason?: string;              // why PARTIAL / FAIL
  remediation?: string;         // suggested next step
  owner: string;                // owning role
  /** Logical evidence keys; resolved at request-time. */
  evidenceSources: string[];
}

const OWNER_SECURITY = 'Security & Compliance Lead';
const OWNER_AIGOV = 'AI Governance Officer';
const OWNER_PLATFORM = 'Platform Engineering';
const OWNER_DPO = 'Data Protection Officer';
const OWNER_LEGAL = 'Legal Operations';
const OWNER_HR = 'People Operations';

// Evidence source keys → resolved by nv-iso-evidence-mapper.ts.
// These names are intentionally stable so the mapper can look them up.
const EV = {
  CAM_OPEN: 'cam_actions_open',
  CAM_RESOLVED: 'cam_actions_resolved',
  E2E_REPORT_312: 'e2e_consumer_platform_2026_05_13',
  E2E_LEGALTECH_40: 'e2e_legaltech_uat_40',
  SEC_DEPENDENCY_AUDIT: 'security_dependency_audit',
  SEC_SAST: 'security_sast_scan',
  SEC_HOUNDDOG: 'security_hounddog_scan',
  AUDIT_LOG_RECENT: 'audit_log_recent',
  AUDIT_PII_REDACTION: 'audit_pii_redaction',
  AUDIT_SDK_AUTH: 'audit_sdk_auth',
  AUDIT_RBAC_DENIES: 'audit_rbac_denies',
  AUDIT_SAFETY_RING: 'audit_safety_ring',
  AUDIT_LLM_ROUTING: 'audit_llm_routing',
  AUDIT_RATE_LIMIT: 'audit_rate_limit',
  AUDIT_HITL_DECISIONS: 'audit_hitl_decisions',
  AUDIT_AGENT_RUNS: 'audit_agent_runs',
  IRONLEDGER_HASH_CHAIN: 'ironledger_hash_chain',
  CANONICAL_DOC_GUARDRAILS: 'canonical_doc_guardrails',
  CANONICAL_DOC_UAT: 'canonical_doc_uat',
  CANONICAL_DOC_SDK_API: 'canonical_doc_sdk_api',
  CANONICAL_DOC_EC2: 'canonical_doc_ec2',
  AGENT_REGISTRY_FRESH: 'agent_registry_freshness',
  CONSENT_RECORDS: 'consent_records_summary',
  ENCRYPTION_AT_REST: 'pg_encryption_at_rest',
  TLS_CERT_INVENTORY: 'tls_cert_inventory',
  BACKUP_SNAPSHOTS: 'rds_snapshot_inventory',
  // Privacy / AI-regulation evidence (added Task #311 alongside DPDPA / EU AI Act / GDPR)
  EU_AI_ACT_CLASSIFICATIONS: 'eu_ai_act_classifications',
  EU_AI_ACT_GAP_ANALYSIS: 'eu_ai_act_gap_analysis',
  EU_AI_ACT_BIAS_REPORT: 'eu_ai_act_bias_report',
  GDPR_ROPA: 'gdpr_records_of_processing',
  GDPR_DPIA: 'gdpr_data_protection_impact_assessments',
  GDPR_SCC: 'gdpr_standard_contractual_clauses',
  DPDPA_CONSENT_REGISTER: 'in_dpdpa_consent_register',
  DPDPA_GRIEVANCE: 'dpdpa_grievance_redressal',
  DSR_ENDPOINTS: 'data_subject_rights_endpoints',
  BREACH_LOG: 'breach_notification_log',
} as const;

// ─────────────────────────────────────────────────────────────────────────
// ISO/IEC 42001:2023 — AI Management System (AIMS)
//   Clauses 4..10 + Annex A Controls A.2..A.10 (38 entries)
// ─────────────────────────────────────────────────────────────────────────
const ISO_42001: IsoControl[] = [
  { controlId: 'iso42001_4.1', framework: 'iso_42001', category: 'Context', title: 'Understanding the organization and its context', text: 'Determine external and internal issues relevant to its purpose and that affect the AI management system\'s ability to achieve its intended outcomes.', verdict: 'PASS', owner: OWNER_AIGOV, evidenceSources: [EV.CANONICAL_DOC_GUARDRAILS, EV.CANONICAL_DOC_UAT] },
  { controlId: 'iso42001_4.2', framework: 'iso_42001', category: 'Context', title: 'Needs and expectations of interested parties', text: 'Identify interested parties relevant to the AIMS and their relevant requirements.', verdict: 'PASS', owner: OWNER_AIGOV, evidenceSources: [EV.CANONICAL_DOC_UAT] },
  { controlId: 'iso42001_4.3', framework: 'iso_42001', category: 'Context', title: 'Scope of the AI management system', text: 'Determine the boundaries and applicability of the AIMS.', verdict: 'PASS', owner: OWNER_AIGOV, evidenceSources: [EV.CANONICAL_DOC_GUARDRAILS] },
  { controlId: 'iso42001_4.4', framework: 'iso_42001', category: 'Context', title: 'AI management system', text: 'Establish, implement, maintain and continually improve an AIMS, including processes needed and their interactions.', verdict: 'PARTIAL', reason: 'AIMS established and operational; continual-improvement cadence (quarterly review) not yet calendared.', remediation: 'Establish quarterly AIMS management review with documented minutes.', owner: OWNER_AIGOV, evidenceSources: [EV.CANONICAL_DOC_GUARDRAILS, EV.AUDIT_AGENT_RUNS] },
  { controlId: 'iso42001_5.1', framework: 'iso_42001', category: 'Leadership', title: 'Leadership and commitment', text: 'Top management shall demonstrate leadership and commitment with respect to the AIMS.', verdict: 'PASS', owner: OWNER_AIGOV, evidenceSources: [EV.CANONICAL_DOC_GUARDRAILS] },
  { controlId: 'iso42001_5.2', framework: 'iso_42001', category: 'Leadership', title: 'AI policy', text: 'Establish an AI policy appropriate to the purpose of the organization.', verdict: 'PASS', owner: OWNER_AIGOV, evidenceSources: [EV.CANONICAL_DOC_GUARDRAILS] },
  { controlId: 'iso42001_5.3', framework: 'iso_42001', category: 'Leadership', title: 'Roles, responsibilities and authorities', text: 'Assign and communicate responsibilities and authorities for relevant AIMS roles.', verdict: 'PASS', owner: OWNER_AIGOV, evidenceSources: [EV.CANONICAL_DOC_GUARDRAILS] },
  { controlId: 'iso42001_6.1', framework: 'iso_42001', category: 'Planning', title: 'Actions to address risks and opportunities', text: 'Plan actions to address AI-related risks and opportunities and integrate them into AIMS processes.', verdict: 'PARTIAL', reason: 'Risk register exists for top 12 systems; bottom-tier agents not yet enrolled.', remediation: 'Extend risk register coverage to all 1,042 agents by GA.', owner: OWNER_AIGOV, evidenceSources: [EV.CAM_OPEN, EV.CANONICAL_DOC_GUARDRAILS] },
  { controlId: 'iso42001_6.2', framework: 'iso_42001', category: 'Planning', title: 'AI objectives and planning', text: 'Establish measurable AI objectives at relevant functions and levels.', verdict: 'PASS', owner: OWNER_AIGOV, evidenceSources: [EV.E2E_LEGALTECH_40] },
  { controlId: 'iso42001_6.3', framework: 'iso_42001', category: 'Planning', title: 'Planning of changes', text: 'Plan changes to the AIMS in a controlled manner.', verdict: 'PASS', owner: OWNER_PLATFORM, evidenceSources: [EV.CANONICAL_DOC_SDK_API] },
  { controlId: 'iso42001_7.1', framework: 'iso_42001', category: 'Support', title: 'Resources', text: 'Determine and provide resources needed for the AIMS.', verdict: 'PASS', owner: OWNER_PLATFORM, evidenceSources: [EV.CANONICAL_DOC_EC2] },
  { controlId: 'iso42001_7.2', framework: 'iso_42001', category: 'Support', title: 'Competence', text: 'Determine necessary competence and ensure persons are competent.', verdict: 'PASS', owner: OWNER_HR, evidenceSources: [EV.CANONICAL_DOC_GUARDRAILS] },
  { controlId: 'iso42001_7.3', framework: 'iso_42001', category: 'Support', title: 'Awareness', text: 'Persons doing work shall be aware of the AI policy and their contribution.', verdict: 'PASS', owner: OWNER_HR, evidenceSources: [EV.CANONICAL_DOC_GUARDRAILS] },
  { controlId: 'iso42001_7.4', framework: 'iso_42001', category: 'Support', title: 'Communication', text: 'Determine internal and external communications relevant to the AIMS.', verdict: 'PASS', owner: OWNER_AIGOV, evidenceSources: [EV.CANONICAL_DOC_UAT] },
  { controlId: 'iso42001_7.5', framework: 'iso_42001', category: 'Support', title: 'Documented information', text: 'Maintain and retain documented information required by the AIMS.', verdict: 'PASS', owner: OWNER_AIGOV, evidenceSources: [EV.CANONICAL_DOC_GUARDRAILS, EV.CANONICAL_DOC_UAT, EV.CANONICAL_DOC_SDK_API] },
  { controlId: 'iso42001_8.1', framework: 'iso_42001', category: 'Operation', title: 'Operational planning and control', text: 'Plan, implement and control AIMS processes needed.', verdict: 'PASS', owner: OWNER_PLATFORM, evidenceSources: [EV.E2E_REPORT_312] },
  { controlId: 'iso42001_8.2', framework: 'iso_42001', category: 'Operation', title: 'AI risk assessment', text: 'Perform AI risk assessments at planned intervals or when significant changes occur.', verdict: 'PARTIAL', reason: 'Risk assessment performed for new releases; quarterly cadence not codified.', remediation: 'Codify quarterly AI risk-assessment cadence in `docs/canonical/`.', owner: OWNER_AIGOV, evidenceSources: [EV.CAM_OPEN] },
  { controlId: 'iso42001_8.3', framework: 'iso_42001', category: 'Operation', title: 'AI risk treatment', text: 'Implement the AI risk treatment plan.', verdict: 'PASS', owner: OWNER_AIGOV, evidenceSources: [EV.CAM_RESOLVED] },
  { controlId: 'iso42001_8.4', framework: 'iso_42001', category: 'Operation', title: 'AI system impact assessment', text: 'Conduct AI system impact assessments for systems within scope.', verdict: 'PARTIAL', reason: 'High-risk EU agents have AISIAs; medium-risk inventory pending.', remediation: 'Complete AISIA for medium-risk systems flagged by EU AI Act gap analysis.', owner: OWNER_AIGOV, evidenceSources: [EV.CAM_OPEN] },
  { controlId: 'iso42001_9.1', framework: 'iso_42001', category: 'Performance', title: 'Monitoring, measurement, analysis, evaluation', text: 'Monitor and measure AIMS performance.', verdict: 'PASS', owner: OWNER_PLATFORM, evidenceSources: [EV.E2E_REPORT_312, EV.AUDIT_LLM_ROUTING] },
  { controlId: 'iso42001_9.2', framework: 'iso_42001', category: 'Performance', title: 'Internal audit', text: 'Conduct internal audits at planned intervals.', verdict: 'PARTIAL', reason: 'Triple-pass audit recipe documented; first formal internal audit not yet executed.', remediation: 'Schedule and execute first formal AIMS internal audit.', owner: OWNER_AIGOV, evidenceSources: [EV.CANONICAL_DOC_GUARDRAILS] },
  { controlId: 'iso42001_9.3', framework: 'iso_42001', category: 'Performance', title: 'Management review', text: 'Top management shall review the AIMS at planned intervals.', verdict: 'PARTIAL', reason: 'Reviews ad-hoc; cadence not formalised.', remediation: 'Calendar quarterly management review with templated agenda.', owner: OWNER_AIGOV, evidenceSources: [] },
  { controlId: 'iso42001_10.1', framework: 'iso_42001', category: 'Improvement', title: 'Continual improvement', text: 'Continually improve the suitability, adequacy and effectiveness of the AIMS.', verdict: 'PASS', owner: OWNER_AIGOV, evidenceSources: [EV.CAM_RESOLVED] },
  { controlId: 'iso42001_10.2', framework: 'iso_42001', category: 'Improvement', title: 'Nonconformity and corrective action', text: 'React to nonconformities, evaluate need for action, implement, review effectiveness.', verdict: 'PASS', owner: OWNER_AIGOV, evidenceSources: [EV.CAM_OPEN, EV.CAM_RESOLVED] },
  // Annex A controls
  { controlId: 'iso42001_A.2.2', framework: 'iso_42001', category: 'Annex A — Policies', title: 'AI policy', text: 'Document organizational AI policy and align with strategic direction.', verdict: 'PASS', owner: OWNER_AIGOV, evidenceSources: [EV.CANONICAL_DOC_GUARDRAILS] },
  { controlId: 'iso42001_A.2.3', framework: 'iso_42001', category: 'Annex A — Policies', title: 'Alignment with other organizational policies', text: 'AI policy is aligned with other organizational policies.', verdict: 'PASS', owner: OWNER_AIGOV, evidenceSources: [EV.CANONICAL_DOC_GUARDRAILS] },
  { controlId: 'iso42001_A.3.2', framework: 'iso_42001', category: 'Annex A — Roles', title: 'AI roles and responsibilities', text: 'Define and assign AI roles and responsibilities.', verdict: 'PASS', owner: OWNER_AIGOV, evidenceSources: [EV.CANONICAL_DOC_GUARDRAILS] },
  { controlId: 'iso42001_A.3.3', framework: 'iso_42001', category: 'Annex A — Roles', title: 'Reporting of concerns', text: 'Mechanism to report concerns regarding AI systems.', verdict: 'PARTIAL', reason: 'Internal CAM queue exists; external concern-reporting URL not yet published.', remediation: 'Publish public ai-concerns@jurexio.example intake form.', owner: OWNER_AIGOV, evidenceSources: [EV.CAM_OPEN] },
  { controlId: 'iso42001_A.4.2', framework: 'iso_42001', category: 'Annex A — Resources', title: 'Resource documentation', text: 'Document resources required for the AI system lifecycle.', verdict: 'PASS', owner: OWNER_PLATFORM, evidenceSources: [EV.CANONICAL_DOC_EC2] },
  { controlId: 'iso42001_A.4.3', framework: 'iso_42001', category: 'Annex A — Resources', title: 'Data resources', text: 'Document data resources used by AI systems.', verdict: 'PASS', owner: OWNER_DPO, evidenceSources: [EV.CONSENT_RECORDS] },
  { controlId: 'iso42001_A.4.4', framework: 'iso_42001', category: 'Annex A — Resources', title: 'Tooling resources', text: 'Document tools and infrastructure used in the AI lifecycle.', verdict: 'PASS', owner: OWNER_PLATFORM, evidenceSources: [EV.AGENT_REGISTRY_FRESH] },
  { controlId: 'iso42001_A.5.2', framework: 'iso_42001', category: 'Annex A — Impact assessment', title: 'AI system impact assessment process', text: 'Establish a process for AI system impact assessments.', verdict: 'PASS', owner: OWNER_AIGOV, evidenceSources: [EV.CANONICAL_DOC_GUARDRAILS] },
  { controlId: 'iso42001_A.5.4', framework: 'iso_42001', category: 'Annex A — Impact assessment', title: 'Assessing AI system impact on individuals', text: 'Assess AI impact on individuals, including fairness and bias.', verdict: 'PARTIAL', reason: 'Bias-assessment service active for EU agents; per-agent fairness baseline pending for IN/US tiers.', remediation: 'Run bias baseline across IN/US agent tiers and persist to nv_bias_reports.', owner: OWNER_AIGOV, evidenceSources: [EV.CAM_OPEN] },
  { controlId: 'iso42001_A.6.2.2', framework: 'iso_42001', category: 'Annex A — Lifecycle', title: 'AI system development lifecycle', text: 'Define and apply an AI system development lifecycle.', verdict: 'PASS', owner: OWNER_PLATFORM, evidenceSources: [EV.CANONICAL_DOC_SDK_API] },
  { controlId: 'iso42001_A.6.2.4', framework: 'iso_42001', category: 'Annex A — Lifecycle', title: 'Verification and validation of AI systems', text: 'Verify and validate AI systems against their requirements.', verdict: 'PASS', owner: OWNER_PLATFORM, evidenceSources: [EV.E2E_REPORT_312, EV.E2E_LEGALTECH_40] },
  { controlId: 'iso42001_A.6.2.6', framework: 'iso_42001', category: 'Annex A — Lifecycle', title: 'AI system operation and monitoring', text: 'Operate and monitor AI systems in production.', verdict: 'PASS', owner: OWNER_PLATFORM, evidenceSources: [EV.AUDIT_AGENT_RUNS, EV.AUDIT_LLM_ROUTING] },
  { controlId: 'iso42001_A.7.4', framework: 'iso_42001', category: 'Annex A — Data', title: 'Quality of data for AI systems', text: 'Ensure data quality for AI systems.', verdict: 'PASS', owner: OWNER_DPO, evidenceSources: [EV.AUDIT_PII_REDACTION] },
  { controlId: 'iso42001_A.7.5', framework: 'iso_42001', category: 'Annex A — Data', title: 'Data provenance', text: 'Establish data provenance for AI training and operation.', verdict: 'PARTIAL', reason: 'Provenance tracked for SLM training corpora; orchestrator runtime data lineage partial.', remediation: 'Wire IronLedger data-lineage tags into orchestrator middleware.', owner: OWNER_DPO, evidenceSources: [EV.IRONLEDGER_HASH_CHAIN] },
  { controlId: 'iso42001_A.8.2', framework: 'iso_42001', category: 'Annex A — Information for interested parties', title: 'System documentation and information', text: 'Provide users with information about AI system characteristics and limitations.', verdict: 'PASS', owner: OWNER_AIGOV, evidenceSources: [EV.CANONICAL_DOC_SDK_API] },
  { controlId: 'iso42001_A.9.2', framework: 'iso_42001', category: 'Annex A — Use', title: 'Intended use of the AI system', text: 'Document and communicate intended use of AI systems.', verdict: 'PASS', owner: OWNER_AIGOV, evidenceSources: [EV.CANONICAL_DOC_SDK_API] },
  { controlId: 'iso42001_A.10.3', framework: 'iso_42001', category: 'Annex A — Third parties', title: 'Suppliers', text: 'Manage AI-related supplier risk (LLM providers, data vendors).', verdict: 'PASS', owner: OWNER_LEGAL, evidenceSources: [EV.AUDIT_LLM_ROUTING, EV.CANONICAL_DOC_SDK_API] },
];

// ─────────────────────────────────────────────────────────────────────────
// ISO/IEC 27001:2022 Annex A — 93 controls
// A.5 Organizational (37) + A.6 People (8) + A.7 Physical (14) + A.8 Technological (34)
// ─────────────────────────────────────────────────────────────────────────
function iso27(id: string, cat: string, title: string, text: string,
  verdict: IsoVerdict = 'PASS', owner: string = OWNER_SECURITY,
  evidenceSources: string[] = [], reason?: string, remediation?: string,
  jur?: Partial<Record<IsoJurisdiction, IsoVerdict>>,
): IsoControl {
  return { controlId: `iso27001_${id}`, framework: 'iso_27001', category: cat, title, text, verdict, owner, evidenceSources, reason, remediation, jurisdictionVerdicts: jur };
}

const ISO_27001: IsoControl[] = [
  // A.5 — Organizational controls (37)
  iso27('A.5.1',  'A.5 Organizational', 'Policies for information security', 'Information security policy and topic-specific policies shall be defined.', 'PASS', OWNER_SECURITY, [EV.CANONICAL_DOC_GUARDRAILS]),
  iso27('A.5.2',  'A.5 Organizational', 'Information security roles and responsibilities', 'Information security roles and responsibilities shall be defined and allocated.', 'PASS', OWNER_SECURITY, [EV.CANONICAL_DOC_GUARDRAILS]),
  iso27('A.5.3',  'A.5 Organizational', 'Segregation of duties', 'Conflicting duties and conflicting areas of responsibility shall be segregated.', 'PASS', OWNER_SECURITY, [EV.AUDIT_RBAC_DENIES]),
  iso27('A.5.4',  'A.5 Organizational', 'Management responsibilities', 'Management shall require all personnel to apply information security in line with policies.', 'PASS', OWNER_SECURITY, [EV.CANONICAL_DOC_GUARDRAILS]),
  iso27('A.5.5',  'A.5 Organizational', 'Contact with authorities', 'Maintain appropriate contacts with relevant authorities.', 'PARTIAL', OWNER_LEGAL, [], 'Authority contact roster maintained for IN; US/state-level CSIRT contacts not yet documented.', 'Add US CISA / state CSIRT contacts to incident-response runbook.'),
  iso27('A.5.6',  'A.5 Organizational', 'Contact with special interest groups', 'Maintain contacts with special interest groups, security forums and professional associations.', 'PASS', OWNER_SECURITY, []),
  iso27('A.5.7',  'A.5 Organizational', 'Threat intelligence', 'Information relating to information security threats shall be collected and analysed.', 'PARTIAL', OWNER_SECURITY, [EV.SEC_HOUNDDOG], 'HoundDog scans run pre-release; continuous threat-intel feed not subscribed.', 'Subscribe to a paid OSINT/CTI feed and wire into the security pipeline.'),
  iso27('A.5.8',  'A.5 Organizational', 'Information security in project management', 'Information security shall be integrated into project management.', 'PASS', OWNER_PLATFORM, [EV.CANONICAL_DOC_GUARDRAILS]),
  iso27('A.5.9',  'A.5 Organizational', 'Inventory of information and other associated assets', 'An inventory of information and other associated assets shall be developed.', 'PASS', OWNER_PLATFORM, [EV.AGENT_REGISTRY_FRESH]),
  iso27('A.5.10', 'A.5 Organizational', 'Acceptable use of information and other associated assets', 'Rules for the acceptable use of assets shall be identified, documented and implemented.', 'PASS', OWNER_SECURITY, [EV.CANONICAL_DOC_GUARDRAILS]),
  iso27('A.5.11', 'A.5 Organizational', 'Return of assets', 'Personnel and external party users shall return all of the organization\'s assets in their possession upon change or termination of employment.', 'PASS', OWNER_HR, []),
  iso27('A.5.12', 'A.5 Organizational', 'Classification of information', 'Information shall be classified according to information security needs.', 'PASS', OWNER_DPO, [EV.AUDIT_PII_REDACTION]),
  iso27('A.5.13', 'A.5 Organizational', 'Labelling of information', 'An appropriate set of procedures for information labelling shall be developed.', 'PARTIAL', OWNER_DPO, [], 'Labels applied at storage layer; document-level visual labelling not enforced.', 'Add classification badges to PDF/DOCX outputs from doc-pipeline.'),
  iso27('A.5.14', 'A.5 Organizational', 'Information transfer', 'Information transfer rules, procedures or agreements shall be in place.', 'PASS', OWNER_SECURITY, [EV.TLS_CERT_INVENTORY]),
  iso27('A.5.15', 'A.5 Organizational', 'Access control', 'Rules to control physical and logical access to information and other associated assets.', 'PASS', OWNER_SECURITY, [EV.AUDIT_RBAC_DENIES, EV.AUDIT_SDK_AUTH]),
  iso27('A.5.16', 'A.5 Organizational', 'Identity management', 'The full life cycle of identities shall be managed.', 'PASS', OWNER_SECURITY, [EV.AUDIT_SDK_AUTH]),
  iso27('A.5.17', 'A.5 Organizational', 'Authentication information', 'Allocation and management of authentication information shall be controlled.', 'PASS', OWNER_SECURITY, [EV.AUDIT_SDK_AUTH]),
  iso27('A.5.18', 'A.5 Organizational', 'Access rights', 'Access rights shall be provisioned, reviewed, modified and removed in line with policy.', 'PASS', OWNER_SECURITY, [EV.AUDIT_RBAC_DENIES]),
  iso27('A.5.19', 'A.5 Organizational', 'Information security in supplier relationships', 'Processes shall be defined to manage information security risks associated with suppliers.', 'PASS', OWNER_LEGAL, [EV.CANONICAL_DOC_SDK_API]),
  iso27('A.5.20', 'A.5 Organizational', 'Addressing information security within supplier agreements', 'Relevant information security requirements shall be established and agreed with each supplier.', 'PASS', OWNER_LEGAL, []),
  iso27('A.5.21', 'A.5 Organizational', 'Managing information security in the ICT supply chain', 'Processes shall be defined to manage information security risks in the ICT product and service supply chain.', 'PARTIAL', OWNER_SECURITY, [EV.SEC_DEPENDENCY_AUDIT], 'SBOM generated; SLSA attestations not yet captured for SDK builds.', 'Add SLSA provenance to SDK release pipeline.'),
  iso27('A.5.22', 'A.5 Organizational', 'Monitoring, review and change management of supplier services', 'Changes to supplier services shall be managed.', 'PASS', OWNER_PLATFORM, []),
  iso27('A.5.23', 'A.5 Organizational', 'Information security for use of cloud services', 'Processes for acquisition, use, management and exit from cloud services shall be established.', 'PASS', OWNER_PLATFORM, [EV.CANONICAL_DOC_EC2]),
  iso27('A.5.24', 'A.5 Organizational', 'Information security incident management planning', 'Plan and prepare for managing information security incidents.', 'PASS', OWNER_SECURITY, [EV.CANONICAL_DOC_GUARDRAILS]),
  iso27('A.5.25', 'A.5 Organizational', 'Assessment and decision on information security events', 'Assess information security events and decide if they are to be categorized as incidents.', 'PASS', OWNER_SECURITY, [EV.CAM_OPEN]),
  iso27('A.5.26', 'A.5 Organizational', 'Response to information security incidents', 'Respond to information security incidents in accordance with documented procedures.', 'PASS', OWNER_SECURITY, [EV.CAM_RESOLVED]),
  iso27('A.5.27', 'A.5 Organizational', 'Learning from information security incidents', 'Knowledge from incidents shall be used to strengthen and improve controls.', 'PASS', OWNER_SECURITY, [EV.CAM_RESOLVED]),
  iso27('A.5.28', 'A.5 Organizational', 'Collection of evidence', 'Procedures for the identification, collection, acquisition and preservation of evidence.', 'PASS', OWNER_SECURITY, [EV.IRONLEDGER_HASH_CHAIN, EV.AUDIT_LOG_RECENT]),
  iso27('A.5.29', 'A.5 Organizational', 'Information security during disruption', 'Plan how to maintain information security at appropriate levels during disruption.', 'PARTIAL', OWNER_PLATFORM, [EV.BACKUP_SNAPSHOTS], 'Daily RDS snapshots verified; multi-region failover drill not yet executed.', 'Run quarterly multi-region failover drill and document RTO/RPO.'),
  iso27('A.5.30', 'A.5 Organizational', 'ICT readiness for business continuity', 'ICT readiness shall be planned, implemented, maintained and tested.', 'PARTIAL', OWNER_PLATFORM, [EV.BACKUP_SNAPSHOTS], 'Backups + EC2 redeploy script in place; full DR test outstanding.', 'Schedule DR-test calendar entry every 90 days.'),
  iso27('A.5.31', 'A.5 Organizational', 'Legal, statutory, regulatory and contractual requirements', 'Identify and document legal, statutory, regulatory and contractual requirements.', 'PASS', OWNER_LEGAL, [EV.CANONICAL_DOC_UAT]),
  iso27('A.5.32', 'A.5 Organizational', 'Intellectual property rights', 'Implement procedures to ensure compliance with IP requirements.', 'PASS', OWNER_LEGAL, []),
  iso27('A.5.33', 'A.5 Organizational', 'Protection of records', 'Records shall be protected from loss, destruction, falsification, unauthorized access and unauthorized release.', 'PASS', OWNER_SECURITY, [EV.IRONLEDGER_HASH_CHAIN]),
  iso27('A.5.34', 'A.5 Organizational', 'Privacy and protection of PII', 'Identify and meet requirements for the preservation of privacy and protection of PII.', 'PASS', OWNER_DPO, [EV.AUDIT_PII_REDACTION, EV.CONSENT_RECORDS], undefined, undefined, { IN: 'PASS', US: 'PARTIAL' }),
  iso27('A.5.35', 'A.5 Organizational', 'Independent review of information security', 'Independently review the organization\'s approach to managing information security.', 'PARTIAL', OWNER_SECURITY, [], 'Internal triple-pass audit run; external auditor not yet engaged.', 'Engage external SOC2 Type II auditor for annual review.'),
  iso27('A.5.36', 'A.5 Organizational', 'Compliance with policies, rules and standards for information security', 'Compliance with the organization\'s information security policy shall be regularly reviewed.', 'PASS', OWNER_SECURITY, [EV.CAM_OPEN, EV.CAM_RESOLVED]),
  iso27('A.5.37', 'A.5 Organizational', 'Documented operating procedures', 'Operating procedures for information processing facilities shall be documented and made available.', 'PASS', OWNER_PLATFORM, [EV.CANONICAL_DOC_EC2]),

  // A.6 — People controls (8)
  iso27('A.6.1', 'A.6 People', 'Screening', 'Background verification checks on candidates shall be carried out prior to joining.', 'PASS', OWNER_HR, []),
  iso27('A.6.2', 'A.6 People', 'Terms and conditions of employment', 'Employment contracts shall state the personnel\'s and the organization\'s responsibilities for information security.', 'PASS', OWNER_HR, []),
  iso27('A.6.3', 'A.6 People', 'Information security awareness, education and training', 'Personnel shall receive appropriate information security awareness training.', 'PARTIAL', OWNER_HR, [], 'Annual refresher run; new-hire mandatory module not yet integrated with HRIS.', 'Wire info-sec onboarding to HRIS automation.'),
  iso27('A.6.4', 'A.6 People', 'Disciplinary process', 'A disciplinary process shall be formalised and communicated to take action against personnel who have committed an information security policy violation.', 'PASS', OWNER_HR, []),
  iso27('A.6.5', 'A.6 People', 'Responsibilities after termination or change of employment', 'Information security responsibilities and duties that remain valid after termination shall be defined and enforced.', 'PASS', OWNER_HR, []),
  iso27('A.6.6', 'A.6 People', 'Confidentiality or non-disclosure agreements', 'Confidentiality or non-disclosure agreements shall be identified, documented, regularly reviewed and signed.', 'PASS', OWNER_LEGAL, []),
  iso27('A.6.7', 'A.6 People', 'Remote working', 'Security measures shall be implemented when personnel are working remotely.', 'PASS', OWNER_SECURITY, []),
  iso27('A.6.8', 'A.6 People', 'Information security event reporting', 'Provide a mechanism for personnel to report observed information security events.', 'PASS', OWNER_SECURITY, [EV.CAM_OPEN]),

  // A.7 — Physical controls (14)
  iso27('A.7.1',  'A.7 Physical', 'Physical security perimeters', 'Security perimeters shall be defined and used to protect areas containing information.', 'PASS', OWNER_PLATFORM, [EV.CANONICAL_DOC_EC2]),
  iso27('A.7.2',  'A.7 Physical', 'Physical entry', 'Secure areas shall be protected by appropriate entry controls and access points.', 'N-A', OWNER_PLATFORM, [], 'Cloud-only deployment — physical entry handled by AWS DC providers.', undefined),
  iso27('A.7.3',  'A.7 Physical', 'Securing offices, rooms and facilities', 'Physical security for offices, rooms and facilities shall be designed and applied.', 'N-A', OWNER_PLATFORM, [], 'Remote-first — handled by office landlord.', undefined),
  iso27('A.7.4',  'A.7 Physical', 'Physical security monitoring', 'Premises shall be continuously monitored for unauthorized physical access.', 'N-A', OWNER_PLATFORM, [], 'Cloud-only deployment.', undefined),
  iso27('A.7.5',  'A.7 Physical', 'Protecting against physical and environmental threats', 'Protection against physical and environmental threats shall be designed and implemented.', 'PASS', OWNER_PLATFORM, [EV.CANONICAL_DOC_EC2]),
  iso27('A.7.6',  'A.7 Physical', 'Working in secure areas', 'Security measures for working in secure areas shall be designed and implemented.', 'N-A', OWNER_PLATFORM, []),
  iso27('A.7.7',  'A.7 Physical', 'Clear desk and clear screen', 'Clear desk rules for papers and removable storage media and clear screen rules shall be defined.', 'PASS', OWNER_SECURITY, []),
  iso27('A.7.8',  'A.7 Physical', 'Equipment siting and protection', 'Equipment shall be sited securely and protected.', 'PASS', OWNER_PLATFORM, [EV.CANONICAL_DOC_EC2]),
  iso27('A.7.9',  'A.7 Physical', 'Security of assets off-premises', 'Off-site assets shall be protected.', 'PASS', OWNER_SECURITY, []),
  iso27('A.7.10', 'A.7 Physical', 'Storage media', 'Storage media shall be managed through their life cycle.', 'PASS', OWNER_PLATFORM, [EV.ENCRYPTION_AT_REST]),
  iso27('A.7.11', 'A.7 Physical', 'Supporting utilities', 'Information processing facilities shall be protected from power failures.', 'PASS', OWNER_PLATFORM, [EV.CANONICAL_DOC_EC2]),
  iso27('A.7.12', 'A.7 Physical', 'Cabling security', 'Cables carrying power, data or supporting information services shall be protected.', 'N-A', OWNER_PLATFORM, []),
  iso27('A.7.13', 'A.7 Physical', 'Equipment maintenance', 'Equipment shall be correctly maintained.', 'PASS', OWNER_PLATFORM, [EV.CANONICAL_DOC_EC2]),
  iso27('A.7.14', 'A.7 Physical', 'Secure disposal or re-use of equipment', 'Items of equipment containing storage media shall be verified to ensure data has been removed prior to disposal or re-use.', 'PASS', OWNER_PLATFORM, []),

  // A.8 — Technological controls (34)
  iso27('A.8.1',  'A.8 Technological', 'User end point devices', 'Information stored on, processed by or accessible via user end point devices shall be protected.', 'PASS', OWNER_SECURITY, []),
  iso27('A.8.2',  'A.8 Technological', 'Privileged access rights', 'Allocation and use of privileged access rights shall be restricted and managed.', 'PASS', OWNER_SECURITY, [EV.AUDIT_RBAC_DENIES]),
  iso27('A.8.3',  'A.8 Technological', 'Information access restriction', 'Access to information and other associated assets shall be restricted.', 'PASS', OWNER_SECURITY, [EV.AUDIT_RBAC_DENIES]),
  iso27('A.8.4',  'A.8 Technological', 'Access to source code', 'Read and write access to source code, development tools and software libraries shall be appropriately managed.', 'PASS', OWNER_PLATFORM, []),
  iso27('A.8.5',  'A.8 Technological', 'Secure authentication', 'Secure authentication technologies and procedures shall be implemented.', 'PASS', OWNER_SECURITY, [EV.AUDIT_SDK_AUTH]),
  iso27('A.8.6',  'A.8 Technological', 'Capacity management', 'Use of resources shall be monitored and adjusted in line with current and expected capacity requirements.', 'PASS', OWNER_PLATFORM, [EV.AUDIT_RATE_LIMIT]),
  iso27('A.8.7',  'A.8 Technological', 'Protection against malware', 'Protection against malware shall be implemented and supported by appropriate user awareness.', 'PASS', OWNER_SECURITY, [EV.SEC_DEPENDENCY_AUDIT]),
  iso27('A.8.8',  'A.8 Technological', 'Management of technical vulnerabilities', 'Information about technical vulnerabilities shall be obtained and exposure evaluated.', 'PASS', OWNER_SECURITY, [EV.SEC_DEPENDENCY_AUDIT, EV.SEC_SAST]),
  iso27('A.8.9',  'A.8 Technological', 'Configuration management', 'Configurations of hardware, software, services and networks shall be established, documented, implemented, monitored and reviewed.', 'PASS', OWNER_PLATFORM, [EV.CANONICAL_DOC_EC2]),
  iso27('A.8.10', 'A.8 Technological', 'Information deletion', 'Information stored shall be deleted when no longer required.', 'PARTIAL', OWNER_DPO, [EV.CONSENT_RECORDS], 'Consent-driven deletion live; legacy plaintext columns scheduled for drop after backfill verification.', 'Drop legacy plaintext columns once encrypted backfill verified.'),
  iso27('A.8.11', 'A.8 Technological', 'Data masking', 'Data masking shall be used in accordance with the access control policy.', 'PASS', OWNER_DPO, [EV.AUDIT_PII_REDACTION]),
  iso27('A.8.12', 'A.8 Technological', 'Data leakage prevention', 'Data leakage prevention measures shall be applied to systems, networks and devices.', 'PASS', OWNER_SECURITY, [EV.AUDIT_PII_REDACTION, EV.SEC_HOUNDDOG]),
  iso27('A.8.13', 'A.8 Technological', 'Information backup', 'Backup copies of information, software and systems shall be maintained and regularly tested.', 'PASS', OWNER_PLATFORM, [EV.BACKUP_SNAPSHOTS]),
  iso27('A.8.14', 'A.8 Technological', 'Redundancy of information processing facilities', 'Information processing facilities shall be implemented with redundancy sufficient to meet availability requirements.', 'PARTIAL', OWNER_PLATFORM, [], 'Single AZ on EC2 prod-dev; multi-AZ scheduled.', 'Promote prod-dev to multi-AZ before GA.'),
  iso27('A.8.15', 'A.8 Technological', 'Logging', 'Logs that record activities, exceptions, faults and other relevant events shall be produced, stored, protected and analysed.', 'PASS', OWNER_PLATFORM, [EV.AUDIT_LOG_RECENT]),
  iso27('A.8.16', 'A.8 Technological', 'Monitoring activities', 'Networks, systems and applications shall be monitored for anomalous behaviour.', 'PASS', OWNER_PLATFORM, [EV.AUDIT_AGENT_RUNS]),
  iso27('A.8.17', 'A.8 Technological', 'Clock synchronization', 'Clocks of information processing systems shall be synchronized to approved time sources.', 'PASS', OWNER_PLATFORM, []),
  iso27('A.8.18', 'A.8 Technological', 'Use of privileged utility programs', 'The use of utility programs that might be capable of overriding system and application controls shall be restricted.', 'PASS', OWNER_PLATFORM, []),
  iso27('A.8.19', 'A.8 Technological', 'Installation of software on operational systems', 'Procedures and measures shall be implemented to securely manage software installation on operational systems.', 'PASS', OWNER_PLATFORM, []),
  iso27('A.8.20', 'A.8 Technological', 'Networks security', 'Networks and network devices shall be secured, managed and controlled.', 'PASS', OWNER_PLATFORM, [EV.TLS_CERT_INVENTORY]),
  iso27('A.8.21', 'A.8 Technological', 'Security of network services', 'Security mechanisms, service levels and service requirements of network services shall be identified, implemented and monitored.', 'PASS', OWNER_PLATFORM, [EV.TLS_CERT_INVENTORY]),
  iso27('A.8.22', 'A.8 Technological', 'Segregation of networks', 'Groups of information services, users and information systems shall be segregated in the organization\'s networks.', 'PASS', OWNER_PLATFORM, []),
  iso27('A.8.23', 'A.8 Technological', 'Web filtering', 'Access to external websites shall be managed to reduce exposure to malicious content.', 'PASS', OWNER_SECURITY, []),
  iso27('A.8.24', 'A.8 Technological', 'Use of cryptography', 'Rules for the effective use of cryptography, including cryptographic key management, shall be defined and implemented.', 'PASS', OWNER_SECURITY, [EV.ENCRYPTION_AT_REST, EV.TLS_CERT_INVENTORY]),
  iso27('A.8.25', 'A.8 Technological', 'Secure development life cycle', 'Rules for the secure development of software and systems shall be established and applied.', 'PASS', OWNER_PLATFORM, [EV.SEC_SAST]),
  iso27('A.8.26', 'A.8 Technological', 'Application security requirements', 'Information security requirements shall be identified, specified and approved when developing or acquiring applications.', 'PASS', OWNER_PLATFORM, [EV.CANONICAL_DOC_GUARDRAILS]),
  iso27('A.8.27', 'A.8 Technological', 'Secure system architecture and engineering principles', 'Principles for engineering secure systems shall be established, documented, maintained and applied.', 'PASS', OWNER_PLATFORM, [EV.AUDIT_SAFETY_RING]),
  iso27('A.8.28', 'A.8 Technological', 'Secure coding', 'Secure coding principles shall be applied to software development.', 'PASS', OWNER_PLATFORM, [EV.SEC_SAST]),
  iso27('A.8.29', 'A.8 Technological', 'Security testing in development and acceptance', 'Security testing processes shall be defined and implemented in the development life cycle.', 'PASS', OWNER_PLATFORM, [EV.E2E_REPORT_312, EV.E2E_LEGALTECH_40]),
  iso27('A.8.30', 'A.8 Technological', 'Outsourced development', 'The organization shall direct, monitor and review the activities related to outsourced system development.', 'N-A', OWNER_PLATFORM, [], 'No outsourced development.', undefined),
  iso27('A.8.31', 'A.8 Technological', 'Separation of development, test and production environments', 'Development, testing and production environments shall be separated and secured.', 'PASS', OWNER_PLATFORM, [EV.CANONICAL_DOC_EC2]),
  iso27('A.8.32', 'A.8 Technological', 'Change management', 'Changes to information processing facilities and information systems shall be subject to change management procedures.', 'PASS', OWNER_PLATFORM, [EV.CANONICAL_DOC_SDK_API]),
  iso27('A.8.33', 'A.8 Technological', 'Test information', 'Test information shall be appropriately selected, protected and managed.', 'PASS', OWNER_DPO, [EV.AUDIT_PII_REDACTION]),
  iso27('A.8.34', 'A.8 Technological', 'Protection of information systems during audit testing', 'Audit tests and other assurance activities involving assessment of operational systems shall be planned and agreed.', 'PASS', OWNER_SECURITY, []),
];

// ─────────────────────────────────────────────────────────────────────────
// SOC 2 Type II — 5 TSC, 64 controls
// ─────────────────────────────────────────────────────────────────────────
function soc2(id: string, cat: string, title: string, text: string,
  verdict: IsoVerdict = 'PASS', owner: string = OWNER_SECURITY,
  evidenceSources: string[] = [], reason?: string, remediation?: string,
  jur?: Partial<Record<IsoJurisdiction, IsoVerdict>>,
): IsoControl {
  return { controlId: `soc2_${id}`, framework: 'soc2', category: cat, title, text, verdict, owner, evidenceSources, reason, remediation, jurisdictionVerdicts: jur };
}

const SOC2: IsoControl[] = [
  // CC1 — Control Environment (5)
  soc2('CC1.1', 'CC1 Control Environment', 'Integrity and ethical values', 'The entity demonstrates a commitment to integrity and ethical values.', 'PASS', OWNER_AIGOV, [EV.CANONICAL_DOC_GUARDRAILS]),
  soc2('CC1.2', 'CC1 Control Environment', 'Board of directors independence', 'The board of directors demonstrates independence and exercises oversight.', 'PASS', OWNER_AIGOV, []),
  soc2('CC1.3', 'CC1 Control Environment', 'Organizational structure and authority', 'Management establishes structures, reporting lines, and appropriate authorities.', 'PASS', OWNER_AIGOV, [EV.CANONICAL_DOC_GUARDRAILS]),
  soc2('CC1.4', 'CC1 Control Environment', 'Commitment to competence', 'The entity demonstrates a commitment to attract, develop, and retain competent individuals.', 'PASS', OWNER_HR, []),
  soc2('CC1.5', 'CC1 Control Environment', 'Accountability for internal control', 'The entity holds individuals accountable for their internal control responsibilities.', 'PASS', OWNER_AIGOV, [EV.CAM_OPEN]),

  // CC2 — Communication and Information (3)
  soc2('CC2.1', 'CC2 Communication & Information', 'Quality information for internal control', 'The entity obtains or generates and uses relevant, quality information.', 'PASS', OWNER_PLATFORM, [EV.AUDIT_LOG_RECENT]),
  soc2('CC2.2', 'CC2 Communication & Information', 'Internal communication of objectives', 'The entity internally communicates information necessary to support internal control.', 'PASS', OWNER_AIGOV, [EV.CANONICAL_DOC_GUARDRAILS]),
  soc2('CC2.3', 'CC2 Communication & Information', 'External communication', 'The entity communicates with external parties regarding matters affecting internal control.', 'PASS', OWNER_AIGOV, [EV.CANONICAL_DOC_SDK_API]),

  // CC3 — Risk Assessment (4)
  soc2('CC3.1', 'CC3 Risk Assessment', 'Specifies suitable objectives', 'The entity specifies objectives with sufficient clarity to enable risk identification and assessment.', 'PASS', OWNER_AIGOV, [EV.CANONICAL_DOC_UAT]),
  soc2('CC3.2', 'CC3 Risk Assessment', 'Identifies and analyzes risk', 'The entity identifies risks to the achievement of its objectives and analyzes them.', 'PASS', OWNER_AIGOV, [EV.CAM_OPEN]),
  soc2('CC3.3', 'CC3 Risk Assessment', 'Assesses fraud risk', 'The entity considers the potential for fraud in assessing risks.', 'PARTIAL', OWNER_AIGOV, [], 'Fraud risk implicit in security review; standalone fraud-risk register not maintained.', 'Add a fraud-risk register tracked alongside CAM.'),
  soc2('CC3.4', 'CC3 Risk Assessment', 'Identifies and assesses changes', 'The entity identifies and assesses changes that could significantly impact internal control.', 'PASS', OWNER_PLATFORM, [EV.CANONICAL_DOC_SDK_API]),

  // CC4 — Monitoring Activities (2)
  soc2('CC4.1', 'CC4 Monitoring Activities', 'Selects and develops monitoring activities', 'The entity selects, develops, and performs ongoing monitoring of internal control.', 'PASS', OWNER_PLATFORM, [EV.AUDIT_LOG_RECENT]),
  soc2('CC4.2', 'CC4 Monitoring Activities', 'Communicates internal control deficiencies', 'The entity evaluates and communicates internal control deficiencies in a timely manner.', 'PASS', OWNER_SECURITY, [EV.CAM_OPEN, EV.CAM_RESOLVED]),

  // CC5 — Control Activities (3)
  soc2('CC5.1', 'CC5 Control Activities', 'Selects and develops control activities', 'The entity selects and develops control activities that contribute to the mitigation of risks.', 'PASS', OWNER_SECURITY, []),
  soc2('CC5.2', 'CC5 Control Activities', 'Selects and develops technology controls', 'The entity selects and develops general control activities over technology.', 'PASS', OWNER_PLATFORM, [EV.AUDIT_SAFETY_RING]),
  soc2('CC5.3', 'CC5 Control Activities', 'Deploys through policies and procedures', 'The entity deploys control activities through policies that establish what is expected.', 'PASS', OWNER_SECURITY, [EV.CANONICAL_DOC_GUARDRAILS]),

  // CC6 — Logical and Physical Access (8)
  soc2('CC6.1', 'CC6 Logical & Physical Access', 'Logical access controls', 'The entity implements logical access security software, infrastructure, and architectures.', 'PASS', OWNER_SECURITY, [EV.AUDIT_RBAC_DENIES, EV.AUDIT_SDK_AUTH]),
  soc2('CC6.2', 'CC6 Logical & Physical Access', 'New user authorization', 'Prior to issuing system credentials, the entity registers and authorizes new users.', 'PASS', OWNER_SECURITY, [EV.AUDIT_SDK_AUTH]),
  soc2('CC6.3', 'CC6 Logical & Physical Access', 'Removal of access', 'The entity removes access to data, software, functions, and other IT resources when appropriate.', 'PASS', OWNER_SECURITY, []),
  soc2('CC6.4', 'CC6 Logical & Physical Access', 'Restricts physical access', 'The entity restricts physical access to facilities and protected information assets.', 'N-A', OWNER_PLATFORM, [], 'Cloud-only deployment; physical access handled by AWS.', undefined),
  soc2('CC6.5', 'CC6 Logical & Physical Access', 'Disposal of physical media', 'The entity discontinues logical and physical protections over physical assets only after the ability to read or recover data and software has been diminished.', 'N-A', OWNER_PLATFORM, []),
  soc2('CC6.6', 'CC6 Logical & Physical Access', 'External access security', 'The entity implements logical access security measures to protect against threats from outside system boundaries.', 'PASS', OWNER_SECURITY, [EV.AUDIT_RATE_LIMIT, EV.TLS_CERT_INVENTORY]),
  soc2('CC6.7', 'CC6 Logical & Physical Access', 'Transmission of information', 'The entity restricts the transmission, movement, and removal of information to authorized internal and external users.', 'PASS', OWNER_SECURITY, [EV.TLS_CERT_INVENTORY, EV.AUDIT_PII_REDACTION]),
  soc2('CC6.8', 'CC6 Logical & Physical Access', 'Prevents and detects unauthorized software', 'The entity implements controls to prevent or detect and act upon the introduction of unauthorized or malicious software.', 'PASS', OWNER_SECURITY, [EV.SEC_DEPENDENCY_AUDIT, EV.SEC_SAST]),

  // CC7 — System Operations (5)
  soc2('CC7.1', 'CC7 System Operations', 'Detects and monitors system components', 'To meet its objectives, the entity uses detection and monitoring procedures to identify changes to configurations.', 'PASS', OWNER_PLATFORM, [EV.AUDIT_LOG_RECENT, EV.AUDIT_AGENT_RUNS]),
  soc2('CC7.2', 'CC7 System Operations', 'Monitors components for anomalies', 'The entity monitors system components and the operation of those components for anomalies.', 'PASS', OWNER_PLATFORM, [EV.AUDIT_AGENT_RUNS, EV.AUDIT_LLM_ROUTING]),
  soc2('CC7.3', 'CC7 System Operations', 'Evaluates security events', 'The entity evaluates security events to determine whether they could or have resulted in a failure to meet objectives.', 'PASS', OWNER_SECURITY, [EV.CAM_OPEN]),
  soc2('CC7.4', 'CC7 System Operations', 'Responds to identified security incidents', 'The entity responds to identified security incidents by executing a defined incident response program.', 'PASS', OWNER_SECURITY, [EV.CAM_RESOLVED]),
  soc2('CC7.5', 'CC7 System Operations', 'Recovers from identified security incidents', 'The entity identifies, develops, and implements activities to recover from identified security incidents.', 'PARTIAL', OWNER_SECURITY, [EV.BACKUP_SNAPSHOTS], 'Recovery procedure exists; full DR rehearsal pending.', 'Schedule quarterly DR rehearsal.'),

  // CC8 — Change Management (1)
  soc2('CC8.1', 'CC8 Change Management', 'Authorizes, designs, develops, and approves changes', 'The entity authorizes, designs, develops, configures, documents, tests, approves, and implements changes to infrastructure, data, software, and procedures.', 'PASS', OWNER_PLATFORM, [EV.CANONICAL_DOC_SDK_API]),

  // CC9 — Risk Mitigation (2)
  soc2('CC9.1', 'CC9 Risk Mitigation', 'Identifies, selects, and develops risk mitigation activities', 'The entity identifies, selects, and develops risk mitigation activities for risks arising from potential business disruptions.', 'PASS', OWNER_AIGOV, [EV.BACKUP_SNAPSHOTS]),
  soc2('CC9.2', 'CC9 Risk Mitigation', 'Vendor and business partner risk', 'The entity assesses and manages risks associated with vendors and business partners.', 'PASS', OWNER_LEGAL, []),

  // A1 — Availability (3)
  soc2('A1.1', 'A1 Availability', 'Capacity demand and resources', 'The entity maintains, monitors, and evaluates current processing capacity and use of system components.', 'PASS', OWNER_PLATFORM, [EV.AUDIT_RATE_LIMIT]),
  soc2('A1.2', 'A1 Availability', 'Environmental protections, software, data backup', 'The entity authorizes, designs, develops, and implements environmental protections, software, data backup processes, and recovery infrastructure.', 'PASS', OWNER_PLATFORM, [EV.BACKUP_SNAPSHOTS]),
  soc2('A1.3', 'A1 Availability', 'Tests recovery plan procedures', 'The entity tests recovery plan procedures supporting system recovery.', 'PARTIAL', OWNER_PLATFORM, [], 'DR plan documented; live test pending.', 'Run live recovery test against staging RDS snapshot.'),

  // C1 — Confidentiality (2)
  soc2('C1.1', 'C1 Confidentiality', 'Protects confidential information', 'The entity identifies and maintains confidential information to meet the entity\'s objectives related to confidentiality.', 'PASS', OWNER_DPO, [EV.AUDIT_PII_REDACTION, EV.ENCRYPTION_AT_REST]),
  soc2('C1.2', 'C1 Confidentiality', 'Disposes of confidential information', 'The entity disposes of confidential information to meet the entity\'s objectives.', 'PARTIAL', OWNER_DPO, [], 'Encrypted-deletion live; legacy plaintext columns scheduled for drop.', 'Drop legacy plaintext columns once encrypted backfill verified.'),

  // PI1 — Processing Integrity (5)
  soc2('PI1.1', 'PI1 Processing Integrity', 'Defines processing integrity', 'The entity obtains or generates, uses, and communicates relevant, quality information regarding the objectives related to processing integrity.', 'PASS', OWNER_PLATFORM, [EV.AUDIT_LLM_ROUTING]),
  soc2('PI1.2', 'PI1 Processing Integrity', 'Inputs are complete and accurate', 'System inputs are processed completely, accurately, and timely as authorized.', 'PASS', OWNER_PLATFORM, [EV.E2E_REPORT_312]),
  soc2('PI1.3', 'PI1 Processing Integrity', 'Processing produces complete and accurate outputs', 'The entity ensures that system processing produces complete and accurate outputs.', 'PASS', OWNER_PLATFORM, [EV.E2E_REPORT_312, EV.E2E_LEGALTECH_40]),
  soc2('PI1.4', 'PI1 Processing Integrity', 'Outputs are delivered as specified', 'The entity ensures system outputs are delivered to meet objectives.', 'PASS', OWNER_PLATFORM, [EV.E2E_REPORT_312]),
  soc2('PI1.5', 'PI1 Processing Integrity', 'Stores inputs and outputs completely', 'The entity stores inputs and outputs completely and accurately.', 'PASS', OWNER_PLATFORM, [EV.IRONLEDGER_HASH_CHAIN]),

  // P1..P8 — Privacy (21)
  soc2('P1.1', 'P1 Privacy — Notice', 'Notice provided about privacy practices', 'The entity provides notice to data subjects about its privacy practices.', 'PASS', OWNER_DPO, [EV.CONSENT_RECORDS], undefined, undefined, { US: 'PASS', IN: 'PASS' }),
  soc2('P2.1', 'P2 Privacy — Choice & Consent', 'Choice and consent', 'The entity communicates choices available regarding the collection, use, retention, disclosure, and disposal of personal information.', 'PASS', OWNER_DPO, [EV.CONSENT_RECORDS], undefined, undefined, { US: 'PASS', IN: 'PASS' }),
  soc2('P3.1', 'P3 Privacy — Collection', 'Personal information is collected consistently with notice', 'Personal information is collected consistent with the entity\'s objectives related to privacy.', 'PASS', OWNER_DPO, [EV.AUDIT_PII_REDACTION]),
  soc2('P3.2', 'P3 Privacy — Collection', 'Explicit consent for sensitive personal information', 'For information requiring explicit consent, the entity obtains the consent.', 'PASS', OWNER_DPO, [EV.CONSENT_RECORDS]),
  soc2('P4.1', 'P4 Privacy — Use, Retention, Disposal', 'Use of personal information', 'The entity limits the use of personal information to the purposes identified in the notice.', 'PASS', OWNER_DPO, [EV.AUDIT_PII_REDACTION]),
  soc2('P4.2', 'P4 Privacy — Use, Retention, Disposal', 'Retention of personal information', 'The entity retains personal information consistent with the entity\'s objectives related to privacy.', 'PARTIAL', OWNER_DPO, [], 'Retention defined for new tables; legacy tables not yet TTL-enforced.', 'Add retention TTLs to remaining legacy tables.'),
  soc2('P4.3', 'P4 Privacy — Use, Retention, Disposal', 'Disposal of personal information', 'The entity securely disposes of personal information.', 'PARTIAL', OWNER_DPO, [], 'Soft-delete live; hard-delete pipeline scheduled.', 'Wire encrypted hard-delete after verification.'),
  soc2('P5.1', 'P5 Privacy — Access', 'Access to personal information', 'The entity grants identified and authenticated data subjects the ability to access their personal information.', 'PASS', OWNER_DPO, [EV.CONSENT_RECORDS]),
  soc2('P5.2', 'P5 Privacy — Access', 'Updating or correcting personal information', 'The entity corrects, amends, or appends personal information based on data subject requests.', 'PASS', OWNER_DPO, [EV.CONSENT_RECORDS]),
  soc2('P6.1', 'P6 Privacy — Disclosure & Notification', 'Disclosure to third parties', 'The entity discloses personal information to third parties only for the purposes for which consent has been obtained.', 'PASS', OWNER_DPO, [EV.AUDIT_LLM_ROUTING, EV.AUDIT_PII_REDACTION]),
  soc2('P6.2', 'P6 Privacy — Disclosure & Notification', 'New purposes and uses', 'The entity creates and retains a complete, accurate, and timely record of authorized disclosures.', 'PASS', OWNER_DPO, [EV.AUDIT_LOG_RECENT]),
  soc2('P6.3', 'P6 Privacy — Disclosure & Notification', 'Misuse of personal information by a third party', 'The entity creates and retains a record of breaches of personal information.', 'PASS', OWNER_DPO, [EV.CAM_OPEN, EV.CAM_RESOLVED]),
  soc2('P6.4', 'P6 Privacy — Disclosure & Notification', 'Notification of breaches', 'The entity provides notification of breaches and incidents to affected data subjects, regulators, and others.', 'PARTIAL', OWNER_DPO, [], 'Internal CAM workflow ready; jurisdictional regulator notification template missing for US states.', 'Author US state-by-state breach notification templates.', { US: 'PARTIAL', IN: 'PASS' }),
  soc2('P6.5', 'P6 Privacy — Disclosure & Notification', 'Notification of changes to privacy practices', 'The entity notifies data subjects of changes to privacy practices.', 'PASS', OWNER_DPO, []),
  soc2('P6.6', 'P6 Privacy — Disclosure & Notification', 'Notification of breaches to regulators', 'The entity notifies regulators of breaches as required by law.', 'PARTIAL', OWNER_LEGAL, [], 'IN DPDPA reporting wired; US state-AG reporting flow not yet codified.', 'Codify US state-AG reporting flow inside CAM.', { US: 'PARTIAL', IN: 'PASS' }),
  soc2('P6.7', 'P6 Privacy — Disclosure & Notification', 'Accountability for downstream third-party disclosures', 'The entity holds third parties accountable for personal information practices.', 'PASS', OWNER_LEGAL, []),
  soc2('P7.1', 'P7 Privacy — Quality', 'Accuracy and quality of personal information', 'The entity collects and maintains accurate, up-to-date, complete, and relevant personal information.', 'PASS', OWNER_DPO, [EV.AUDIT_PII_REDACTION]),
  soc2('P8.1', 'P8 Privacy — Monitoring & Enforcement', 'Privacy complaints and compliance', 'The entity implements a process for receiving, addressing, resolving, and communicating the resolution of inquiries, complaints, and disputes.', 'PASS', OWNER_DPO, [EV.CAM_OPEN, EV.CAM_RESOLVED]),
];

// ─────────────────────────────────────────────────────────────────────────
// DPDPA 2023 — Digital Personal Data Protection Act (India)
//   Selected obligations across notice/consent, data principal rights,
//   data fiduciary duties, cross-border transfers, and enforcement.
//   (Task #311)
// ─────────────────────────────────────────────────────────────────────────
function dpdpa(id: string, cat: string, title: string, text: string,
  verdict: IsoVerdict = 'PASS', owner: string = OWNER_DPO,
  evidenceSources: string[] = [], reason?: string, remediation?: string,
  jur?: Partial<Record<IsoJurisdiction, IsoVerdict>>,
): IsoControl {
  return { controlId: `dpdpa_s${id}`, framework: 'dpdpa', category: cat, title, text, verdict, owner, evidenceSources, reason, remediation, jurisdictionVerdicts: jur };
}

const DPDPA: IsoControl[] = [
  dpdpa('4',  'Grounds for processing', 'Grounds for processing personal data', 'A Data Fiduciary may process personal data only in accordance with the provisions of this Act for a lawful purpose for which the Data Principal has given consent or for certain legitimate uses.', 'PASS', OWNER_DPO, [EV.DPDPA_CONSENT_REGISTER, EV.CONSENT_RECORDS]),
  dpdpa('5',  'Notice', 'Notice to the Data Principal', 'Every request for consent shall be accompanied by a clear notice describing personal data sought, purpose, manner of exercising rights, and grievance redressal.', 'PASS', OWNER_DPO, [EV.CONSENT_RECORDS]),
  dpdpa('6',  'Consent', 'Consent — free, specific, informed, unconditional, unambiguous', 'Consent given by the Data Principal shall be free, specific, informed, unconditional, unambiguous and limited to the purpose specified in the notice.', 'PASS', OWNER_DPO, [EV.DPDPA_CONSENT_REGISTER, EV.CONSENT_RECORDS]),
  dpdpa('7',  'Legitimate uses', 'Certain legitimate uses', 'Personal data may be processed without consent for specified legitimate uses (voluntary disclosure, employment, public interest, etc.).', 'PASS', OWNER_DPO, [EV.AUDIT_PII_REDACTION]),
  dpdpa('8.1','Data Fiduciary obligations', 'Accuracy and completeness of personal data', 'A Data Fiduciary shall ensure the completeness, accuracy and consistency of personal data used to make decisions affecting the Data Principal.', 'PASS', OWNER_DPO, [EV.AUDIT_PII_REDACTION]),
  dpdpa('8.4','Data Fiduciary obligations', 'Reasonable security safeguards', 'A Data Fiduciary shall protect personal data in its possession by taking reasonable security safeguards to prevent personal data breach.', 'PASS', OWNER_SECURITY, [EV.ENCRYPTION_AT_REST, EV.TLS_CERT_INVENTORY, EV.AUDIT_PII_REDACTION]),
  dpdpa('8.6','Data Fiduciary obligations', 'Personal data breach intimation', 'In the event of a personal data breach, the Data Fiduciary shall give intimation to the Board and each affected Data Principal in such form and manner as prescribed.', 'PARTIAL', OWNER_DPO, [EV.BREACH_LOG], 'Internal breach-log workflow ready and CAM reviewer queue wired; first formal intimation template to the Data Protection Board not yet finalised.', 'Finalise DPB intimation template inside CAM and link from /api/jrx/compliance/dpdpa.'),
  dpdpa('8.7','Data Fiduciary obligations', 'Erasure on consent withdrawal / purpose completion', 'Upon withdrawal of consent or expiry of purpose, the Data Fiduciary shall erase personal data unless retention is required by law.', 'PARTIAL', OWNER_DPO, [EV.DSR_ENDPOINTS], 'Soft-delete + consent withdrawal endpoint live; hard-delete pipeline scheduled.', 'Wire encrypted hard-delete after retention TTL expiry (shared remediation with SOC2 P4.3).'),
  dpdpa('9',  'Children', 'Processing of personal data of children', 'A Data Fiduciary shall obtain verifiable consent of the parent or lawful guardian before processing any personal data of a child, and shall not undertake tracking or behavioural monitoring of children.', 'PARTIAL', OWNER_DPO, [], 'Platform target audience is professional/adult; child-data flow disabled at SDK validation layer. Verifiable parental consent UX not built since not in scope.', 'Document scope-out decision in privacy policy and add SDK-tier guard preventing under-18 onboarding.'),
  dpdpa('10', 'Significant Data Fiduciary', 'Additional obligations of Significant Data Fiduciary', 'A Significant Data Fiduciary shall appoint a DPO based in India, an independent data auditor, and undertake periodic Data Protection Impact Assessments and audits.', 'PARTIAL', OWNER_DPO, [EV.GDPR_DPIA], 'DPO appointed (dpo@jurexio.example); independent data auditor not yet engaged.', 'Engage an empanelled independent data auditor and schedule annual audit.'),
  dpdpa('11', 'Rights', 'Right to access information about personal data', 'A Data Principal shall have the right to obtain from the Data Fiduciary a summary of personal data being processed, the processing activities, and the identities of recipients.', 'PASS', OWNER_DPO, [EV.DSR_ENDPOINTS, EV.CONSENT_RECORDS]),
  dpdpa('12', 'Rights', 'Right to correction and erasure', 'A Data Principal shall have the right to correction, completion, updating and erasure of personal data processed.', 'PASS', OWNER_DPO, [EV.DSR_ENDPOINTS]),
  dpdpa('13', 'Rights', 'Right of grievance redressal', 'A Data Principal shall have the right to readily available means of grievance redressal provided by a Data Fiduciary or Consent Manager.', 'PASS', OWNER_DPO, [EV.DPDPA_GRIEVANCE]),
  dpdpa('14', 'Rights', 'Right to nominate', 'A Data Principal shall have the right to nominate any other individual to exercise rights under this Act in the event of death or incapacity.', 'PARTIAL', OWNER_DPO, [], 'Nomination flow not yet exposed in console / SDK.', 'Add nominee field to consent record schema and surface in SDK.'),
  dpdpa('16', 'Cross-border', 'Processing of personal data outside India', 'The Central Government may, by notification, restrict the transfer of personal data by a Data Fiduciary for processing to such country or territory outside India as may be notified.', 'PASS', OWNER_LEGAL, [EV.CANONICAL_DOC_EC2], undefined, undefined, { IN: 'PASS' }),
  dpdpa('17', 'Exemptions', 'Exemptions for research / archiving / statistical purposes', 'Provisions of this Act shall not apply where processing is necessary for research, archiving or statistical purposes if the personal data is not used to take any decision specific to a Data Principal.', 'PASS', OWNER_LEGAL, []),
  dpdpa('25', 'Enforcement', 'Penalty for non-compliance', 'The Board may, after inquiry, impose monetary penalties up to ₹250 crore for failure to take reasonable security safeguards to prevent personal data breach.', 'PASS', OWNER_LEGAL, [EV.CAM_RESOLVED]),
  dpdpa('33', 'Retention', 'Period of retention', 'A Data Fiduciary shall erase personal data when the purpose has been served, unless retention is required for compliance with any law.', 'PARTIAL', OWNER_DPO, [], 'Retention policy defined for new tables; legacy tables not yet TTL-enforced.', 'Add retention TTLs to remaining legacy tables (shared remediation with SOC2 P4.2).'),
];

// ─────────────────────────────────────────────────────────────────────────
// EU AI Act — Regulation (EU) 2024/1689
//   Selected provider/deployer obligations for high-risk systems plus
//   transparency, GPAI, and post-market monitoring.  (Task #311)
// ─────────────────────────────────────────────────────────────────────────
function euact(id: string, cat: string, title: string, text: string,
  verdict: IsoVerdict = 'PASS', owner: string = OWNER_AIGOV,
  evidenceSources: string[] = [], reason?: string, remediation?: string,
  jur?: Partial<Record<IsoJurisdiction, IsoVerdict>>,
): IsoControl {
  return { controlId: `euact_art${id}`, framework: 'eu_ai_act', category: cat, title, text, verdict, owner, evidenceSources, reason, remediation, jurisdictionVerdicts: jur };
}

const EU_AI_ACT: IsoControl[] = [
  euact('5',  'Prohibited practices', 'Article 5 — Prohibited AI practices', 'Placing on the market, putting into service or using AI systems that deploy subliminal techniques, exploit vulnerabilities, perform social scoring by public authorities, or carry out real-time remote biometric identification in publicly accessible spaces (with limited exceptions) is prohibited.', 'PASS', OWNER_AIGOV, [EV.AUDIT_SAFETY_RING, EV.EU_AI_ACT_CLASSIFICATIONS]),
  euact('6',  'Classification', 'Article 6 — Classification of high-risk AI systems', 'AI systems referred to in Annex III shall be considered high-risk; the platform classifies legal-research and document-analysis use as Annex III §8(a) administration of justice.', 'PASS', OWNER_AIGOV, [EV.EU_AI_ACT_CLASSIFICATIONS]),
  euact('9',  'Provider obligations', 'Article 9 — Risk management system', 'A risk management system shall be established, implemented, documented and maintained throughout the entire lifecycle of the high-risk AI system.', 'PASS', OWNER_AIGOV, [EV.EU_AI_ACT_GAP_ANALYSIS, EV.CAM_OPEN]),
  euact('10', 'Provider obligations', 'Article 10 — Data and data governance', 'High-risk AI systems making use of techniques involving the training of models shall be developed on the basis of training, validation and testing data sets that meet quality criteria.', 'PARTIAL', OWNER_AIGOV, [EV.EU_AI_ACT_BIAS_REPORT, EV.AUDIT_PII_REDACTION], 'Training data governance documented for SLM corpora; per-agent data lineage partial.', 'Wire IronLedger data-lineage tags into orchestrator middleware (shared remediation with ISO 42001 A.7.5).'),
  euact('11', 'Provider obligations', 'Article 11 — Technical documentation', 'Technical documentation of a high-risk AI system shall be drawn up before placing on the market or putting into service and kept up to date, demonstrating compliance with Section 2.', 'PARTIAL', OWNER_AIGOV, [EV.CANONICAL_DOC_SDK_API, EV.EU_AI_ACT_GAP_ANALYSIS], 'System / training-data / architecture / performance docs maintained; EU conformity declaration + notified-body assessment outstanding.', 'Complete EU conformity declaration package and engage notified body (TÜV SÜD or BSI).'),
  euact('12', 'Provider obligations', 'Article 12 — Record-keeping (logs)', 'High-risk AI systems shall technically allow for the automatic recording of events (logs) over the lifetime of the system.', 'PASS', OWNER_PLATFORM, [EV.AUDIT_LOG_RECENT, EV.IRONLEDGER_HASH_CHAIN, EV.AUDIT_AGENT_RUNS]),
  euact('13', 'Provider obligations', 'Article 13 — Transparency and provision of information to deployers', 'High-risk AI systems shall be designed and developed so that their operation is sufficiently transparent to enable deployers to interpret outputs and use them appropriately.', 'PASS', OWNER_AIGOV, [EV.CANONICAL_DOC_SDK_API]),
  euact('14', 'Provider obligations', 'Article 14 — Human oversight', 'High-risk AI systems shall be designed in such a way that they can be effectively overseen by natural persons during the period in which they are in use.', 'PASS', OWNER_AIGOV, [EV.AUDIT_HITL_DECISIONS]),
  euact('15', 'Provider obligations', 'Article 15 — Accuracy, robustness and cybersecurity', 'High-risk AI systems shall be designed in such a way that they achieve an appropriate level of accuracy, robustness and cybersecurity.', 'PARTIAL', OWNER_PLATFORM, [EV.E2E_REPORT_312, EV.SEC_SAST, EV.SEC_HOUNDDOG], 'Hallucination 6% (target <5%); citation accuracy 82% (target >90%).', 'Tighten correctiveRAG guards and enforce citation post-checks before GA.'),
  euact('16', 'Provider obligations', 'Article 16 — Obligations of providers of high-risk AI systems', 'Providers shall ensure their high-risk AI systems are compliant with the requirements set out in Section 2, including a quality management system per Article 17.', 'PASS', OWNER_AIGOV, [EV.CANONICAL_DOC_GUARDRAILS]),
  euact('17', 'Provider obligations', 'Article 17 — Quality management system', 'Providers of high-risk AI systems shall put a quality management system in place that ensures compliance with this Regulation.', 'PASS', OWNER_AIGOV, [EV.CANONICAL_DOC_GUARDRAILS, EV.CAM_OPEN, EV.CAM_RESOLVED]),
  euact('26', 'Deployer obligations', 'Article 26 — Obligations of deployers of high-risk AI systems', 'Deployers shall take appropriate technical and organisational measures to ensure they use high-risk AI systems in accordance with the instructions for use accompanying the systems.', 'PASS', OWNER_LEGAL, [EV.CANONICAL_DOC_SDK_API]),
  euact('43', 'Conformity', 'Article 43 — Conformity assessment', 'Providers shall ensure that the high-risk AI system undergoes the relevant conformity assessment procedure prior to its placing on the market or putting into service.', 'FAIL', OWNER_AIGOV, [EV.EU_AI_ACT_GAP_ANALYSIS], 'Notified-body conformity assessment not yet engaged — required before EU commercial deployment (August 2026).', 'Engage notified body (TÜV SÜD or BSI) and complete conformity assessment.'),
  euact('47', 'Conformity', 'Article 47 — EU declaration of conformity', 'The provider shall draw up a written, machine-readable, physical or electronically signed EU declaration of conformity for each high-risk AI system.', 'FAIL', OWNER_AIGOV, [EV.EU_AI_ACT_GAP_ANALYSIS], 'EU declaration of conformity not yet authored.', 'Author EU declaration of conformity referencing Annex V template.'),
  euact('49', 'Conformity', 'Article 49 — CE marking', 'The CE marking shall be affixed visibly, legibly and indelibly to high-risk AI systems before they are placed on the market.', 'FAIL', OWNER_AIGOV, [], 'Pending notified-body conformity assessment (Article 43).', 'Affix CE marking after Article 43 + 47 are complete.'),
  euact('50', 'Transparency', 'Article 50 — Transparency obligations for limited-risk AI systems', 'Providers shall ensure that AI systems intended to interact directly with natural persons are designed so that the natural persons are informed they are interacting with an AI system.', 'PASS', OWNER_AIGOV, [EV.CANONICAL_DOC_SDK_API]),
  euact('51', 'GPAI', 'Article 51 — Classification of GPAI models with systemic risk', 'A general-purpose AI model is classified as a GPAI model with systemic risk if it has high-impact capabilities (e.g. ≥10^25 FLOPs).', 'N-A', OWNER_AIGOV, [], 'Platform consumes upstream GPAI providers (Anthropic / OpenAI / Google) and does not train its own GPAI model.'),
  euact('71', 'Registration', 'Article 71 — EU database of high-risk AI systems', 'Providers shall register themselves and their high-risk AI systems in the EU database before placing them on the market.', 'FAIL', OWNER_LEGAL, [EV.EU_AI_ACT_GAP_ANALYSIS], 'Registration in https://ai-act-database.ec.europa.eu pending — required before EU launch.', 'Complete EU AI Act database registration before EU launch (Q3 2026).'),
  euact('72', 'Post-market', 'Article 72 — Post-market monitoring', 'Providers shall establish and document a post-market monitoring system in a manner that is proportionate to the nature of the AI technologies and the risks of the high-risk AI system.', 'PARTIAL', OWNER_AIGOV, [EV.AUDIT_AGENT_RUNS, EV.CAM_OPEN], 'Runtime monitoring active; formal post-market monitoring plan document outstanding.', 'Author post-market monitoring plan referencing Article 72(3) implementing acts.'),
  euact('73', 'Incident reporting', 'Article 73 — Reporting of serious incidents', 'Providers of high-risk AI systems placed on the Union market shall report any serious incident to the market surveillance authorities of the Member States where the incident occurred.', 'PARTIAL', OWNER_LEGAL, [EV.BREACH_LOG, EV.CAM_OPEN], 'Internal CAM workflow ready; per-Member-State authority contact roster not yet compiled.', 'Compile per-Member-State market surveillance authority roster and link from CAM.'),
];

// ─────────────────────────────────────────────────────────────────────────
// GDPR — Regulation (EU) 2016/679
//   Selected articles across principles, lawful basis, data subject rights,
//   controller / processor obligations, breach notification, DPIA, DPO,
//   and international transfers.  (Task #311)
// ─────────────────────────────────────────────────────────────────────────
function gdpr(id: string, cat: string, title: string, text: string,
  verdict: IsoVerdict = 'PASS', owner: string = OWNER_DPO,
  evidenceSources: string[] = [], reason?: string, remediation?: string,
  jur?: Partial<Record<IsoJurisdiction, IsoVerdict>>,
): IsoControl {
  return { controlId: `gdpr_art${id}`, framework: 'gdpr', category: cat, title, text, verdict, owner, evidenceSources, reason, remediation, jurisdictionVerdicts: jur };
}

const GDPR: IsoControl[] = [
  gdpr('5',  'Principles', 'Article 5 — Principles relating to processing of personal data', 'Personal data shall be processed lawfully, fairly and transparently; collected for specified purposes; adequate and relevant; accurate; kept no longer than necessary; processed securely; with accountability.', 'PASS', OWNER_DPO, [EV.AUDIT_PII_REDACTION, EV.CONSENT_RECORDS]),
  gdpr('6',  'Lawfulness', 'Article 6 — Lawfulness of processing', 'Processing shall be lawful only if and to the extent that at least one of: consent, contract, legal obligation, vital interests, public task, or legitimate interests applies.', 'PASS', OWNER_DPO, [EV.CONSENT_RECORDS]),
  gdpr('7',  'Consent', 'Article 7 — Conditions for consent', 'Where processing is based on consent, the controller shall be able to demonstrate that the data subject has consented to processing of his or her personal data.', 'PASS', OWNER_DPO, [EV.CONSENT_RECORDS]),
  gdpr('9',  'Special categories', 'Article 9 — Processing of special categories of personal data', 'Processing of special categories (racial origin, political opinions, religious beliefs, health data, etc.) shall be prohibited unless one of the exceptions in 9(2) applies.', 'PASS', OWNER_DPO, [EV.AUDIT_PII_REDACTION]),
  gdpr('13', 'Information', 'Articles 13–14 — Information to be provided to the data subject', 'Where personal data is collected from the data subject (Art 13) or not from the data subject (Art 14), the controller shall provide identity, purposes, recipients, retention period, rights, and complaint procedure.', 'PASS', OWNER_DPO, [EV.CONSENT_RECORDS]),
  gdpr('15', 'Rights', 'Article 15 — Right of access by the data subject', 'The data subject shall have the right to obtain from the controller confirmation as to whether or not personal data concerning him or her are being processed.', 'PASS', OWNER_DPO, [EV.DSR_ENDPOINTS]),
  gdpr('16', 'Rights', 'Article 16 — Right to rectification', 'The data subject shall have the right to obtain from the controller without undue delay the rectification of inaccurate personal data concerning him or her.', 'PASS', OWNER_DPO, [EV.DSR_ENDPOINTS]),
  gdpr('17', 'Rights', 'Article 17 — Right to erasure ("right to be forgotten")', 'The data subject shall have the right to obtain from the controller the erasure of personal data concerning him or her without undue delay.', 'PARTIAL', OWNER_DPO, [EV.DSR_ENDPOINTS], 'Soft-delete live; hard-delete pipeline scheduled (shared remediation with SOC2 P4.3 / DPDPA s.8.7).', 'Wire encrypted hard-delete after retention TTL expiry.'),
  gdpr('18', 'Rights', 'Article 18 — Right to restriction of processing', 'The data subject shall have the right to obtain from the controller restriction of processing in specified circumstances.', 'PASS', OWNER_DPO, [EV.DSR_ENDPOINTS]),
  gdpr('20', 'Rights', 'Article 20 — Right to data portability', 'The data subject shall have the right to receive the personal data concerning him or her in a structured, commonly used and machine-readable format.', 'PASS', OWNER_DPO, [EV.DSR_ENDPOINTS]),
  gdpr('21', 'Rights', 'Article 21 — Right to object', 'The data subject shall have the right to object, on grounds relating to his or her particular situation, at any time to processing based on Article 6(1)(e) or (f).', 'PASS', OWNER_DPO, [EV.DSR_ENDPOINTS]),
  gdpr('22', 'Rights', 'Article 22 — Automated individual decision-making, including profiling', 'The data subject shall have the right not to be subject to a decision based solely on automated processing which produces legal effects concerning him or her.', 'PASS', OWNER_AIGOV, [EV.AUDIT_HITL_DECISIONS]),
  gdpr('25', 'Controller obligations', 'Article 25 — Data protection by design and by default', 'The controller shall implement appropriate technical and organisational measures, both at the time of the determination of the means for processing and at the time of the processing itself.', 'PASS', OWNER_PLATFORM, [EV.AUDIT_PII_REDACTION, EV.AUDIT_SAFETY_RING]),
  gdpr('28', 'Processor', 'Article 28 — Processor obligations', 'Where processing is to be carried out on behalf of a controller, the controller shall use only processors providing sufficient guarantees, governed by a written contract.', 'PASS', OWNER_LEGAL, [EV.AUDIT_LLM_ROUTING]),
  gdpr('30', 'Records', 'Article 30 — Records of processing activities (ROPA)', 'Each controller and processor shall maintain a record of processing activities under its responsibility, including purposes, categories of data, recipients, retention, and security measures.', 'PASS', OWNER_DPO, [EV.GDPR_ROPA]),
  gdpr('32', 'Security', 'Article 32 — Security of processing', 'The controller and processor shall implement appropriate technical and organisational measures to ensure a level of security appropriate to the risk, including pseudonymisation and encryption.', 'PASS', OWNER_SECURITY, [EV.ENCRYPTION_AT_REST, EV.TLS_CERT_INVENTORY, EV.AUDIT_PII_REDACTION]),
  gdpr('33', 'Breach', 'Article 33 — Notification of a personal data breach to the supervisory authority', 'In the case of a personal data breach, the controller shall without undue delay and, where feasible, not later than 72 hours after having become aware of it, notify the supervisory authority.', 'PARTIAL', OWNER_DPO, [EV.BREACH_LOG], 'Internal 72-hour CAM workflow ready; per-Member-State supervisory authority contact roster not yet compiled.', 'Compile per-Member-State DPA contact roster (shared remediation with EU AI Act Art 73).'),
  gdpr('34', 'Breach', 'Article 34 — Communication of a personal data breach to the data subject', 'When the personal data breach is likely to result in a high risk to the rights and freedoms of natural persons, the controller shall communicate the breach to the data subject without undue delay.', 'PASS', OWNER_DPO, [EV.BREACH_LOG]),
  gdpr('35', 'DPIA', 'Article 35 — Data protection impact assessment', 'Where processing is likely to result in a high risk to the rights and freedoms of natural persons, the controller shall, prior to the processing, carry out an assessment of the impact of the envisaged processing operations.', 'PARTIAL', OWNER_DPO, [EV.GDPR_DPIA, EV.EU_AI_ACT_BIAS_REPORT], 'DPIAs completed for high-risk EU agents; medium-risk inventory pending.', 'Complete DPIA for medium-risk systems flagged by EU AI Act gap analysis (shared remediation with ISO 42001 A.5.4).'),
  gdpr('37', 'DPO', 'Articles 37–39 — Data Protection Officer', 'The controller and the processor shall designate a data protection officer in cases listed in Article 37(1); the DPO shall have expert knowledge of data protection law and practices.', 'PASS', OWNER_DPO, []),
  gdpr('44', 'International transfers', 'Articles 44–49 — Transfers of personal data to third countries', 'Any transfer of personal data which is undergoing processing or is intended for processing after transfer to a third country shall take place only if the conditions in Chapter V are met (adequacy decision, SCCs, BCRs, or derogations).', 'PARTIAL', OWNER_LEGAL, [EV.GDPR_SCC, EV.AUDIT_LLM_ROUTING], 'SCCs in place with primary LLM providers; transfer impact assessments (TIAs) per Schrems II partially documented.', 'Complete TIAs for each upstream LLM provider and link from supplier register.'),
];

export const ISO_CONTROL_CATALOGUE: IsoControl[] = [
  ...ISO_42001,
  ...ISO_27001,
  ...SOC2,
  ...DPDPA,
  ...EU_AI_ACT,
  ...GDPR,
];

export const FRAMEWORK_META: Record<IsoFramework, { name: string; longName: string; controlsExpected: number }> = {
  iso_42001: { name: 'ISO 42001:2023',  longName: 'ISO/IEC 42001:2023 — Artificial Intelligence Management System',  controlsExpected: 38 },
  iso_27001: { name: 'ISO 27001:2022',  longName: 'ISO/IEC 27001:2022 — Information Security Management (Annex A)', controlsExpected: 93 },
  soc2:      { name: 'SOC 2 Type II',   longName: 'SOC 2 Type II — Trust Service Criteria',                         controlsExpected: 64 },
  dpdpa:     { name: 'DPDPA 2023',      longName: 'Digital Personal Data Protection Act 2023 (India)',              controlsExpected: DPDPA.length },
  eu_ai_act: { name: 'EU AI Act',       longName: 'Regulation (EU) 2024/1689 — Artificial Intelligence Act',        controlsExpected: EU_AI_ACT.length },
  gdpr:      { name: 'GDPR',            longName: 'Regulation (EU) 2016/679 — General Data Protection Regulation',  controlsExpected: GDPR.length },
};

export function getControlById(controlId: string): IsoControl | undefined {
  return ISO_CONTROL_CATALOGUE.find((c) => c.controlId === controlId);
}

/**
 * Effective verdict applying jurisdiction overrides. When jurisdiction is
 * 'GLOBAL' or omitted, returns the base verdict.
 */
export function effectiveVerdict(c: IsoControl, jurisdiction: IsoJurisdiction = 'GLOBAL'): IsoVerdict {
  if (jurisdiction === 'GLOBAL') return c.verdict;
  return c.jurisdictionVerdicts?.[jurisdiction] ?? c.verdict;
}
