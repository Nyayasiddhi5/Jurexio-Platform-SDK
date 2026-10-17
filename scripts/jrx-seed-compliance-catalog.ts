/**
 * Jurexio Platform — Compliance Frameworks + Controls Catalog Seeder
 * Idempotent. Uses makePgSql() (NV-DB-SCRIPT-001 compliant).
 *
 * Populates nv_compliance_frameworks + nv_compliance_controls with the
 * canonical control list per jurisdiction × framework. This is the
 * authoritative reference catalog — per-org evidence is layered on top
 * via jrx-seed-compliance-evidence.ts.
 */

import { makePgSql } from './_pg-pool.js';
import { assertColumns } from './_assert-columns.js';
import * as dotenv from 'dotenv';

dotenv.config();
const sql = makePgSql();

// task #347: schema-drift guard — fail loud before any INSERT.
const REQUIRED_COLUMNS = {
  'public.nv_compliance_frameworks': [
    'framework_code', 'name', 'jurisdiction', 'authority', 'version', 'category',
    'description', 'total_controls', 'active', 'effective_from', 'references',
  ],
  'public.nv_compliance_controls': [
    'framework_code', 'control_code', 'title', 'category', 'severity', 'description',
    'requirement_text', 'automation_level', 'evidence_source', 'default_status', 'sort_order',
  ],
} as const;

interface FrameworkDef {
  code: string;
  name: string;
  jurisdiction: string;
  authority: string;
  version: string;
  category: string;
  description: string;
  effective_from: string;
  references: string[];
  controls: ControlDef[];
}
interface ControlDef {
  code: string;
  title: string;
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  requirement_text?: string;
  automation_level?: 'auto' | 'hybrid' | 'manual';
  evidence_source?: string;
}

const sevHigh = (n: number, label: (i: number) => string, cat: string): ControlDef[] =>
  Array.from({ length: n }, (_, i) => ({
    code: label(i),
    title: label(i),
    category: cat,
    severity: 'high' as const,
    description: `${label(i)} — control mapped from authoritative source.`,
    automation_level: 'hybrid' as const,
    evidence_source: 'nv_audit_logs / nv_security_audit_logs',
  }));

const FRAMEWORKS: FrameworkDef[] = [
  // ──────────────────────────── UNITED STATES ────────────────────────────
  {
    code: 'ABA-MR', name: 'ABA Model Rules of Professional Conduct',
    jurisdiction: 'US', authority: 'American Bar Association', version: '2024',
    category: 'legal-ethics', effective_from: '2024-01-01',
    description: 'Foundational professional-conduct rules for US lawyers; binding via state-bar adoption.',
    references: ['https://www.americanbar.org/groups/professional_responsibility/publications/model_rules_of_professional_conduct/'],
    controls: [
      { code: 'MR-1.1', title: 'Competence', category: 'professional', severity: 'high',
        description: 'A lawyer shall provide competent representation, including legal knowledge, skill, thoroughness and preparation.',
        requirement_text: 'AI-assisted output reviewed by a competent attorney before client delivery.',
        automation_level: 'hybrid', evidence_source: 'HITL approval logs + Output review attestations' },
      { code: 'MR-1.6', title: 'Confidentiality of Information', category: 'confidentiality', severity: 'critical',
        description: 'A lawyer shall not reveal information relating to the representation of a client unless authorised.',
        requirement_text: 'PII redaction before any external LLM call; tenant-isolated storage.',
        automation_level: 'auto', evidence_source: 'nv_pii_detections + tenantIsolation middleware logs' },
      { code: 'MR-1.7', title: 'Conflict of Interest: Current Clients', category: 'conflict', severity: 'high',
        description: 'Concurrent-conflict screening across matters.',
        automation_level: 'hybrid', evidence_source: 'Matter-conflict scan jobs' },
      { code: 'MR-1.15', title: 'Safekeeping Property', category: 'trust-funds', severity: 'high',
        description: 'Client funds and property kept separate; trust-account audit trail.',
        automation_level: 'hybrid', evidence_source: 'Billing ledger reconciliation' },
      { code: 'MR-3.3', title: 'Candor Toward the Tribunal', category: 'tribunal', severity: 'high',
        description: 'No false statements of fact or law to a tribunal.',
        requirement_text: 'Hallucination check + citation verification on all generated court filings.',
        automation_level: 'auto', evidence_source: 'nv_hallucination_checks + nv_citation_verifications' },
      { code: 'MR-5.3', title: 'Responsibilities Regarding Nonlawyer Assistance', category: 'supervision', severity: 'high',
        description: 'Supervisory duties extend to AI tools used in representation.',
        automation_level: 'hybrid', evidence_source: 'Agent execution audit chain' },
      { code: 'MR-5.5', title: 'Unauthorised Practice of Law', category: 'practice', severity: 'critical',
        description: 'Jurisdiction-aware UPL guardrails on all output.',
        automation_level: 'auto', evidence_source: 'Jurisdiction-binding middleware' },
      { code: 'MR-7.1', title: 'Communications Concerning a Lawyer\'s Services', category: 'advertising', severity: 'medium',
        description: 'No false or misleading communications.',
        automation_level: 'manual', evidence_source: 'Marketing-review checklist' },
      { code: 'MR-1.4', title: 'Communication', category: 'client-communication', severity: 'high',
        description: 'Reasonable communication with clients about representation status and decisions.',
        automation_level: 'hybrid', evidence_source: 'Client-portal message logs' },
      { code: 'MR-1.18', title: 'Duties to Prospective Clients', category: 'intake', severity: 'medium',
        description: 'Confidentiality and conflict screening at intake.',
        automation_level: 'auto', evidence_source: 'NYM intake conflict scan' },
    ],
  },
  {
    code: 'ABA-512', name: 'ABA Formal Opinion 512 — Generative AI in Legal Practice',
    jurisdiction: 'US', authority: 'ABA Standing Committee on Ethics and Professional Responsibility',
    version: '2024-07-29', category: 'ai-ethics', effective_from: '2024-07-29',
    description: 'Lawyers\' ethical obligations when using generative AI in legal practice.',
    references: ['https://www.americanbar.org/content/dam/aba/administrative/professional_responsibility/ethics-opinions/aba-formal-opinion-512.pdf'],
    controls: [
      { code: '512-CMP', title: 'Technological Competence (Comment 8 to MR-1.1)', category: 'competence', severity: 'high',
        description: 'Lawyer must reasonably understand benefits and risks of GAI tools used.',
        automation_level: 'manual', evidence_source: 'GAI training certifications' },
      { code: '512-CONF', title: 'Confidentiality of Client Information in GAI Inputs', category: 'confidentiality', severity: 'critical',
        description: 'Informed-consent requirements before submitting client info to a self-learning GAI.',
        automation_level: 'auto', evidence_source: 'PII redaction middleware + consent records' },
      { code: '512-COMM', title: 'Communication with Client about GAI Use', category: 'communication', severity: 'high',
        description: 'Disclosure when GAI is materially relied upon for advice or work product.',
        automation_level: 'hybrid', evidence_source: 'Engagement letter templates + matter notes' },
      { code: '512-MERIT', title: 'Meritorious Claims and Candor (MR-3.1, 3.3)', category: 'tribunal', severity: 'critical',
        description: 'Independent verification of GAI-generated case citations and authority.',
        automation_level: 'auto', evidence_source: 'Citation verifier service' },
      { code: '512-SUP', title: 'Supervisory Responsibilities (MR-5.1, 5.3)', category: 'supervision', severity: 'high',
        description: 'Firms must establish clear policies on GAI use.',
        automation_level: 'hybrid', evidence_source: 'Internal AI policy + agent-execution audit' },
      { code: '512-FEES', title: 'Reasonable Fees (MR-1.5)', category: 'billing', severity: 'medium',
        description: 'Client billed only for time actually spent; no markup of subscription cost.',
        automation_level: 'hybrid', evidence_source: 'Billing ledger' },
      { code: '512-NDISC', title: 'Non-Discrimination (MR-8.4(g))', category: 'bias', severity: 'high',
        description: 'Bias-aware use of GAI in employment/decision contexts.',
        automation_level: 'auto', evidence_source: 'Bias audit service' },
    ],
  },
  {
    code: 'SOC2-TSC', name: 'SOC 2 Type II — Trust Services Criteria',
    jurisdiction: 'US', authority: 'AICPA', version: '2017 (rev. 2022)',
    category: 'security', effective_from: '2022-12-15',
    description: 'AICPA Trust Services Criteria covering Security, Availability, Processing Integrity, Confidentiality, Privacy.',
    references: ['https://www.aicpa-cima.com/resources/landing/system-and-organization-controls-soc-suite-of-services'],
    controls: [
      ...['CC1.1','CC1.2','CC1.3','CC1.4','CC1.5'].map(c => ({ code:c, title:`${c} — Control Environment`, category:'CC1 Control Environment', severity:'high' as const, description:'COSO control environment principles applied to security.', automation_level:'hybrid' as const, evidence_source:'HR policies + RBAC config' })),
      ...['CC2.1','CC2.2','CC2.3'].map(c => ({ code:c, title:`${c} — Communication & Information`, category:'CC2 Communication', severity:'medium' as const, description:'Internal/external communication of security obligations.', automation_level:'manual' as const, evidence_source:'Internal comms log' })),
      ...['CC3.1','CC3.2','CC3.3','CC3.4'].map(c => ({ code:c, title:`${c} — Risk Assessment`, category:'CC3 Risk Assessment', severity:'high' as const, description:'Identify, analyse, respond to risks.', automation_level:'hybrid' as const, evidence_source:'Risk register' })),
      ...['CC4.1','CC4.2'].map(c => ({ code:c, title:`${c} — Monitoring Activities`, category:'CC4 Monitoring', severity:'high' as const, description:'Continuous monitoring of internal control.', automation_level:'auto' as const, evidence_source:'OpenTelemetry + nv_audit_logs' })),
      ...['CC5.1','CC5.2','CC5.3'].map(c => ({ code:c, title:`${c} — Control Activities`, category:'CC5 Control Activities', severity:'high' as const, description:'Control activities deployed via policies and procedures.', automation_level:'hybrid' as const, evidence_source:'Policy registry' })),
      ...Array.from({length:8},(_,i)=>`CC6.${i+1}`).map(c => ({ code:c, title:`${c} — Logical & Physical Access`, category:'CC6 Logical Access', severity:'critical' as const, description:'Access controls restrict logical and physical access.', automation_level:'auto' as const, evidence_source:'RBAC + nv_security_audit_logs' })),
      ...['CC7.1','CC7.2','CC7.3','CC7.4','CC7.5'].map(c => ({ code:c, title:`${c} — System Operations`, category:'CC7 System Operations', severity:'high' as const, description:'Detection and response to security events.', automation_level:'auto' as const, evidence_source:'Incident response runbook + alerts' })),
      ...['CC8.1'].map(c => ({ code:c, title:`${c} — Change Management`, category:'CC8 Change Management', severity:'high' as const, description:'Authorised changes to infra/code/data.', automation_level:'auto' as const, evidence_source:'Git history + deploy manifest' })),
      ...['CC9.1','CC9.2'].map(c => ({ code:c, title:`${c} — Risk Mitigation`, category:'CC9 Risk Mitigation', severity:'high' as const, description:'Identify, select, develop risk mitigation.', automation_level:'hybrid' as const, evidence_source:'Risk treatment plan' })),
      // Availability
      ...['A1.1','A1.2','A1.3'].map(c => ({ code:c, title:`${c} — Availability`, category:'A Availability', severity:'high' as const, description:'Performance, capacity, environmental protection.', automation_level:'auto' as const, evidence_source:'Uptime metrics + DR runbook' })),
      // Confidentiality
      ...['C1.1','C1.2'].map(c => ({ code:c, title:`${c} — Confidentiality`, category:'C Confidentiality', severity:'critical' as const, description:'Identify and protect confidential information.', automation_level:'auto' as const, evidence_source:'Encryption inventory + PII vault' })),
      // Processing Integrity
      ...['PI1.1','PI1.2','PI1.3','PI1.4','PI1.5'].map(c => ({ code:c, title:`${c} — Processing Integrity`, category:'PI Processing Integrity', severity:'high' as const, description:'Complete, valid, accurate, timely, authorised processing.', automation_level:'auto' as const, evidence_source:'IronLedger hash chain' })),
      // Privacy
      ...['P1.1','P2.1','P3.1','P3.2','P4.1','P4.2','P4.3','P5.1','P5.2','P6.1','P6.2','P6.3','P6.4','P6.5','P6.6','P6.7','P7.1','P8.1'].map(c => ({ code:c, title:`${c} — Privacy`, category:'P Privacy', severity:'high' as const, description:'Notice, choice, collection, use, retention, disposal, access, disclosure, security, quality, monitoring.', automation_level:'auto' as const, evidence_source:'Consent registry + nv_pii_detections' })),
    ],
  },
  {
    code: 'HIPAA', name: 'HIPAA — Health Insurance Portability and Accountability Act',
    jurisdiction: 'US', authority: 'HHS Office for Civil Rights', version: '45 CFR §164',
    category: 'privacy-health', effective_from: '2003-04-14',
    description: 'US healthcare privacy + security rule for PHI handling.',
    references: ['https://www.hhs.gov/hipaa/for-professionals/security/laws-regulations/'],
    controls: [
      // Administrative safeguards (164.308) — 9 standards
      ...[
        ['164.308(a)(1)','Security Management Process'],
        ['164.308(a)(2)','Assigned Security Responsibility'],
        ['164.308(a)(3)','Workforce Security'],
        ['164.308(a)(4)','Information Access Management'],
        ['164.308(a)(5)','Security Awareness and Training'],
        ['164.308(a)(6)','Security Incident Procedures'],
        ['164.308(a)(7)','Contingency Plan'],
        ['164.308(a)(8)','Evaluation'],
        ['164.308(b)(1)','Business Associate Contracts'],
      ].map(([c,t]) => ({ code:c, title:t, category:'Administrative Safeguards', severity:'high' as const, description:`HIPAA Security Rule — ${t}.`, automation_level:'hybrid' as const, evidence_source:'Workforce training records + BAAs' })),
      // Physical safeguards (164.310)
      ...[
        ['164.310(a)','Facility Access Controls'],
        ['164.310(b)','Workstation Use'],
        ['164.310(c)','Workstation Security'],
        ['164.310(d)','Device and Media Controls'],
      ].map(([c,t]) => ({ code:c, title:t, category:'Physical Safeguards', severity:'high' as const, description:`HIPAA Security Rule — ${t}.`, automation_level:'manual' as const, evidence_source:'AWS shared responsibility report' })),
      // Technical safeguards (164.312) — 5 standards
      ...[
        ['164.312(a)','Access Control'],
        ['164.312(b)','Audit Controls'],
        ['164.312(c)','Integrity'],
        ['164.312(d)','Person or Entity Authentication'],
        ['164.312(e)','Transmission Security'],
      ].map(([c,t]) => ({ code:c, title:t, category:'Technical Safeguards', severity:'critical' as const, description:`HIPAA Security Rule — ${t}.`, automation_level:'auto' as const, evidence_source:'RBAC + IronLedger + TLS 1.3' })),
      // Privacy rule highlights (164.500-534)
      ...[
        ['164.502','Uses and Disclosures: General Rules'],
        ['164.508','Authorization Required'],
        ['164.514','De-identification of PHI'],
        ['164.524','Right of Access'],
        ['164.526','Right to Amend'],
        ['164.528','Accounting of Disclosures'],
      ].map(([c,t]) => ({ code:c, title:t, category:'Privacy Rule', severity:'high' as const, description:`HIPAA Privacy Rule — ${t}.`, automation_level:'hybrid' as const, evidence_source:'Consent records + audit chain' })),
      // Breach notification (164.400-414)
      ...[
        ['164.404','Notification to Individuals'],
        ['164.406','Notification to Media'],
        ['164.408','Notification to HHS'],
        ['164.410','Notification by Business Associate'],
      ].map(([c,t]) => ({ code:c, title:t, category:'Breach Notification', severity:'critical' as const, description:`HIPAA Breach Notification — ${t}.`, automation_level:'manual' as const, evidence_source:'Incident response playbook' })),
    ],
  },
  {
    code: 'CCPA-CPRA', name: 'CCPA/CPRA — California Consumer Privacy Act / CA Privacy Rights Act',
    jurisdiction: 'US', authority: 'California Privacy Protection Agency', version: '2023',
    category: 'privacy', effective_from: '2023-01-01',
    description: 'California consumer privacy rights and obligations.',
    references: ['https://cppa.ca.gov/regulations/'],
    controls: [
      ...[
        ['1798.100','Right to Know'],
        ['1798.105','Right to Delete'],
        ['1798.106','Right to Correct'],
        ['1798.110','Right to Specific Pieces of Info'],
        ['1798.115','Right to Know about Sale/Sharing'],
        ['1798.120','Right to Opt-Out of Sale/Sharing'],
        ['1798.121','Right to Limit Use of SPI'],
        ['1798.125','Right to Non-Discrimination'],
        ['1798.130','Notice at Collection'],
        ['1798.135','Methods for Submitting Requests'],
        ['1798.140','Definitions and Service Provider Contracts'],
        ['1798.145','Exemptions'],
        ['1798.150','Private Right of Action — Data Breach'],
        ['1798.155','Enforcement'],
      ].map(([c,t]) => ({ code:c, title:t, category:'Consumer Rights', severity:'high' as const, description:`CCPA/CPRA §${c} — ${t}.`, automation_level:'hybrid' as const, evidence_source:'DSAR portal + consent records' })),
      ...[
        ['CPRA-RA','Annual Risk Assessment'],
        ['CPRA-AUDIT','Annual Cybersecurity Audit'],
        ['CPRA-AUTO','Automated Decision-Making Disclosure'],
        ['CPRA-MIN','Data Minimisation'],
        ['CPRA-RET','Retention Disclosure'],
      ].map(([c,t]) => ({ code:c, title:t, category:'CPRA Additional', severity:'high' as const, description:t, automation_level:'hybrid' as const, evidence_source:'Annual audit reports' })),
      ...['SPI-DOB','SPI-SSN','SPI-GEO','SPI-RACE'].map(c => ({ code:c, title:`Sensitive PI Handling — ${c.replace('SPI-','')}`, category:'Sensitive PI', severity:'critical' as const, description:'Use limitation for sensitive personal information.', automation_level:'auto' as const, evidence_source:'PII vault classification' })),
    ],
  },
  {
    code: 'NIST-AI-RMF', name: 'NIST AI Risk Management Framework 1.0',
    jurisdiction: 'US', authority: 'NIST', version: '1.0 (Jan 2023) + GenAI Profile (Jul 2024)',
    category: 'ai-governance', effective_from: '2023-01-26',
    description: 'Voluntary framework for managing AI risks across the lifecycle.',
    references: ['https://www.nist.gov/itl/ai-risk-management-framework'],
    controls: [
      ...['GOVERN-1.1','GOVERN-1.2','GOVERN-2.1','GOVERN-3.1','GOVERN-4.1','GOVERN-5.1','GOVERN-6.1'].map(c => ({ code:c, title:`${c} Govern`, category:'GOVERN', severity:'high' as const, description:'Cultivate a culture of AI risk management.', automation_level:'hybrid' as const, evidence_source:'AI governance charter' })),
      ...['MAP-1.1','MAP-2.1','MAP-3.1','MAP-4.1','MAP-5.1'].map(c => ({ code:c, title:`${c} Map`, category:'MAP', severity:'medium' as const, description:'Context, categorisation, capability, risk identification.', automation_level:'hybrid' as const, evidence_source:'Model registry + agent registry' })),
      ...['MEASURE-1.1','MEASURE-2.1','MEASURE-3.1','MEASURE-4.1'].map(c => ({ code:c, title:`${c} Measure`, category:'MEASURE', severity:'high' as const, description:'Quantitative + qualitative AI metrics.', automation_level:'auto' as const, evidence_source:'Drift monitor + bias audit + LLM judge' })),
      ...['MANAGE-1.1','MANAGE-2.1','MANAGE-3.1','MANAGE-4.1'].map(c => ({ code:c, title:`${c} Manage`, category:'MANAGE', severity:'high' as const, description:'Allocate resources to map and measure outputs.', automation_level:'hybrid' as const, evidence_source:'Routing weights + budget controls' })),
      ...[
        ['GENAI-1','Confabulation Mitigation'],
        ['GENAI-2','Dangerous/Violent Content'],
        ['GENAI-3','Data Privacy in Outputs'],
        ['GENAI-4','Environmental Impact'],
        ['GENAI-5','Harmful Bias and Homogenisation'],
        ['GENAI-6','Human-AI Configuration'],
        ['GENAI-7','Information Integrity'],
        ['GENAI-8','Information Security'],
        ['GENAI-9','Intellectual Property'],
        ['GENAI-10','Obscene/Degrading Content'],
        ['GENAI-11','Toxicity, Bias, and Homogenisation'],
        ['GENAI-12','Value Chain and Component Integration'],
      ].map(([c,t]) => ({ code:c, title:t, category:'GenAI Profile', severity:'high' as const, description:`NIST GenAI Profile — ${t}.`, automation_level:'auto' as const, evidence_source:'Safety ring services' })),
    ],
  },
  {
    code: 'NYDFS-500', name: 'NYDFS Part 500 — Cybersecurity Requirements',
    jurisdiction: 'US', authority: 'New York Department of Financial Services', version: '2nd Amendment 2023',
    category: 'cybersecurity', effective_from: '2023-11-01',
    description: 'Cybersecurity requirements for financial services companies regulated by NYDFS.',
    references: ['https://www.dfs.ny.gov/industry_guidance/cybersecurity'],
    controls: [
      ...['500.2','500.3','500.4','500.5','500.6','500.7','500.8','500.9','500.10','500.11','500.12','500.13','500.14','500.15','500.16','500.17','500.18','500.19','500.20','500.21','500.22','500.23','500.24'].map(c => ({ code:c, title:`§${c}`, category:'Cybersecurity Program', severity:'high' as const, description:`NYDFS Part 500 §${c}.`, automation_level:'hybrid' as const, evidence_source:'CISO program + annual cert' })),
    ],
  },
  {
    code: 'IL-AI-ACT', name: 'Illinois Artificial Intelligence Video Interview Act + 2026 AI Amendments',
    jurisdiction: 'US', authority: 'State of Illinois', version: '2026',
    category: 'ai-employment', effective_from: '2026-01-01',
    description: 'Illinois employment AI disclosure + bias-audit obligations.',
    references: ['https://www.ilga.gov/legislation/'],
    controls: ['IL-AI-1','IL-AI-2','IL-AI-3','IL-AI-4','IL-AI-5','IL-AI-6','IL-AI-7','IL-AI-8'].map(c => ({
      code:c, title:`Illinois AI ${c}`, category:'employment-AI', severity:'high' as const,
      description:'Pre-deployment notice, bias audit, candidate consent, decision-explanation.',
      automation_level:'hybrid' as const, evidence_source:'Bias audit reports',
    })),
  },

  // ──────────────────────────── EUROPEAN UNION ────────────────────────────
  {
    code: 'GDPR', name: 'GDPR — General Data Protection Regulation',
    jurisdiction: 'EU', authority: 'European Data Protection Board', version: 'Reg. (EU) 2016/679',
    category: 'privacy', effective_from: '2018-05-25',
    description: 'EU comprehensive data protection regulation.',
    references: ['https://eur-lex.europa.eu/eli/reg/2016/679/oj'],
    controls: ['Art-5','Art-6','Art-7','Art-8','Art-9','Art-12','Art-13','Art-14','Art-15','Art-16','Art-17','Art-18','Art-19','Art-20','Art-21','Art-22','Art-24','Art-25','Art-28','Art-30','Art-32','Art-33','Art-34','Art-35','Art-36','Art-37','Art-38','Art-44','Art-46','Art-49'].map(c => ({
      code:c, title:`GDPR ${c}`, category:'GDPR', severity:'critical' as const,
      description:`GDPR ${c} obligation.`, automation_level:'auto' as const, evidence_source:'Consent registry + DPIA + DSAR portal',
    })),
  },
  {
    code: 'EU-AI-ACT', name: 'EU AI Act (Regulation (EU) 2024/1689)',
    jurisdiction: 'EU', authority: 'European Commission AI Office', version: '2024/1689',
    category: 'ai-governance', effective_from: '2024-08-01',
    description: 'EU horizontal AI regulation; risk-based obligations on providers and deployers.',
    references: ['https://eur-lex.europa.eu/eli/reg/2024/1689/oj'],
    controls: [
      ...['Art-5','Art-6','Art-9','Art-10','Art-11','Art-12','Art-13','Art-14','Art-15','Art-16','Art-17','Art-26','Art-27','Art-50','Art-52','Art-53','Art-55','Art-72','Art-99'].map(c => ({
        code:c, title:`EU AI Act ${c}`, category:'AI Act', severity:'critical' as const,
        description:`Article ${c} — risk-management / data-governance / transparency / oversight obligations.`,
        automation_level:'auto' as const, evidence_source:'Risk register + drift monitor + bias audit + model card',
      })),
      ...[
        ['GPAI-1','GPAI Model Card'],
        ['GPAI-2','GPAI Training Data Transparency Summary'],
        ['GPAI-3','GPAI Copyright Compliance Policy'],
        ['GPAI-4','GPAI Systemic-Risk Adversarial Testing'],
        ['GPAI-5','GPAI Incident Reporting'],
        ['GPAI-6','GPAI Cybersecurity Protections'],
      ].map(([c,t]) => ({ code:c, title:t, category:'GPAI Obligations', severity:'high' as const, description:t, automation_level:'hybrid' as const, evidence_source:'Model registry + adversarial testing logs' })),
    ],
  },
  {
    code: 'NIS2', name: 'NIS2 Directive — Network and Information Security',
    jurisdiction: 'EU', authority: 'ENISA / National CSIRTs', version: 'Directive (EU) 2022/2555',
    category: 'cybersecurity', effective_from: '2024-10-17',
    description: 'EU baseline cybersecurity for essential and important entities.',
    references: ['https://eur-lex.europa.eu/eli/dir/2022/2555/oj'],
    controls: ['NIS2-RA','NIS2-IR','NIS2-BCP','NIS2-SUPPLY','NIS2-VULN','NIS2-CRYPTO','NIS2-MFA','NIS2-TRAIN','NIS2-ASSESS','NIS2-INC-EARLY','NIS2-INC-FULL','NIS2-INC-FINAL','NIS2-EXEC','NIS2-COOP','NIS2-PEER'].map(c => ({
      code:c, title:`NIS2 ${c}`, category:'Cyber Hygiene', severity:'high' as const,
      description:`NIS2 ${c} obligation.`, automation_level:'hybrid' as const, evidence_source:'CSIRT runbooks + IR playbooks',
    })),
  },
  {
    code: 'DSA', name: 'Digital Services Act',
    jurisdiction: 'EU', authority: 'European Commission', version: 'Regulation (EU) 2022/2065',
    category: 'platform-regulation', effective_from: '2024-02-17',
    description: 'EU obligations on intermediary services and platforms.',
    references: ['https://eur-lex.europa.eu/eli/reg/2022/2065/oj'],
    controls: ['DSA-Art14','DSA-Art15','DSA-Art16','DSA-Art17','DSA-Art20','DSA-Art21','DSA-Art22','DSA-Art24','DSA-Art27','DSA-Art28','DSA-Art34','DSA-Art35'].map(c => ({
      code:c, title:`DSA ${c}`, category:'DSA', severity:'medium' as const,
      description:`DSA ${c} obligation.`, automation_level:'manual' as const, evidence_source:'Transparency reports',
    })),
  },

  // ──────────────────────────── INDIA ────────────────────────────
  {
    code: 'DPDP-2023', name: 'Digital Personal Data Protection Act 2023',
    jurisdiction: 'IN', authority: 'Data Protection Board of India (DPBI)', version: '2023',
    category: 'privacy', effective_from: '2023-08-11',
    description: 'India\'s comprehensive personal data protection statute.',
    references: ['https://www.meity.gov.in/data-protection-framework'],
    controls: ['§4-Lawful','§5-Notice','§6-Consent','§7-LegitUse','§8-DFConsent','§9-Children','§10-DPDF','§11-Access','§12-Correction','§13-Grievance','§14-Nominate','§15-Duty','§16-CrossBorder','§17-Exempt','§18-Board','§24-Appeal','§28-Penalty','§33-Sched'].map(c => ({
      code:c, title:`DPDP ${c}`, category:'DPDP', severity:'critical' as const,
      description:`DPDP ${c} obligation.`, automation_level:'auto' as const, evidence_source:'Consent manager + nv_pii_detections',
    })),
  },
  {
    code: 'IT-ACT-2000', name: 'Information Technology Act 2000 + Rules',
    jurisdiction: 'IN', authority: 'MeitY', version: '2000 (with 2008/2011/2021/2023 amendments)',
    category: 'cybersecurity-it', effective_from: '2000-10-17',
    description: 'India IT Act including SPDI Rules 2011 and CERT-In Directions 2022.',
    references: ['https://www.meity.gov.in/content/information-technology-act-2000'],
    controls: [
      ['§43A','Reasonable Security Practices for SPDI'],
      ['§66','Computer-related Offences'],
      ['§69','Interception/Monitoring'],
      ['§70','Protected Systems'],
      ['§72','Breach of Confidentiality'],
      ['§79','Intermediary Liability Safe Harbour'],
      ['SPDI-R3','SPDI Privacy Policy Publication'],
      ['SPDI-R4','SPDI Consent for Collection'],
      ['SPDI-R5','SPDI Disclosure Restrictions'],
      ['SPDI-R8','SPDI Reasonable Security (ISO 27001)'],
      ['CERT-In-2022','6-hour Incident Reporting'],
      ['CERT-In-Logs','180-day Log Retention in India'],
    ].map(([c,t]) => ({ code:c, title:t, category:'IT Act', severity:'high' as const, description:t, automation_level:'hybrid' as const, evidence_source:'CERT-In compliance log' })),
  },
  {
    code: 'BCI-IT', name: 'Bar Council of India IT Rules + Advocates Act 1961',
    jurisdiction: 'IN', authority: 'Bar Council of India', version: '2024',
    category: 'legal-ethics', effective_from: '2024-01-01',
    description: 'Indian legal-profession conduct rules including AI/IT use guidance.',
    references: ['https://www.barcouncilofindia.org/'],
    controls: [['BCI-1','Confidentiality (§Ch.II Pt.VI)'],['BCI-2','Conflict of Interest'],['BCI-3','Professional Misconduct'],['BCI-4','AI-assisted Drafting Disclosure'],['BCI-5','Client Funds Trust'],['BCI-6','Advertising Restrictions']].map(([c,t]) => ({
      code:c, title:t, category:'Conduct', severity:'high' as const, description:t, automation_level:'manual' as const, evidence_source:'Bar association attestations',
    })),
  },
  {
    code: 'RBI-CYBER', name: 'RBI Cybersecurity Framework + Master Directions',
    jurisdiction: 'IN', authority: 'Reserve Bank of India', version: '2024',
    category: 'cybersecurity-finance', effective_from: '2016-06-02',
    description: 'RBI cybersecurity framework for banks, NBFCs, payment system operators.',
    references: ['https://rbi.org.in/'],
    controls: ['RBI-1','RBI-2','RBI-3','RBI-4','RBI-5','RBI-6','RBI-7','RBI-8','RBI-9','RBI-10'].map((c,i) => ({
      code:c, title:`RBI Cyber Annex ${i+1}`, category:'Cyber Hygiene', severity:'high' as const,
      description:`RBI cybersecurity baseline control ${c}.`, automation_level:'hybrid' as const, evidence_source:'Quarterly RBI compliance report',
    })),
  },

  // ──────────────────────────── UNITED KINGDOM ────────────────────────────
  {
    code: 'UK-GDPR', name: 'UK GDPR + Data Protection Act 2018',
    jurisdiction: 'UK', authority: 'Information Commissioner\'s Office (ICO)', version: '2021',
    category: 'privacy', effective_from: '2021-01-01',
    description: 'UK retained version of GDPR plus DPA 2018 supplementary regime.',
    references: ['https://ico.org.uk/'],
    controls: ['UK-Art-5','UK-Art-6','UK-Art-9','UK-Art-12','UK-Art-13','UK-Art-15','UK-Art-17','UK-Art-22','UK-Art-25','UK-Art-30','UK-Art-32','UK-Art-33','UK-Art-35','UK-Art-44','DPA18-S58','DPA18-S64','DPA18-S170','DPA18-Sch1','ICO-AGE','ICO-AAA'].map(c => ({
      code:c, title:`UK ${c}`, category:'UK GDPR', severity:'high' as const, description:`UK GDPR / DPA 2018 ${c} obligation.`,
      automation_level:'auto' as const, evidence_source:'ICO accountability framework',
    })),
  },
  {
    code: 'SRA-STD', name: 'SRA Standards & Regulations + Code of Conduct',
    jurisdiction: 'UK', authority: 'Solicitors Regulation Authority', version: '2019 (rev. 2024)',
    category: 'legal-ethics', effective_from: '2019-11-25',
    description: 'SRA professional principles, code of conduct for solicitors and firms.',
    references: ['https://www.sra.org.uk/solicitors/standards-regulations/'],
    controls: ['SRA-Princ','SRA-1.1','SRA-2.1','SRA-3.1','SRA-4.1','SRA-5.1','SRA-6.1','SRA-7.1','SRA-AML','SRA-AI'].map(c => ({
      code:c, title:`SRA ${c}`, category:'Conduct', severity:'high' as const,
      description:`SRA standard ${c}.`, automation_level:'manual' as const, evidence_source:'Annual SRA return',
    })),
  },

  // ──────────────────────────── SINGAPORE ────────────────────────────
  {
    code: 'PDPA-SG', name: 'Singapore Personal Data Protection Act 2012',
    jurisdiction: 'SG', authority: 'Personal Data Protection Commission', version: '2020 amendment',
    category: 'privacy', effective_from: '2014-07-02',
    description: 'Singapore data protection law with 11 obligations.',
    references: ['https://www.pdpc.gov.sg/'],
    controls: [['PDPA-1','Consent'],['PDPA-2','Purpose Limitation'],['PDPA-3','Notification'],['PDPA-4','Access & Correction'],['PDPA-5','Accuracy'],['PDPA-6','Protection'],['PDPA-7','Retention'],['PDPA-8','Transfer Limitation'],['PDPA-9','Accountability'],['PDPA-10','Data Breach Notification'],['PDPA-11','Data Portability']].map(([c,t]) => ({
      code:c, title:t, category:'PDPA Obligations', severity:'high' as const, description:`PDPA ${t}.`, automation_level:'auto' as const, evidence_source:'PDPA registry',
    })),
  },
  {
    code: 'SG-CSA', name: 'Singapore Cybersecurity Act 2018',
    jurisdiction: 'SG', authority: 'Cyber Security Agency of Singapore', version: '2018',
    category: 'cybersecurity', effective_from: '2018-08-31',
    description: 'CSA framework, CII designation, IR obligations.',
    references: ['https://www.csa.gov.sg/legislation'],
    controls: ['CSA-CII','CSA-IR','CSA-CYB','CSA-AUDIT','CSA-COMP','CSA-LIC','CSA-INFO','CSA-INV'].map(c => ({
      code:c, title:`SG CSA ${c}`, category:'Cyber Hygiene', severity:'high' as const,
      description:`Singapore Cybersecurity Act ${c}.`, automation_level:'hybrid' as const, evidence_source:'CSA annual return',
    })),
  },

  // ──────────────────────────── GCC ────────────────────────────
  {
    code: 'UAE-PDPL', name: 'UAE Personal Data Protection Law (Federal Decree-Law No. 45/2021)',
    jurisdiction: 'GC', authority: 'UAE Data Office', version: '45/2021',
    category: 'privacy', effective_from: '2022-01-02',
    description: 'UAE federal personal data protection regime.',
    references: ['https://u.ae/'],
    controls: ['UAE-Art4','UAE-Art5','UAE-Art6','UAE-Art7','UAE-Art8','UAE-Art9','UAE-Art13','UAE-Art14','UAE-Art15','UAE-Art21','UAE-Art22','UAE-Art23','UAE-Art24','UAE-Art27'].map(c => ({
      code:c, title:`UAE PDPL ${c}`, category:'Privacy', severity:'high' as const,
      description:`UAE PDPL ${c}.`, automation_level:'hybrid' as const, evidence_source:'Consent ledger',
    })),
  },
  {
    code: 'KSA-PDPL', name: 'Saudi Personal Data Protection Law',
    jurisdiction: 'GC', authority: 'Saudi Data and AI Authority (SDAIA)', version: '2023 (rev. 2024)',
    category: 'privacy', effective_from: '2023-09-14',
    description: 'Kingdom of Saudi Arabia personal data protection law.',
    references: ['https://sdaia.gov.sa/'],
    controls: ['KSA-Art4','KSA-Art5','KSA-Art6','KSA-Art10','KSA-Art12','KSA-Art16','KSA-Art20','KSA-Art21','KSA-Art29','KSA-Art33','KSA-Art34','KSA-Art35'].map(c => ({
      code:c, title:`Saudi PDPL ${c}`, category:'Privacy', severity:'high' as const,
      description:`Saudi PDPL ${c}.`, automation_level:'hybrid' as const, evidence_source:'SDAIA registration + DSAR',
    })),
  },
  {
    code: 'SAMA-CYBER', name: 'SAMA Cybersecurity Framework',
    jurisdiction: 'GC', authority: 'Saudi Central Bank (SAMA)', version: '1.0',
    category: 'cybersecurity-finance', effective_from: '2017-05-01',
    description: 'SAMA cybersecurity framework for member organisations.',
    references: ['https://www.sama.gov.sa/'],
    controls: ['SAMA-1','SAMA-2','SAMA-3','SAMA-4','SAMA-5','SAMA-6','SAMA-7','SAMA-8','SAMA-9','SAMA-10'].map((c,i) => ({
      code:c, title:`SAMA Domain ${i+1}`, category:'Cyber Domains', severity:'high' as const,
      description:`SAMA cybersecurity domain ${c}.`, automation_level:'hybrid' as const, evidence_source:'Annual SAMA self-assessment',
    })),
  },

  // ──────────────────────────── CROSS-CUTTING (ISO) ────────────────────────────
  {
    code: 'ISO-42001', name: 'ISO/IEC 42001:2023 — AI Management System',
    jurisdiction: 'ALL', authority: 'ISO/IEC', version: '2023',
    category: 'ai-governance', effective_from: '2023-12-18',
    description: 'International standard for AI management systems (AIMS).',
    references: ['https://www.iso.org/standard/81230.html'],
    controls: [
      ...['4.1','4.2','4.3','4.4','5.1','5.2','5.3','6.1','6.2','7.1','7.2','7.3','7.4','7.5','8.1','8.2','8.3','9.1','9.2','9.3','10.1','10.2'].map(c => ({
        code:`Cl-${c}`, title:`Clause ${c}`, category:'Management System', severity:'high' as const,
        description:`ISO 42001 management-system clause ${c}.`, automation_level:'hybrid' as const, evidence_source:'AIMS documentation',
      })),
      ...['A.2.2','A.2.3','A.2.4','A.3.2','A.3.3','A.4.2','A.4.3','A.4.4','A.4.5','A.4.6','A.5.2','A.5.3','A.5.4','A.5.5','A.6.1.2','A.6.1.3','A.6.2.2','A.6.2.3','A.6.2.4','A.6.2.5','A.6.2.6','A.6.2.7','A.6.2.8','A.7.2','A.7.3','A.7.4','A.7.5','A.7.6','A.8.2','A.8.3','A.8.4','A.9.2','A.9.3','A.9.4','A.10.2','A.10.3','A.10.4'].map(c => ({
        code:`Anx-${c}`, title:`Annex A ${c}`, category:'AI Controls', severity:'high' as const,
        description:`ISO 42001 Annex A control ${c}.`, automation_level:'auto' as const, evidence_source:'AI controls register',
      })),
    ],
  },
  {
    code: 'ISO-27001', name: 'ISO/IEC 27001:2022 — Information Security Management',
    jurisdiction: 'ALL', authority: 'ISO/IEC', version: '2022',
    category: 'security', effective_from: '2022-10-25',
    description: 'International standard for information security management systems.',
    references: ['https://www.iso.org/standard/27001'],
    controls: [
      ...['4.1','4.2','4.3','4.4','5.1','5.2','5.3','6.1.1','6.1.2','6.1.3','6.2','7.1','7.2','7.3','7.4','7.5','8.1','8.2','8.3','9.1','9.2','9.3','10.1','10.2'].map(c => ({
        code:`ISMS-${c}`, title:`ISMS Clause ${c}`, category:'Management System', severity:'high' as const,
        description:`ISO 27001 ${c}.`, automation_level:'hybrid' as const, evidence_source:'ISMS documentation',
      })),
      ...Array.from({length:37},(_,i)=>`A.5.${i+1}`).map(c => ({ code:c, title:`Annex A ${c}`, category:'A.5 Organisational', severity:'high' as const, description:`ISO 27001 Annex A — ${c}.`, automation_level:'hybrid' as const, evidence_source:'SoA + risk treatment' })),
      ...Array.from({length:8},(_,i)=>`A.6.${i+1}`).map(c => ({ code:c, title:`Annex A ${c}`, category:'A.6 People', severity:'medium' as const, description:`ISO 27001 Annex A — ${c}.`, automation_level:'manual' as const, evidence_source:'HR policies' })),
      ...Array.from({length:14},(_,i)=>`A.7.${i+1}`).map(c => ({ code:c, title:`Annex A ${c}`, category:'A.7 Physical', severity:'medium' as const, description:`ISO 27001 Annex A — ${c}.`, automation_level:'manual' as const, evidence_source:'AWS shared responsibility' })),
      ...Array.from({length:34},(_,i)=>`A.8.${i+1}`).map(c => ({ code:c, title:`Annex A ${c}`, category:'A.8 Technological', severity:'high' as const, description:`ISO 27001 Annex A — ${c}.`, automation_level:'auto' as const, evidence_source:'Technical controls evidence' })),
    ],
  },
  {
    code: 'ISO-27701', name: 'ISO/IEC 27701:2019 — Privacy Information Management',
    jurisdiction: 'ALL', authority: 'ISO/IEC', version: '2019',
    category: 'privacy', effective_from: '2019-08-06',
    description: 'PIMS extension to ISO 27001 for privacy information management.',
    references: ['https://www.iso.org/standard/71670.html'],
    controls: [
      ...['5.2.1','5.2.2','5.2.3','5.2.4','5.3.1','5.3.2','5.3.3','5.3.4','5.4.1','5.4.2','5.5.1','5.5.2','5.5.3','5.5.4','5.5.5','5.5.6','5.5.7','5.5.8','5.6.1','5.6.2','5.7.1','5.8.1'].map(c => ({
        code:`PIMS-${c}`, title:`Clause ${c}`, category:'PIMS', severity:'high' as const,
        description:`ISO 27701 ${c}.`, automation_level:'hybrid' as const, evidence_source:'PIMS documentation',
      })),
      ...[
        ['Anx-A.7.2','PII Controllers — Conditions for Collection'],
        ['Anx-A.7.3','PII Controllers — Obligations to PII Principals'],
        ['Anx-A.7.4','PII Controllers — Privacy by Design'],
        ['Anx-A.7.5','PII Controllers — Sharing & Transfer'],
        ['Anx-B.8.2','PII Processors — Conditions'],
        ['Anx-B.8.3','PII Processors — Obligations'],
        ['Anx-B.8.4','PII Processors — Privacy by Design'],
        ['Anx-B.8.5','PII Processors — Sharing & Transfer'],
      ].map(([c,t]) => ({ code:c, title:t, category:'PIMS Annex', severity:'high' as const, description:t, automation_level:'auto' as const, evidence_source:'DPA + Sub-processor list' })),
    ],
  },
];

async function seed() {
  console.log('  ── Seeding compliance frameworks + controls catalog ──');
  await assertColumns(sql, './jrx-seed-compliance-catalog', REQUIRED_COLUMNS);
  let totalControls = 0;

  for (const fw of FRAMEWORKS) {
    const ctlCount = fw.controls.length;
    totalControls += ctlCount;
    await sql`
      INSERT INTO nv_compliance_frameworks
        (framework_code, name, jurisdiction, authority, version, category, description,
         total_controls, active, effective_from, "references")
      VALUES
        (${fw.code}, ${fw.name}, ${fw.jurisdiction}, ${fw.authority}, ${fw.version}, ${fw.category},
         ${fw.description}, ${ctlCount}, TRUE, ${fw.effective_from}::date,
         ${JSON.stringify(fw.references)}::jsonb)
      ON CONFLICT (framework_code) DO UPDATE SET
        name           = EXCLUDED.name,
        version        = EXCLUDED.version,
        description    = EXCLUDED.description,
        total_controls = EXCLUDED.total_controls,
        "references"   = EXCLUDED."references",
        updated_at     = NOW()
    `;

    let order = 0;
    for (const ctl of fw.controls) {
      order += 1;
      await sql`
        INSERT INTO nv_compliance_controls
          (framework_code, control_code, title, category, severity, description,
           requirement_text, automation_level, evidence_source, default_status, sort_order)
        VALUES
          (${fw.code}, ${ctl.code}, ${ctl.title}, ${ctl.category ?? null}, ${ctl.severity},
           ${ctl.description}, ${ctl.requirement_text ?? null},
           ${ctl.automation_level ?? 'auto'}, ${ctl.evidence_source ?? null},
           'compliant', ${order})
        ON CONFLICT (framework_code, control_code) DO UPDATE SET
          title            = EXCLUDED.title,
          category         = EXCLUDED.category,
          severity         = EXCLUDED.severity,
          description      = EXCLUDED.description,
          requirement_text = EXCLUDED.requirement_text,
          automation_level = EXCLUDED.automation_level,
          evidence_source  = EXCLUDED.evidence_source,
          updated_at       = NOW()
      `;
    }
    console.log(`    ✓ ${fw.code.padEnd(15)} [${fw.jurisdiction}] ${ctlCount} controls`);
  }

  console.log(`  ✓ ${FRAMEWORKS.length} frameworks, ${totalControls} controls seeded`);
}

seed()
  .catch((err) => { console.error('Compliance catalog seed failed:', err); process.exit(1); })
  .finally(() => sql.end());
