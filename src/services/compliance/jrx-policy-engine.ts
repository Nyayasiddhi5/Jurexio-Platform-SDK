/**
 * Jurexio Policy Engine — task-298 (Demo G1B).
 *
 * One-shot bootstrap that:
 *   1. Ensures the four nv_policies* tables exist (mirrors
 *      scripts/migrations/2026-05-14-jrx-governance-tables.sql so a fresh
 *      Replit/Neon DB also gets them without running the full
 *      governance migration bundle).
 *   2. Seeds ≥ 12 jurisdiction-tagged policies covering the US (CCPA,
 *      HIPAA, FRCP 26, SOC2 CC6.1) and IN (DPDPA s.4-s.12, IT Act §43A,
 *      Bar Council Rule 36) demo surfaces if none of them are present.
 *   3. Backfills 7 days of realistic consent traffic across the demo
 *      US (org_id 1000-1099) and IN (org_id 1100-1199) tenants if the
 *      consent table is sparse.
 *
 * Idempotent — safe to call on every cold start.
 *
 * NV-NAMING-001: jrx- prefix.
 * NV-WIRING-001: invoked from src/index.ts startup (see below).
 */
import { sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('./jrx-policy-engine');

interface PolicySeed {
  code: string;
  name: string;
  category: string;
  jurisdiction: 'US' | 'IN' | 'ALL' | 'EU' | 'UK';
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'active' | 'draft' | 'superseded';
  owner: string;
  description: string;
  rules: string[];
  framework_refs: string[];
  body_md: string;
}

const DEMO_POLICIES: PolicySeed[] = [
  // ── US jurisdiction ─────────────────────────────────────────────────────
  {
    code: 'POL-US-CCPA-1798.100', name: 'CCPA §1798.100 — Consumer Right to Know',
    category: 'privacy', jurisdiction: 'US', severity: 'critical', status: 'active',
    owner: 'Privacy Office',
    description: 'Honour California consumer "right to know" requests within 45 days; disclose categories of PI collected, sources, business purpose, and third parties shared with.',
    rules: [
      'DSAR portal active at /api/jrx/consent/export',
      '45-day response SLA tracked in nv_audit_logs',
      'Verifiable consumer request pre-check before disclosure',
      'No sale/share of PI for opted-out consumers',
    ],
    framework_refs: ['CCPA-1798.100', 'CCPA-1798.105', 'CPRA-1798.130'],
    body_md: '# CCPA §1798.100\n\nCalifornia consumers may request access to PI collected in the prior 12 months. Jurexio routes the request through the canonical DSAR pipeline and replies within 45 days.',
  },
  {
    code: 'POL-US-HIPAA-164.502', name: 'HIPAA §164.502 — Minimum Necessary PHI Use',
    category: 'privacy', jurisdiction: 'US', severity: 'critical', status: 'active',
    owner: 'Privacy Office',
    description: 'Limit PHI use, disclosure, and request to the minimum necessary; PHI never leaves the PII-redaction ring before any LLM call.',
    rules: [
      'PII redactor strips PHI before any provider call (NV-ARCH-001)',
      'BAA required for every covered sub-processor',
      'Audit trail of PHI access in nv_audit_logs',
      'Encryption at rest (AES-256) + in transit (TLS 1.3)',
    ],
    framework_refs: ['HIPAA-164.502', 'HIPAA-164.514', 'HIPAA-164.312'],
    body_md: '# HIPAA §164.502 — Minimum Necessary\n\nApplies to JRX (US) deployments handling protected health information.',
  },
  {
    code: 'POL-US-FRCP-26', name: 'FRCP Rule 26 — Discovery Proportionality',
    category: 'legal-ethics', jurisdiction: 'US', severity: 'high', status: 'active',
    owner: 'Legal Ops',
    description: 'eDiscovery export pipelines respect FRCP 26(b)(1) proportionality; privilege & work-product detection runs before any production set leaves the platform.',
    rules: [
      'Privilege detector runs over every export batch',
      'Production sets logged with bates ranges + custodian list',
      'Proportionality memo generated per matter',
      'Sanctions-risk flag for incomplete preservation',
    ],
    framework_refs: ['FRCP-26', 'FRCP-37', 'EDRM-2024'],
    body_md: '# FRCP Rule 26\n\nDiscovery scope is bounded by the proportionality factors in 26(b)(1). The platform tags non-responsive and privileged documents before export.',
  },
  {
    code: 'POL-US-SOC2-CC6.1', name: 'SOC 2 CC6.1 — Logical Access Controls',
    category: 'security', jurisdiction: 'US', severity: 'critical', status: 'active',
    owner: 'Platform Security',
    description: 'Restrict logical access to information and system resources to authorised users; quarterly access review attested by org_admins.',
    rules: [
      '7-tier RBAC enforced (NV-AUTH-HEADER-001)',
      'MFA required for org_admin / super_admin / billing',
      'Quarterly access review cycle, evidence persisted',
      'Idle session revocation @ 30 minutes',
    ],
    framework_refs: ['SOC2-TSC:CC6.1', 'SOC2-TSC:CC6.6', 'ISO-27001:A.5.18'],
    body_md: '# SOC 2 CC6.1 — Logical Access\n\nRBAC + MFA + quarterly review form the access-control control loop.',
  },
  {
    code: 'POL-US-VCDPA-59.1.575', name: 'VCDPA §59.1-575 — Virginia Consumer Data Protection Act Rights',
    category: 'privacy', jurisdiction: 'US', severity: 'critical', status: 'active',
    owner: 'Privacy Office',
    description: 'Honour Virginia consumer rights (access, correction, deletion, portability, opt-out of targeted advertising/sale/profiling) within 45 days; data-protection assessment for high-risk processing per §59.1-580.',
    rules: [
      'DSAR portal supports access/correct/delete/port/opt-out for VA residents',
      '45-day response SLA with 45-day extension allowed once, tracked in nv_audit_logs',
      'Universal opt-out mechanism (GPC) honoured for sale + targeted advertising',
      'DPIA on file for processing of sensitive data, profiling, and targeted ads (§59.1-580)',
      'Authoritative appeal path to Virginia Office of the Attorney General published in privacy notice',
    ],
    framework_refs: ['VCDPA:§59.1-575', 'VCDPA:§59.1-577', 'VCDPA:§59.1-578', 'VCDPA:§59.1-580'],
    body_md: '# VCDPA §59.1-575 — Virginia Consumer Data Protection Act\n\nThe VCDPA grants Virginia residents access / correct / delete / portability / opt-out rights and requires data protection assessments. Jurexio routes Virginia DSARs through the canonical DSAR pipeline with a 45-day SLA, honours the Global Privacy Control as a universal opt-out, and publishes an appeal path to the Virginia OAG in the privacy notice.',
  },
  {
    code: 'POL-US-CPA-6-1-1306', name: 'CPA C.R.S. §6-1-1306 — Colorado Privacy Act Rights',
    category: 'privacy', jurisdiction: 'US', severity: 'critical', status: 'active',
    owner: 'Privacy Office',
    description: 'Honour Colorado consumer rights (access, correction, deletion, portability, opt-out of sale/targeted advertising/profiling) within 45 days; recognise the Colorado AG-approved universal opt-out mechanism.',
    rules: [
      'DSAR portal supports access/correct/delete/port/opt-out for CO residents',
      '45-day response SLA with 45-day extension allowed once, tracked in nv_audit_logs',
      'Honour CO AG-approved universal opt-out mechanisms (GPC) by 2024-07-01',
      'Data-protection assessment for high-risk processing (§6-1-1309)',
      'Privacy notice surfaces Colorado AG complaint route',
    ],
    framework_refs: ['CPA:C.R.S.§6-1-1306', 'CPA:§6-1-1308', 'CPA:§6-1-1309', 'CPA-Rules:Pt-5'],
    body_md: '# CPA C.R.S. §6-1-1306 — Colorado Privacy Act\n\nThe CPA grants Colorado residents the same access / correct / delete / portability / opt-out rights as the VCDPA, plus a CO AG-approved universal opt-out (the "Colorado UOOM list"). Jurexio recognises GPC, runs a data-protection assessment for any sensitive-data or profiling flow, and surfaces the Colorado OAG complaint route in the privacy notice.',
  },
  {
    code: 'POL-US-CTDPA-42.515', name: 'CTDPA C.G.S. §42-515 — Connecticut Data Privacy Act Rights',
    category: 'privacy', jurisdiction: 'US', severity: 'critical', status: 'active',
    owner: 'Privacy Office',
    description: 'Honour Connecticut consumer rights (access, correction, deletion, portability, opt-out of targeted advertising/sale/profiling) within 45 days; recognise universal opt-out mechanism (effective 2025-01-01); data-protection assessment for high-risk processing per C.G.S. §42-522.',
    rules: [
      'DSAR portal supports access/correct/delete/port/opt-out for CT residents',
      '45-day response SLA with 45-day extension allowed once, tracked in nv_audit_logs',
      'Universal opt-out mechanism (GPC) honoured for sale + targeted advertising (eff. 2025-01-01)',
      'DPIA on file for processing of sensitive data, profiling, and targeted ads (§42-522)',
      'Authoritative appeal path to Connecticut Office of the Attorney General published in privacy notice',
    ],
    framework_refs: ['CTDPA:C.G.S.§42-515', 'CTDPA:§42-518', 'CTDPA:§42-520', 'CTDPA:§42-522'],
    body_md: '# CTDPA C.G.S. §42-515 — Connecticut Data Privacy Act\n\nThe CTDPA grants Connecticut residents access / correct / delete / portability / opt-out rights and requires data protection assessments. Mirrors the VCDPA shape with a mandatory universal-opt-out recognition obligation phased in on 2025-01-01. Jurexio routes Connecticut DSARs through the canonical DSAR pipeline with a 45-day SLA, honours GPC, and publishes an appeal path to the Connecticut OAG in the privacy notice.',
  },
  {
    code: 'POL-US-UCPA-13-61-101', name: 'UCPA Utah Code §13-61-101 — Utah Consumer Privacy Act Rights',
    category: 'privacy', jurisdiction: 'US', severity: 'high', status: 'active',
    owner: 'Privacy Office',
    description: 'Honour Utah consumer rights (access, deletion, portability, opt-out of sale/targeted advertising) within 45 days; sensitive-data opt-in per §13-61-302; 30-day cure period before AG enforcement under §13-61-402. Note: UCPA does NOT grant a right to correct nor an opt-out-of-profiling, and has no DPA requirement — narrowest of the post-CCPA wave.',
    rules: [
      'DSAR portal supports access/delete/port/opt-out for UT residents (no correction right under UCPA)',
      '45-day response SLA with 45-day extension allowed once, tracked in nv_audit_logs',
      'Opt-in consent gate before processing sensitive data of UT residents (§13-61-302)',
      'No profiling-opt-out wired (UCPA does not grant one) — VCDPA/CPA path used for residents in those states',
      '30-day notice + cure window enforced before any Utah AG enforcement referral (§13-61-402)',
      'Authoritative appeal path to Utah Division of Consumer Protection published in privacy notice',
    ],
    framework_refs: ['UCPA:§13-61-101', 'UCPA:§13-61-201', 'UCPA:§13-61-302', 'UCPA:§13-61-402'],
    body_md: '# UCPA Utah Code §13-61-101 — Utah Consumer Privacy Act\n\nThe UCPA is the narrowest of the post-CCPA state privacy wave: no right to correct, no opt-out of profiling, no DPA requirement, and a statutory 30-day cure period before the Utah AG can refer enforcement to the Division of Consumer Protection. Jurexio honours the access / delete / port / sale-opt-out / targeted-ad-opt-out rights via the canonical DSAR pipeline and gates UT-resident sensitive-data processing on opt-in consent per §13-61-302.',
  },
  {
    code: 'POL-US-TDPSA-541.001', name: 'TDPSA Tex. Bus. & Com. Code §541.001 — Texas Data Privacy and Security Act Rights',
    category: 'privacy', jurisdiction: 'US', severity: 'critical', status: 'active',
    owner: 'Privacy Office',
    description: 'Honour Texas consumer rights (access, correction, deletion, portability, opt-out of targeted advertising/sale/profiling) within 45 days; recognise universal opt-out mechanism by 2025-01-01; data-protection assessment for high-risk processing per §541.105. Note: TDPSA has NO small-business carve-out — applicability is tied to "doing business in Texas" plus selling/processing personal data, so SMB customers are still in scope.',
    rules: [
      'DSAR portal supports access/correct/delete/port/opt-out for TX residents',
      '45-day response SLA with 45-day extension allowed once, tracked in nv_audit_logs',
      'Universal opt-out mechanism (GPC) honoured for sale + targeted advertising (eff. 2025-01-01)',
      'DPIA on file for processing of sensitive data, profiling, and targeted ads (§541.105)',
      'No SMB carve-out — tier gating must NOT exempt small Texas customers',
      'Authoritative appeal path to Texas Office of the Attorney General Consumer Protection Division published in privacy notice',
    ],
    framework_refs: ['TDPSA:§541.001', 'TDPSA:§541.051', 'TDPSA:§541.101', 'TDPSA:§541.105'],
    body_md: '# TDPSA Tex. Bus. & Com. Code §541.001 — Texas Data Privacy and Security Act\n\nIn force 2024-07-01. Mirrors VCDPA/CPA on rights and DPA, but applicability is uniquely broad: any entity that conducts business in Texas and processes/sells personal data is in scope, with no employee-headcount or revenue threshold. Jurexio routes Texas DSARs through the canonical DSAR pipeline with a 45-day SLA, honours GPC by the §541.055(b) deadline, and publishes an appeal path to the Texas OAG Consumer Protection Division in the privacy notice.',
  },
  {
    code: 'POL-US-OCPA-646A.570', name: 'OCPA Or. Rev. Stat. §646A.570 — Oregon Consumer Privacy Act Rights',
    category: 'privacy', jurisdiction: 'US', severity: 'critical', status: 'active',
    owner: 'Privacy Office',
    description: 'Honour Oregon consumer rights (access, correction, deletion, portability, opt-out of targeted advertising/sale/profiling, list of specific third parties to whom data was disclosed) within 45 days; recognise universal opt-out mechanism by 2026-01-01; data-protection assessment for high-risk processing per ORS §646A.578.',
    rules: [
      'DSAR portal supports access/correct/delete/port/opt-out for OR residents',
      'Right to obtain a list of specific third parties to whom personal data has been disclosed (§646A.574(1)(d))',
      '45-day response SLA with 45-day extension allowed once, tracked in nv_audit_logs',
      'Universal opt-out mechanism (GPC) honoured for sale + targeted advertising (eff. 2026-01-01)',
      'DPIA on file for processing of sensitive data, profiling, and targeted ads (§646A.578)',
      'Authoritative appeal path to Oregon Department of Justice Consumer Protection Section published in privacy notice',
    ],
    framework_refs: ['OCPA:ORS§646A.570', 'OCPA:§646A.574', 'OCPA:§646A.578', 'OCPA:§646A.583'],
    body_md: '# OCPA Or. Rev. Stat. §646A.570 — Oregon Consumer Privacy Act\n\nIn force 2024-07-01 (commercial entities) / 2025-07-01 (non-profits). Distinctive feature: the §646A.574(1)(d) right to a list of specific third parties to whom the controller has disclosed the consumer\'s personal data — broader than VCDPA/CPA which only require category-level disclosure. Jurexio routes Oregon DSARs through the canonical DSAR pipeline with a 45-day SLA, honours GPC on the OCPA-rule timeline, and publishes an appeal path to the Oregon DOJ Consumer Protection Section in the privacy notice.',
  },
  {
    code: 'POL-US-DEPDPA-12D', name: 'DE-PDPA 6 Del. C. Ch. 12D — Delaware Personal Data Privacy Act Rights',
    category: 'privacy', jurisdiction: 'US', severity: 'critical', status: 'active',
    owner: 'Privacy Office',
    // NOTE (NV-NAMING-001): code is `POL-US-DEPDPA-12D` (Delaware Personal
    // Data Privacy Act, 6 Del. C. Ch. 12D, in force 2025-01-01). Do NOT
    // confuse with the unrelated India `POL-IN-DPDPA-*` family
    // (Digital Personal Data Protection Act 2023). The two statutes share
    // the "DPDPA" abbreviation but are jurisdictionally and substantively
    // distinct — Delaware here is `US`, India seeds are `IN`.
    description: 'Honour Delaware consumer rights (access, correction, deletion, portability, opt-out of targeted advertising/sale/profiling, list of categories of third parties) within 45 days; recognise universal opt-out mechanism by 2026-01-01; data-protection assessment for high-risk processing per 6 Del. C. §12D-108.',
    rules: [
      'DSAR portal supports access/correct/delete/port/opt-out for DE residents',
      '45-day response SLA with 45-day extension allowed once, tracked in nv_audit_logs',
      'Universal opt-out mechanism (GPC) honoured for sale + targeted advertising (eff. 2026-01-01)',
      'DPIA on file for processing of sensitive data, profiling, and targeted ads (6 Del. C. §12D-108)',
      'Lower applicability threshold (35,000 DE-resident records) — must NOT be confused with India DPDPA seeds (POL-IN-DPDPA-*)',
      'Authoritative appeal path to Delaware Department of Justice Consumer Protection Unit published in privacy notice',
    ],
    framework_refs: ['DE-PDPA:6-Del.C.§12D-102', 'DE-PDPA:6-Del.C.§12D-104', 'DE-PDPA:6-Del.C.§12D-106', 'DE-PDPA:6-Del.C.§12D-108'],
    body_md: '# DE-PDPA 6 Del. C. Ch. 12D — Delaware Personal Data Privacy Act\n\nIn force 2025-01-01. **Disambiguation note**: this is the Delaware (US) statute and is unrelated to India\'s Digital Personal Data Protection Act 2023 (`POL-IN-DPDPA-*` seed family). Mirrors VCDPA/CPA on rights and DPA, with a notably lower applicability threshold (35,000 DE-resident records, or 10,000 records + 20% of revenue from data sale) so SMB customers operating in Delaware are routinely in scope. Jurexio routes Delaware DSARs through the canonical DSAR pipeline with a 45-day SLA, honours GPC on the DE-DOJ-rule timeline, and publishes an appeal path to the Delaware DOJ Consumer Protection Unit in the privacy notice.',
  },
  {
    code: 'POL-US-NYSHIELD-899-bb', name: 'NY SHIELD Act §899-bb — Reasonable Security + Breach Notification',
    category: 'security', jurisdiction: 'US', severity: 'critical', status: 'active',
    owner: 'Privacy Office',
    description: 'Implement a written information-security program with reasonable administrative, technical, and physical safeguards for the private information of New York residents (Stop Hacks and Improve Electronic Data Security Act, NY Gen Bus L §899-bb), and notify affected residents + the NY OAG / NYS Police / Dept of State without unreasonable delay following a breach (§899-aa).',
    rules: [
      'Designate ≥1 employee to coordinate the security program (§899-bb(2)(b)(ii)(A)(1))',
      'Risk-assessment of admin / technical / physical safeguards reviewed annually',
      'Vendor due-diligence with written security obligations for processors',
      'Breach notification to affected NY residents without unreasonable delay (§899-aa(2))',
      'Concurrent notice to NY OAG, NY Dept of State, NYS Police when >500 NY residents affected',
      'Substitute notice via email + website + statewide media when cost > $250k or class > 500k',
    ],
    framework_refs: ['NY-SHIELD:§899-bb', 'NY-SHIELD:§899-aa', 'NY-GBL:§899-bb(2)(b)(ii)'],
    body_md: '# NY SHIELD Act §899-bb — Stop Hacks and Improve Electronic Data Security\n\nApplies to any business that owns or licenses computerised data containing the private information of a New York resident. Jurexio runs a written information-security program covering the §899-bb(2)(b)(ii) admin / technical / physical control families, and the breach pipeline auto-files §899-aa notifications to affected residents plus the NY OAG, NY Department of State, and NY State Police whenever the affected NY-resident class exceeds the statutory threshold.',
  },
  {
    code: 'POL-US-GLBA-314.4', name: 'GLBA Safeguards Rule §314.4 — Information Security Program',
    category: 'security', jurisdiction: 'US', severity: 'critical', status: 'active',
    owner: 'Platform Security',
    description: 'Develop, implement, and maintain a comprehensive written information-security program containing administrative, technical, and physical safeguards for the customer information of any consumer of a "financial institution" customer (NSI / NSPM financial-services tenants) per the FTC Safeguards Rule, 16 C.F.R. §314.4 (revised 2023), including a designated Qualified Individual, a written risk assessment, access controls, encryption, multi-factor authentication, secure disposal, and oversight of service providers.',
    rules: [
      'Designate a Qualified Individual to oversee, implement, and enforce the program (§314.4(a))',
      'Written risk assessment refreshed periodically that re-examines reasonably foreseeable internal and external risks (§314.4(b))',
      'Access controls, encryption of customer information at rest + in transit, and multi-factor authentication for any individual accessing customer information (§314.4(c)(1)–(5))',
      'Secure disposal of customer information no later than two years after the last use unless retention is required (§314.4(c)(6))',
      'Continuous monitoring or annual penetration test + biannual vulnerability assessment (§314.4(d))',
      'Written incident-response plan covering detection, containment, eradication, recovery, and notification (§314.4(h))',
      'Service-provider due-diligence + written contract requirements obligating equivalent safeguards (§314.4(f))',
      'Annual written report from the Qualified Individual to the board / governing body (§314.4(i))',
    ],
    framework_refs: ['GLBA:15-USC-6801', 'FTC-SAFEGUARDS:16-CFR-314.4', 'FTC-SAFEGUARDS:16-CFR-314.4(c)', 'FTC-SAFEGUARDS:16-CFR-314.4(f)', 'FTC-SAFEGUARDS:16-CFR-314.4(h)', 'SOC2-TSC:CC6.1'],
    body_md: '# GLBA Safeguards Rule §314.4 — Information Security Program\n\nThe FTC Safeguards Rule (16 C.F.R. Part 314), revised in 2023, requires every "financial institution" subject to the FTC\'s jurisdiction under the Gramm-Leach-Bliley Act (15 U.S.C. §6801) to maintain a written information-security program with the elements enumerated in §314.4. Jurexio is a service provider to financial-institution customers (NSI, NSPM); this policy carries the §314.4(f) service-provider obligations through to our own administrative, technical, and physical safeguards. Platform Security is the named Qualified Individual; the canonical risk register is reviewed at least annually; access controls, encryption, MFA, secure disposal, and continuous monitoring are inherited from the SOC 2 CC6.1 control loop and the IronLedger audit hash chain.',
  },
  {
    code: 'POL-US-GLBA-314.5', name: 'GLBA Safeguards Rule §314.5 — Notification of a Security Event',
    category: 'security', jurisdiction: 'US', severity: 'critical', status: 'active',
    owner: 'Privacy Office',
    description: 'Notify the Federal Trade Commission electronically as soon as possible, and no later than 30 days after discovery, of any "notification event" involving the unencrypted customer information of 500 or more consumers per 16 C.F.R. §314.5 (effective 2024-05-13). The notice must identify the institution, describe the event, the type of information involved, the date(s) of the event, the number of consumers affected, and any law-enforcement deferral.',
    rules: [
      'Discovery clock starts when the institution knows or reasonably should know the event has occurred (§314.5(a))',
      'Electronic notice via the FTC notification form on FTC.gov no later than 30 days after discovery (§314.5(a))',
      'Notice content: institution name, contact, description of event, types of information, date(s), number of consumers affected, law-enforcement deferral if any (§314.5(b))',
      'Encryption carve-out: notification not required if information is encrypted AND the encryption key was not accessed or acquired (§314.2(m), definition of "notification event")',
      'Law-enforcement deferral honoured when written request received from a federal, state, local, or foreign law-enforcement agency (§314.5(c))',
      'Filing logged to nv_audit_logs via appendAuditRecord and CAM action raised on the Compliance owner queue',
    ],
    framework_refs: ['GLBA:15-USC-6801', 'FTC-SAFEGUARDS:16-CFR-314.5', 'FTC-SAFEGUARDS:16-CFR-314.5(a)', 'FTC-SAFEGUARDS:16-CFR-314.5(b)', 'FTC-SAFEGUARDS:16-CFR-314.2(m)'],
    body_md: '# GLBA Safeguards Rule §314.5 — Notification of a Security Event\n\nUnder the 2023 amendments (effective 2024-05-13), the FTC Safeguards Rule requires non-banking financial institutions to file an electronic notification with the FTC of any security event involving the unencrypted customer information of 500 or more consumers, no later than 30 days after discovery. The Jurexio breach pipeline (`src/services/compliance/jrx-breach-notice-service.ts`) carries an `FTC` recipient block keyed to this policy code; when a filed incident\'s aggregate affected-consumer count crosses the 500-consumer threshold and the encryption carve-out does not apply, an FTC notice draft is generated, queued for delivery to the FTC notification form, paired with a CAM action on the Compliance owner queue, and appended to the audit hash chain so the §314.5 evidence trail reconstructs deterministically.',
  },
  {
    code: 'POL-US-BIPA-740-14-15', name: 'IL BIPA 740 ILCS 14/15 — Biometric Information Privacy Act',
    category: 'privacy', jurisdiction: 'US', severity: 'critical', status: 'active',
    owner: 'Privacy Office',
    description: 'Obtain prior written informed consent before collecting, capturing, or storing the biometric identifiers (fingerprints, voiceprints, facial geometry, iris/retina scans) of an Illinois resident, publish a written retention + destruction schedule, and prohibit sale or profit from biometric data per the Illinois Biometric Information Privacy Act (740 ILCS 14).',
    rules: [
      'Written, informed consent captured before any biometric collection (§15(b))',
      'Public retention + destruction schedule, max 3 years post-last-interaction or purpose-end (§15(a))',
      'No sale, lease, trade, or profit from biometric identifiers / information (§15(c))',
      'Disclosure only with consent, legal compulsion, or contract necessity (§15(d))',
      'Reasonable standard-of-care safeguards equal to those for other confidential data (§15(e))',
      'Private right of action surface — every violation is auditable per Cothron v. White Castle',
    ],
    framework_refs: ['BIPA:740-ILCS-14/15(a)', 'BIPA:740-ILCS-14/15(b)', 'BIPA:740-ILCS-14/15(c)', 'BIPA:740-ILCS-14/15(d)', 'BIPA:740-ILCS-14/15(e)'],
    body_md: '# IL BIPA 740 ILCS 14/15 — Biometric Information Privacy Act\n\nJurexio does not collect biometric identifiers in the standard NSP / NYM flows, but tenants that enable voice-print or facial-geometry features must surface the §15(b) consent gate before capture. The retention schedule is published in the privacy notice and enforced by the canonical retention worker; the no-sale prohibition is wired into the data-export filter; every collection / disclosure event is logged so the §20 private right of action can be reconstructed per Cothron v. White Castle (per-scan accrual).',
  },
  {
    code: 'POL-US-MA201CMR17-03', name: 'MA 201 CMR 17.03 — Comprehensive Written Information Security Program (WISP)',
    category: 'security', jurisdiction: 'US', severity: 'critical', status: 'active',
    owner: 'Platform Security',
    description: 'Develop, implement, and maintain a comprehensive written information-security program (WISP) containing administrative, technical, and physical safeguards for the personal information of any Massachusetts resident, per 201 CMR 17.03–17.04 and the breach-notification regime at M.G.L. c.93H §3.',
    rules: [
      'Designated WISP owner + risk assessment refreshed at least annually (17.03(2)(a)–(b))',
      'Encryption of all PI on portable devices and in transit across public networks (17.04(3),(5))',
      'Access controls, secure user-ID / authentication protocols, and least-privilege (17.04(1)–(2))',
      'Up-to-date firewall + system-security-agent + monitoring on systems holding PI (17.04(6)–(7))',
      'Written third-party service-provider obligations to protect MA PI (17.03(2)(f))',
      'Notice to MA OCABR, MA AG, and affected residents per M.G.L. c.93H §3 within statutory deadline',
    ],
    framework_refs: ['MA-201-CMR-17:17.03', 'MA-201-CMR-17:17.04', 'MGL-c.93H:§3', 'MGL-c.93H:§1'],
    body_md: '# MA 201 CMR 17.03 — Standards for the Protection of Personal Information of Residents of the Commonwealth\n\nThe Massachusetts safeguards regulation requires every business that owns or licenses PI of a MA resident to maintain a Written Information Security Program (WISP). Jurexio maintains the WISP under Platform Security ownership, encrypts MA-resident PI on portable devices + in transit per 17.04(3)/(5), enforces the 17.04(1)/(2) access-control + authentication baseline, and the breach pipeline routes M.G.L. c.93H §3 notifications to the MA Office of Consumer Affairs and Business Regulation (OCABR), the MA Attorney General, and affected MA residents.',
  },
  {
    code: 'POL-US-FEDRAMP-MOD', name: 'FedRAMP Moderate — NIST 800-53 Rev 5 Baseline',
    category: 'security', jurisdiction: 'US', severity: 'critical', status: 'active',
    owner: 'Platform Security',
    description: 'Implement and continuously monitor the FedRAMP Moderate baseline (NIST SP 800-53 Rev 5 Moderate-impact controls) for federal-tenant deployments; annual 3PAO assessment and monthly continuous-monitoring submission to the FedRAMP PMO.',
    rules: [
      'NIST 800-53 Rev 5 Moderate baseline controls implemented (AC, AU, CM, CP, IA, IR, RA, SC, SI families)',
      'FIPS 140-3 validated cryptographic modules for data at rest + in transit',
      'Annual 3PAO security assessment; ATO package on file with sponsoring agency',
      'Monthly continuous-monitoring deliverables (POA&M, vulnerability scans, inventory) to FedRAMP PMO',
      'Significant-change request gating: any boundary change > 30 days notice to PMO',
      'US-person personnel + US-located data residency for federal tenants',
    ],
    framework_refs: ['FedRAMP:Moderate', 'NIST-800-53r5:AC-2', 'NIST-800-53r5:AU-2', 'NIST-800-53r5:CM-3', 'NIST-800-53r5:CP-9', 'NIST-800-53r5:IA-2', 'NIST-800-53r5:IR-4', 'NIST-800-53r5:SC-13', 'FIPS-140-3'],
    body_md: '# FedRAMP Moderate — NIST 800-53 Rev 5 Baseline\n\nApplies to deployments serving US federal tenants. The Moderate baseline covers ~325 controls across 17 families. Jurexio maintains the SSP, SAP, SAR, and POA&M as the authoritative ATO package; an accredited 3PAO assesses annually; the FedRAMP PMO receives monthly ConMon deliverables. FIPS 140-3 validated modules are mandatory for cryptography, US-person staffing and US-located data residency are enforced for the federal boundary.',
  },
  {
    code: 'POL-US-ABA-MR-1.6', name: 'ABA Model Rule 1.6 — Confidentiality',
    category: 'legal-ethics', jurisdiction: 'US', severity: 'critical', status: 'active',
    owner: 'AI Safety',
    description: 'Lawyer must make reasonable efforts to prevent inadvertent or unauthorised disclosure of client information; AI use disclosed per ABA Op 512.',
    rules: [
      'Client confidentiality preserved across LLM provider calls (PII redaction)',
      'Generative AI usage disclosed to client where materially relied upon',
      'No training of provider models on client data (zero-retention contracts)',
    ],
    framework_refs: ['ABA-MR:1.6', 'ABA-MR:5.3', 'ABA-512'],
    body_md: '# ABA MR 1.6\n\nApplies to JRX (US) clients and US-state-bar holders using NSP / NSI.',
  },
  {
    code: 'POL-US-NIST-AI-RMF', name: 'NIST AI RMF 1.0 — AI Risk Management Framework (Govern / Map / Measure / Manage)',
    category: 'ai-governance', jurisdiction: 'US', severity: 'high', status: 'active',
    owner: 'AI Safety',
    description: 'Declarative mapping of Jurexio AI governance to the four Functions of the NIST AI Risk Management Framework 1.0 (NIST AI 100-1, January 2023). All four Functions are implemented today via the safety pipeline (`src/services/safety-pipeline.ts`), HITL decision-card gates, the bias-checker, the PII-redaction ring, the jurisdiction-binding middleware, and the tamper-evident audit hash chain. This policy is mapping/declaration only — no new enforcement code is introduced; it cross-references existing controls so AI-procurement RFPs (NSM, NSI, NSP) can answer the AI RMF questionnaire item by item.',
    rules: [
      'GOVERN — Two-tier safety ring (NV-ARCH-001) + 13 CI-enforced NV-* hard guardrails + AI Safety policy ownership are the GV.1/GV.2/GV.3 culture, accountability, and policy controls; quarterly safety-policy review is logged in nv_audit_logs.',
      'MAP — Jurisdiction-binding middleware (`src/middleware/jrx-jurisdiction-binding-middleware.ts`) plus the agent registry (`config/agent-registries/Jurexio-Legal-registry-US.json`) classify every request by jurisdiction, matter type, regulator, and statute envelope, satisfying MP.1 (context establishment) / MP.2 (categorization) / MP.3 (AI capabilities & risks) / MP.5 (impacts to individuals).',
      'MEASURE — Safety pipeline (`src/services/safety-pipeline.ts`) runs bias detection, hallucination scoring, jailbreak detection, prompt-injection detection, and toxicity scoring on every output; metrics persisted to `nv_audit_logs` and `nv_compliance_evidence`. Satisfies MS.1 (appropriate methods identified) / MS.2 (evaluation) / MS.3 (risk-tracking) / MS.4 (feedback).',
      'MANAGE — HITL decision-card queue (`nv_hitl_queue` + `nv_hitl_decisions`) gates high-risk outputs to a licensed human reviewer; rate-limiting + per-tier concurrency + circuit-breakers throttle live risk; the audit hash chain provides incident-response evidence. Satisfies MG.1 (risk prioritization) / MG.2 (treatment) / MG.3 (third-party risk) / MG.4 (improvement & response).',
      'No-bypass safety ring (NV-ARCH-001 + NV-LLM-001) means every model call traverses the same control loop — no hidden GenAI surface escapes the AI RMF mapping.',
    ],
    framework_refs: [
      'NIST-AI-100-1:GV.1', 'NIST-AI-100-1:GV.2', 'NIST-AI-100-1:GV.3', 'NIST-AI-100-1:GV.4',
      'NIST-AI-100-1:MP.1', 'NIST-AI-100-1:MP.2', 'NIST-AI-100-1:MP.3', 'NIST-AI-100-1:MP.5',
      'NIST-AI-100-1:MS.1', 'NIST-AI-100-1:MS.2', 'NIST-AI-100-1:MS.3', 'NIST-AI-100-1:MS.4',
      'NIST-AI-100-1:MG.1', 'NIST-AI-100-1:MG.2', 'NIST-AI-100-1:MG.3', 'NIST-AI-100-1:MG.4',
      'NV-ARCH-001', 'NV-LLM-001',
    ],
    body_md: '# NIST AI RMF 1.0 — AI Risk Management Framework\n\nThe NIST AI Risk Management Framework 1.0 (NIST AI 100-1, January 2023) organises trustworthy-AI controls under four Functions: **Govern · Map · Measure · Manage**. Jurexio already implements the operational controls — the safety pipeline (`src/services/safety-pipeline.ts`) runs bias / hallucination / jailbreak / prompt-injection / toxicity scoring on every output; the HITL decision-card queue (`nv_hitl_queue` + `nv_hitl_decisions`) routes high-risk outputs to a licensed human reviewer; the jurisdiction-binding middleware (`src/middleware/jrx-jurisdiction-binding-middleware.ts`) classifies context, regulator, and statute envelope per request; the no-bypass two-tier safety ring (NV-ARCH-001 + NV-LLM-001) ensures no model call escapes the loop; the tamper-evident audit hash chain (`appendAuditRecord` in `src/middleware/jrx-sdk-tracking-middleware.ts`) provides the incident-evidence trail. This policy declares the mapping so that AI-procurement RFPs (NSM, NSI, NSP) and AI-questionnaire add-ons to SOC 2 / ISO 27001 audits can answer the AI RMF item by item.',
  },
  {
    code: 'POL-US-NIST-CSF-2', name: 'NIST CSF 2.0 — Cybersecurity Framework (Govern / Identify / Protect / Detect / Respond / Recover)',
    category: 'security', jurisdiction: 'US', severity: 'high', status: 'active',
    owner: 'Platform Security',
    description: 'Declarative mapping of the Jurexio security posture to the six Functions of NIST Cybersecurity Framework 2.0 (NIST CSWP 29, February 2024). All six Functions are covered today via the controls already declared on `POL-US-FEDRAMP-MOD` (NIST 800-53 Rev 5 Moderate baseline) and `POL-US-SOC2-CC6.1` (logical access + audit hash chain), plus the multi-tenant RLS topology, FIPS 140-3 modules, the breach-notification pipeline, and RDS PITR backups. This policy is mapping/declaration only — no new enforcement code is introduced; it cross-references existing FedRAMP Moderate and SOC 2 CC6.1 controls under each CSF Function so procurement teams can answer the CSF 2.0 self-assessment without parsing the underlying 800-53 family list.',
    rules: [
      'GV (Govern, new in 2.0) — AI Safety + Platform Security own the policy stack; 13 CI-enforced NV-* hard guardrails + the audit hash chain operationalise GV.OC (organizational context), GV.RM (risk management strategy), GV.SC (supply-chain risk for the 6 LLM providers), GV.RR (roles & responsibilities), GV.OV (oversight). Cross-ref: POL-US-FEDRAMP-MOD framework_refs lines 178-192.',
      'ID (Identify) — DB schema (`src/db/schema.ts`) + agent registries (`config/agent-registries/`) + master config (`src/config/jrx-master-config.ts`) constitute the asset inventory; the gap-analysis doc (`docs/canonical/16-us-compliance-gap-analysis-2026-05-14.md`) is the risk register. Maps to ID.AM, ID.RA, ID.IM. Cross-ref: NIST-800-53r5:CM-8 on POL-US-FEDRAMP-MOD.',
      'PR (Protect) — Multi-tenant RLS topology (`drizzle/0013_customer_org_rls.sql` + `src/middleware/jrx-org-rls-middleware.ts`) + 7-tier RBAC + MFA + AES-256 at rest + TLS 1.3 + FIPS 140-3 modules. Maps to PR.AA (identity & access), PR.DS (data security), PR.PS (platform security), PR.IR (technology infrastructure resilience). Cross-ref: POL-US-SOC2-CC6.1 (lines 86-98) + POL-US-FEDRAMP-MOD (lines 178-192).',
      'DE (Detect) — Safety pipeline + regulatory-monitor sweeps (`src/services/regulatory-monitor/regulatory-monitor-service.ts`) + audit hash chain anomaly detection + per-tier rate-limit + circuit-breakers. Maps to DE.CM (continuous monitoring), DE.AE (adverse events). Cross-ref: NIST-800-53r5:AU-2 + SI family on POL-US-FEDRAMP-MOD.',
      'RS (Respond) — Breach-notification pipeline (`src/services/compliance/jrx-breach-notice-service.ts`, NY/MA recipient sets), HITL decision-card queue, incident-response runbook in `docs/canonical/EC2-DEVOPS-SOP-2026-05-14.md`. Maps to RS.MA (incident management), RS.AN (analysis), RS.CO (communication), RS.MI (mitigation). Cross-ref: NIST-800-53r5:IR-4 on POL-US-FEDRAMP-MOD.',
      'RC (Recover) — RDS PITR + image-pin rollback procedure (`docs/canonical/EC2-DEVOPS-SOP-2026-05-14.md`) + Drizzle migration journal + audit hash chain replay. Maps to RC.RP (recovery plan), RC.CO (communication). Cross-ref: NIST-800-53r5:CP-9 on POL-US-FEDRAMP-MOD.',
    ],
    framework_refs: [
      'NIST-CSF-2.0:GV.OC', 'NIST-CSF-2.0:GV.RM', 'NIST-CSF-2.0:GV.SC', 'NIST-CSF-2.0:GV.RR', 'NIST-CSF-2.0:GV.OV',
      'NIST-CSF-2.0:ID.AM', 'NIST-CSF-2.0:ID.RA', 'NIST-CSF-2.0:ID.IM',
      'NIST-CSF-2.0:PR.AA', 'NIST-CSF-2.0:PR.DS', 'NIST-CSF-2.0:PR.PS', 'NIST-CSF-2.0:PR.IR',
      'NIST-CSF-2.0:DE.CM', 'NIST-CSF-2.0:DE.AE',
      'NIST-CSF-2.0:RS.MA', 'NIST-CSF-2.0:RS.AN', 'NIST-CSF-2.0:RS.CO', 'NIST-CSF-2.0:RS.MI',
      'NIST-CSF-2.0:RC.RP', 'NIST-CSF-2.0:RC.CO',
      'POL-US-FEDRAMP-MOD', 'POL-US-SOC2-CC6.1',
    ],
    body_md: '# NIST CSF 2.0 — Cybersecurity Framework\n\nThe NIST Cybersecurity Framework 2.0 (NIST CSWP 29, February 2024) reorganises the original five Functions and adds a sixth — **Govern · Identify · Protect · Detect · Respond · Recover**. The Govern Function is new in 2.0 and explicitly carries supply-chain risk (GV.SC) and organizational risk strategy (GV.RM). Jurexio already implements every Function: governance through the AI-Safety + Platform-Security policy stack and the 13 CI-enforced NV-* hard guardrails; identification through the DB schema, agent registries, and gap-analysis risk register; protection through multi-tenant RLS, 7-tier RBAC, MFA, AES-256 + TLS 1.3, and FIPS 140-3 modules; detection through the safety pipeline, regulatory-monitor sweeps, and audit hash chain anomaly checks; response through the breach-notification pipeline, HITL decision cards, and incident runbook; recovery through RDS PITR, image-pin rollback, and the Drizzle migration journal. This policy declares the mapping so customer security questionnaires that ask for "CSF 2.0 alignment" can be answered without re-deriving the FedRAMP Moderate (`POL-US-FEDRAMP-MOD`) and SOC 2 CC6.1 (`POL-US-SOC2-CC6.1`) control evidence trail from scratch.',
  },
  // ── IN jurisdiction ─────────────────────────────────────────────────────
  {
    code: 'POL-IN-DPDPA-S4', name: 'DPDPA §4 — Lawful Basis for Processing',
    category: 'privacy', jurisdiction: 'IN', severity: 'critical', status: 'active',
    owner: 'Privacy Office',
    description: 'Process personal data only for a lawful purpose with the explicit consent of the Data Principal, or a recognised legitimate use under §7.',
    rules: [
      'Consent gate (task-217) writes a CAM row on every breach',
      'Purpose-specific consent record persisted in nv_consent_records',
      'Consent withdrawal honoured within 24h',
    ],
    framework_refs: ['DPDPA:s.4', 'DPDPA:s.5', 'DPDPA:s.7'],
    body_md: '# DPDPA §4\n\nLawful basis is the cornerstone — every personal data flow on the platform must map to consent or a §7 legitimate use.',
  },
  {
    code: 'POL-IN-DPDPA-S6', name: 'DPDPA §6 — Notice & Consent Quality',
    category: 'privacy', jurisdiction: 'IN', severity: 'critical', status: 'active',
    owner: 'Privacy Office',
    description: 'Notice given to the Data Principal must be clear, in plain language, and itemise every purpose; consent must be free, specific, informed, unconditional, unambiguous.',
    rules: [
      'Consent UI is purpose-itemised (no bundled toggles)',
      'Notice available in 22 scheduled languages (Sarvam-translated)',
      'Granular withdraw flow at /api/jrx/consent/withdraw',
    ],
    framework_refs: ['DPDPA:s.6', 'DPDPA:s.5(2)'],
    body_md: '# DPDPA §6\n\nNotice precedes consent. Both are auditable and replayable.',
  },
  {
    code: 'POL-IN-DPDPA-S8', name: 'DPDPA §8 — Data Fiduciary Obligations',
    category: 'privacy', jurisdiction: 'IN', severity: 'high', status: 'active',
    owner: 'Privacy Office',
    description: 'Maintain accuracy, completeness, and consistency of personal data; implement reasonable security safeguards; report personal data breach to Board within 72h.',
    rules: [
      'Reasonable security: AES-256 at rest, TLS 1.3 in transit',
      'Breach notification SLA: 72h to Data Protection Board',
      'DPO contactable at dpo@jurexio.example',
    ],
    framework_refs: ['DPDPA:s.8', 'DPDPA:s.10'],
    body_md: '# DPDPA §8\n\nFiduciary obligations cover security, accuracy, and breach response.',
  },
  {
    code: 'POL-IN-DPDPA-S11', name: 'DPDPA §11 — Right of Access & Erasure',
    category: 'privacy', jurisdiction: 'IN', severity: 'high', status: 'active',
    owner: 'Privacy Office',
    description: 'Honour Data Principal rights of access, correction, completion, updation, and erasure within 30 days.',
    rules: [
      'Access endpoint: /api/jrx/consent/export',
      'Erasure endpoint: /api/jrx/consent/delete-my-data',
      '30-day SLA tracked',
    ],
    framework_refs: ['DPDPA:s.11', 'DPDPA:s.12'],
    body_md: '# DPDPA §11\n\nAccess, correction, and erasure flows are exposed via the canonical consent API.',
  },
  {
    code: 'POL-IN-DPDPA-S12', name: 'DPDPA §12 — Grievance Redressal',
    category: 'privacy', jurisdiction: 'IN', severity: 'medium', status: 'active',
    owner: 'Privacy Office',
    description: 'Provide a readily-available grievance redressal mechanism for the Data Principal; respond within prescribed timelines.',
    rules: [
      'Grievance form linked from every Data Principal touchpoint',
      'Redressal SLA: 7 days first response, 30 days resolution',
      'Escalation path to DPO and Data Protection Board',
    ],
    framework_refs: ['DPDPA:s.12', 'DPDPA:s.13'],
    body_md: '# DPDPA §12\n\nGrievance is the user-visible safety valve; SLAs are tracked in nv_audit_logs.',
  },
  {
    code: 'POL-IN-IT-43A', name: 'IT Act §43A + SPDI Rules — Sensitive Personal Data',
    category: 'security', jurisdiction: 'IN', severity: 'high', status: 'active',
    owner: 'Platform Security',
    description: 'Implement reasonable security practices and procedures (ISO 27001 / equivalent) for sensitive personal data; compensation liability for negligence.',
    rules: [
      'ISO 27001 control mapping in nv_compliance_evidence',
      'SPDI rule 4 privacy policy published',
      'Annual audit by independent auditor',
    ],
    framework_refs: ['IT-Act:43A', 'SPDI-Rules-2011'],
    body_md: '# IT Act §43A\n\nJurexio runs ISO 27001-aligned controls to discharge §43A "reasonable security" obligations.',
  },
  {
    code: 'POL-IN-BCI-RULE-36', name: 'Bar Council Rule 36 — Advertisement & Solicitation',
    category: 'legal-ethics', jurisdiction: 'IN', severity: 'high', status: 'active',
    owner: 'AI Safety',
    description: 'Indian advocates must not solicit work or advertise; AI-driven citizen-facing surfaces (NYM) include "informational, not legal advice" disclaimer and no solicitation.',
    rules: [
      'NYM responses footer: "informational, not legal advice"',
      'No firm-name promotion on NYM citizen surfaces',
      'Lawyer-locator widget routes to advocates voluntarily listed',
    ],
    framework_refs: ['BCI-IT:Rule-36', 'BCI-IT:Rule-37'],
    body_md: '# Bar Council Rule 36\n\nApplies to NYM and any consumer-facing surface in India.',
  },
  {
    code: 'POL-IN-RBI-DLG', name: 'RBI Digital Lending Guidelines — Loan Document Workflows',
    category: 'data', jurisdiction: 'IN', severity: 'medium', status: 'draft',
    owner: 'Compliance',
    description: 'Loan agreements processed via NSI must comply with RBI Digital Lending Guidelines 2022; KFS issued; cooling-off respected.',
    rules: [
      'Key Fact Statement template surfaced before signing',
      'Cooling-off period enforced (3 business days)',
      'No dark-pattern disclosures',
    ],
    framework_refs: ['RBI-DLG-2022'],
    body_md: '# RBI DLG\n\nDraft policy; awaiting Compliance review for 2026-Q3 activation.',
  },
];

const DPDPA_PRINCIPLES = [
  { code: 'P1', name: 'Lawful, Fair & Transparent', controlPolicy: 'POL-IN-DPDPA-S4',  status: 'compliant' as const },
  { code: 'P2', name: 'Purpose Limitation',          controlPolicy: 'POL-IN-DPDPA-S6',  status: 'compliant' as const },
  { code: 'P3', name: 'Data Minimisation',           controlPolicy: 'POL-IN-DPDPA-S8',  status: 'partial'   as const },
  { code: 'P4', name: 'Accuracy',                    controlPolicy: 'POL-IN-DPDPA-S8',  status: 'compliant' as const },
  { code: 'P5', name: 'Storage Limitation',          controlPolicy: 'POL-IN-DPDPA-S8',  status: 'partial'   as const },
  { code: 'P6', name: 'Integrity & Confidentiality', controlPolicy: 'POL-IN-IT-43A',    status: 'compliant' as const },
  { code: 'P7', name: 'Accountability',              controlPolicy: 'POL-IN-DPDPA-S8',  status: 'compliant' as const },
  { code: 'P8', name: 'Data Principal Rights',       controlPolicy: 'POL-IN-DPDPA-S11', status: 'compliant' as const },
  { code: 'P9', name: 'Grievance Redressal',         controlPolicy: 'POL-IN-DPDPA-S12', status: 'compliant' as const },
];

const CONSENT_PURPOSES = [
  'ai_processing',
  'document_storage',
  'biometric',
  'third_party_sharing',
  'analytics',
  'legal_research',
] as const;

let _bootstrapped = false;

/** NV-SCHEMA-ENSURE-001: skip DDL when prod migrations already applied (nv_app lacks CREATE). */
async function policyEngineTablesReady(): Promise<boolean> {
  if (!db) return false;
  try {
    await db.execute(sql`SELECT 1 FROM nv_policies LIMIT 1`);
    await db.execute(sql`SELECT 1 FROM nv_schema.nv_consent_records LIMIT 1`);
    return true;
  } catch {
    return false;
  }
}

async function ensureTables(): Promise<void> {
  if (!db) return;
  if (await policyEngineTablesReady()) return;
  try {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS nv_policies (
      id              SERIAL PRIMARY KEY,
      org_id          INTEGER     NOT NULL DEFAULT 1,
      policy_code     VARCHAR(80) NOT NULL,
      name            VARCHAR(255) NOT NULL,
      category        VARCHAR(60),
      jurisdiction    VARCHAR(10),
      severity        VARCHAR(20)  NOT NULL DEFAULT 'medium',
      status          VARCHAR(20)  NOT NULL DEFAULT 'active',
      owner_team      VARCHAR(120),
      description     TEXT,
      rules           JSONB        NOT NULL DEFAULT '[]'::jsonb,
      current_version VARCHAR(20)  NOT NULL DEFAULT '1.0.0',
      effective_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      review_at       TIMESTAMPTZ,
      framework_refs  JSONB        NOT NULL DEFAULT '[]'::jsonb,
      metadata        JSONB        NOT NULL DEFAULT '{}'::jsonb,
      last_enforced_at TIMESTAMPTZ,
      created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      UNIQUE(org_id, policy_code)
    )
  `);
  await db.execute(sql`ALTER TABLE nv_policies ADD COLUMN IF NOT EXISTS last_enforced_at TIMESTAMPTZ`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS nv_policies_jur_idx ON nv_policies(jurisdiction)`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS nv_policy_versions (
      id            SERIAL PRIMARY KEY,
      policy_id     INTEGER     NOT NULL,
      version       VARCHAR(20) NOT NULL,
      body_md       TEXT,
      changelog     TEXT,
      published_by  VARCHAR(120),
      published_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(policy_id, version)
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS nv_policy_assignments (
      id            SERIAL PRIMARY KEY,
      policy_id     INTEGER     NOT NULL,
      scope_type    VARCHAR(40) NOT NULL,
      scope_value   VARCHAR(120) NOT NULL,
      assigned_by   VARCHAR(120),
      assigned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ack_required  BOOLEAN     NOT NULL DEFAULT FALSE,
      ack_count     INTEGER     NOT NULL DEFAULT 0,
      UNIQUE(policy_id, scope_type, scope_value)
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS nv_policy_violations (
      id              BIGSERIAL PRIMARY KEY,
      policy_id       INTEGER     NOT NULL,
      org_id          INTEGER     NOT NULL DEFAULT 1,
      severity        VARCHAR(20) NOT NULL DEFAULT 'medium',
      source          VARCHAR(60),
      request_id      VARCHAR(120),
      user_ref        VARCHAR(120),
      description     TEXT,
      detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status          VARCHAR(30) NOT NULL DEFAULT 'open',
      resolution_notes TEXT,
      metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS nv_policy_violations_policy_idx ON nv_policy_violations(policy_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS nv_policy_violations_detected_idx ON nv_policy_violations(detected_at DESC)`);
  await db.execute(sql`
    CREATE SCHEMA IF NOT EXISTS nv_schema;
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS nv_schema.nv_consent_records (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id         TEXT NOT NULL,
      org_id          TEXT,
      purpose         TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'granted',
      jurisdiction    TEXT NOT NULL DEFAULT 'IN',
      granted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      withdrawn_at    TIMESTAMPTZ,
      expires_at      TIMESTAMPTZ,
      consent_version TEXT NOT NULL,
      legal_basis     TEXT NOT NULL,
      ip_address      TEXT,
      user_agent      TEXT,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      -- task-298 review-fix: must match consent-management-service exactly so
      -- its ON CONFLICT (user_id, purpose, consent_version) upserts succeed.
      UNIQUE(user_id, purpose, consent_version)
    )
  `);
  // Backfill the unique constraint on pre-existing DBs that were created
  // before this column was added (idempotent: NO-OP if it already exists).
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'nv_consent_records_user_id_purpose_consent_version_key'
      ) THEN
        BEGIN
          ALTER TABLE nv_schema.nv_consent_records
            ADD CONSTRAINT nv_consent_records_user_id_purpose_consent_version_key
            UNIQUE (user_id, purpose, consent_version);
        EXCEPTION WHEN OTHERS THEN
          -- swallow: another bootstrap path may have added it concurrently
          NULL;
        END;
      END IF;
    END $$;
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_nv_consent_user ON nv_schema.nv_consent_records (user_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_nv_consent_status ON nv_schema.nv_consent_records (user_id, status)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_nv_consent_org ON nv_schema.nv_consent_records (org_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_nv_consent_granted_at ON nv_schema.nv_consent_records (granted_at DESC)`);

  // task-298: nv_cam_actions table — created here too so the DPDPA registry
  // view can be defined idempotently even on a fresh DB where the consent
  // service has not yet emitted its first row.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS nv_cam_actions (
      id              SERIAL PRIMARY KEY,
      action_id       VARCHAR(64)  UNIQUE NOT NULL,
      org_id          VARCHAR(100),
      framework       VARCHAR(64),
      control_id      VARCHAR(100),
      severity        VARCHAR(20)  DEFAULT 'medium',
      status          VARCHAR(20)  DEFAULT 'pending',
      title           VARCHAR(255) NOT NULL,
      description     TEXT,
      assigned_to     VARCHAR(100),
      triggered_by    VARCHAR(100),
      evidence_ref    VARCHAR(255),
      metadata        JSONB        DEFAULT '{}'::jsonb,
      created_at      TIMESTAMP    DEFAULT NOW(),
      updated_at      TIMESTAMP    DEFAULT NOW(),
      reviewed_at     TIMESTAMP,
      reviewed_by     VARCHAR(100)
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_nv_cam_actions_framework ON nv_cam_actions (framework, created_at DESC)`);

  // task-298: explicit DPDPA projection layer. Joins the canonical consent
  // store with the CAM-writer output (framework='dpdpa') so the consent
  // registry surfaces include the most recent governance signal that
  // touched each (user, purpose) pair. Read by /api/jrx/compliance/dpdpa.
  await db.execute(sql`
    CREATE OR REPLACE VIEW nv_dpdpa_consent_registry AS
    SELECT
      cr.id,
      cr.user_id        AS principal_id,
      cr.org_id,
      cr.purpose,
      cr.status,
      cr.jurisdiction,
      cr.granted_at,
      cr.withdrawn_at,
      cr.expires_at,
      cr.consent_version,
      cr.legal_basis,
      ca.action_id      AS last_cam_action_id,
      ca.severity       AS last_cam_severity,
      ca.status         AS last_cam_status,
      ca.title          AS last_cam_title,
      ca.created_at     AS last_cam_at
    FROM nv_schema.nv_consent_records cr
    LEFT JOIN LATERAL (
      SELECT action_id, severity, status, title, created_at
      FROM nv_cam_actions
      WHERE framework = 'dpdpa'
        AND metadata->>'userId'  = cr.user_id
        AND metadata->>'purpose' = cr.purpose
      ORDER BY created_at DESC
      LIMIT 1
    ) ca ON TRUE
  `);
  } catch (err: unknown) {
    if (await policyEngineTablesReady()) return;
    throw err instanceof Error ? err : new Error(String(err));
  }
}

async function seedPoliciesIfMissing(): Promise<void> {
  if (!db) return;
  // task-298: CAM-seed gate (separate from policy gate). On a warm restart
  // where policies already exist but the new CAM event seed has never run,
  // we still want the demo CAM rows so the drilldown's CAM-events panel
  // and the nv_dpdpa_consent_registry view both have joinable data.
  const camCount: any = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM nv_cam_actions
    WHERE triggered_by = './jrx-policy-engine.bootstrap'
  `);
  const haveCam = Number((camCount.rows ?? camCount)[0]?.n ?? 0);
  const polCount: any = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM nv_policies
    WHERE policy_code LIKE 'POL-US-%' OR policy_code LIKE 'POL-IN-%'
  `);
  const havePol = Number((polCount.rows ?? polCount)[0]?.n ?? 0);
  if (havePol >= DEMO_POLICIES.length && haveCam > 0) return;

  for (const p of DEMO_POLICIES) {
    const ins: any = await db.execute(sql`
      INSERT INTO nv_policies
        (org_id, policy_code, name, category, jurisdiction, severity, status, owner_team,
         description, rules, current_version, effective_at, review_at, framework_refs,
         last_enforced_at)
      VALUES
        (1, ${p.code}, ${p.name}, ${p.category}, ${p.jurisdiction}, ${p.severity}, ${p.status},
         ${p.owner}, ${p.description}, ${JSON.stringify(p.rules)}::jsonb, '1.0.0',
         NOW() - interval '90 days', NOW() + interval '275 days',
         ${JSON.stringify(p.framework_refs)}::jsonb,
         NOW() - (random() * interval '6 hours'))
      ON CONFLICT (org_id, policy_code) DO UPDATE SET
        jurisdiction = EXCLUDED.jurisdiction,
        framework_refs = EXCLUDED.framework_refs,
        last_enforced_at = COALESCE(nv_policies.last_enforced_at, NOW() - interval '15 minutes'),
        updated_at = NOW()
      RETURNING id
    `);
    const policyId = (ins.rows ?? ins)[0]?.id;
    if (!policyId) continue;
    await db.execute(sql`
      INSERT INTO nv_policy_versions (policy_id, version, body_md, changelog, published_by, published_at)
      VALUES (${policyId}, '1.0.0', ${p.body_md}, 'Demo G1B initial publication.',
              'compliance@jurexio', NOW() - interval '90 days')
      ON CONFLICT (policy_id, version) DO NOTHING
    `);
    // task-298 review-fix v8: deterministic minimum-guarantee seeding.
    // Every policy gets exactly N=4 violations + paired CAM events so the
    // demo never lands on an empty drilldown. Org assignment cycles
    // through fixed offsets (0, 25, 50, 75) within the jurisdiction
    // band so each policy hits 4 distinct tenants — half early in the
    // band, half later — guaranteeing both US (1000-1099) and IN
    // (1100-1199) tenants show non-zero rows when filtered.
    const N_PER_POLICY = 4;
    const ORG_OFFSETS = [0, 25, 50, 75];
    for (let i = 0; i < N_PER_POLICY; i++) {
      const offset = ORG_OFFSETS[i];
      const orgId = p.jurisdiction === 'IN'
        ? 1100 + offset
        : p.jurisdiction === 'US'
          ? 1000 + offset
          : 1;
      const reqId = 'req-' + Math.random().toString(36).slice(2, 10);
      const userRef = 'user-' + Math.random().toString(36).slice(2, 8);
      await db.execute(sql`
        INSERT INTO nv_policy_violations
          (policy_id, org_id, severity, source, request_id, user_ref, description, detected_at, status)
        VALUES
          (${policyId}, ${orgId}, ${p.severity}, 'consent-gate',
           ${reqId}, ${userRef},
           ${`Auto-detected breach of ${p.code} during ${p.jurisdiction} demo traffic`},
           NOW() - (random() * interval '24 hours'),
           ${i === 0 ? 'open' : 'closed'})
      `);
      const fw =
        p.code.startsWith('POL-IN-DPDPA')   ? 'dpdpa'   :
        p.code.startsWith('POL-US-CCPA')    ? 'ccpa'    :
        p.code.startsWith('POL-US-HIPAA')   ? 'hipaa'   :
        p.code.startsWith('POL-US-FRCP')    ? 'frcp'    :
        p.code.startsWith('POL-US-SOC2')    ? 'soc2'    :
        p.code.startsWith('POL-IN-IT')      ? 'it_act'  :
        p.code.startsWith('POL-IN-BCI')     ? 'bci'     :
        p.code.startsWith('POL-US-ABA')     ? 'aba'     :
        p.code.startsWith('POL-US-VCDPA')   ? 'vcdpa'   :
        p.code.startsWith('POL-US-CPA')     ? 'cpa'     :
        p.code.startsWith('POL-US-FEDRAMP') ? 'fedramp' :
        // task-351: state breach-notification regimes (NY SHIELD, IL BIPA,
        // MA 201 CMR 17) get distinct framework tags so the CAM event log
        // is filterable per-state.
        p.code.startsWith('POL-US-NYSHIELD')   ? 'nyshield' :
        p.code.startsWith('POL-US-BIPA')       ? 'bipa'     :
        p.code.startsWith('POL-US-MA201CMR17') ? 'ma201'    :
        // task-398: GLBA Safeguards Rule (16 C.F.R. Part 314) gets a
        // distinct framework tag so the CAM event log is filterable
        // alongside the other US sectoral regimes.
        p.code.startsWith('POL-US-GLBA')       ? 'glba'     :
        'governance';
      const purposeForCam = fw === 'dpdpa' ? CONSENT_PURPOSES[i % CONSENT_PURPOSES.length] : null;
      const camUserId = fw === 'dpdpa'
        ? `principal-${(p.jurisdiction || 'in').toLowerCase()}-${String(i).padStart(4, '0')}`
        : userRef;
      await db.execute(sql`
        INSERT INTO nv_cam_actions
          (action_id, org_id, framework, control_id, severity, status, title,
           description, triggered_by, evidence_ref, metadata, created_at)
        VALUES
          (${'cam-' + p.code + '-' + i + '-' + Math.random().toString(36).slice(2, 6)},
           ${String(orgId)}, ${fw}, ${p.code + '.r' + i}, ${p.severity},
           ${i === 0 ? 'pending' : 'enforced'},
           ${`${fw.toUpperCase()} breach: ${p.code}`},
           ${`Demo G1B CAM event for ${p.code} (${p.jurisdiction})`},
           './jrx-policy-engine.bootstrap', ${reqId},
           ${JSON.stringify({
             userId: camUserId,
             purpose: purposeForCam,
             jurisdiction: p.jurisdiction,
             policyCode: p.code,
           })}::jsonb,
           NOW() - (random() * interval '24 hours'))
        ON CONFLICT (action_id) DO NOTHING
      `);
    }
  }
  logger.info('policy_engine_seed_complete', { policies: DEMO_POLICIES.length });
}

async function backfillConsentTrafficIfSparse(): Promise<void> {
  if (!db) return;
  const r: any = await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM nv_schema.nv_consent_records
    WHERE granted_at > NOW() - interval '7 days'
      AND (org_id LIKE '10%' OR org_id LIKE '11%')
  `);
  const have = Number((r.rows ?? r)[0]?.n ?? 0);
  if (have >= 100) return;

  // Stale demo rows block INSERT (unique on user_id/purpose/consent_version) — refresh timestamps.
  await db.execute(sql`
    UPDATE nv_schema.nv_consent_records
    SET
      granted_at = NOW() - (random() * interval '7 days'),
      withdrawn_at = CASE
        WHEN status = 'withdrawn' THEN NOW() - (random() * interval '7 days') + interval '4 hours'
        ELSE withdrawn_at
      END
    WHERE (org_id LIKE '10%' OR org_id LIKE '11%')
      AND granted_at <= NOW() - interval '7 days'
  `);
  const r2: any = await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM nv_schema.nv_consent_records
    WHERE granted_at > NOW() - interval '7 days'
      AND (org_id LIKE '10%' OR org_id LIKE '11%')
  `);
  const haveAfterRefresh = Number((r2.rows ?? r2)[0]?.n ?? 0);
  if (haveAfterRefresh >= 100) {
    logger.info('consent_backfill_refreshed', { records: haveAfterRefresh });
    return;
  }

  // Build 140 grants spanning 7 days, ~half US (1000-1099), ~half IN (1100-1199)
  // 20% of those become withdrawals later in the window.
  const target = 140;
  for (let i = 0; i < target; i++) {
    const isUS = i % 2 === 0;
    const orgId = isUS
      ? 1000 + (i % 100)
      : 1100 + (i % 100);
    const jurisdiction = isUS ? 'US' : 'IN';
    const purpose = CONSENT_PURPOSES[i % CONSENT_PURPOSES.length];
    const userId = `principal-${jurisdiction.toLowerCase()}-${String(i).padStart(4, '0')}`;
    const offsetDays = (i / target) * 7;
    const grantedAt = `NOW() - (interval '1 day' * ${offsetDays.toFixed(3)})`;
    await db.execute(sql.raw(`
      INSERT INTO nv_schema.nv_consent_records
        (user_id, org_id, purpose, status, jurisdiction, consent_version, legal_basis,
         granted_at, expires_at)
      VALUES
        ('${userId}', '${orgId}', '${purpose}', 'granted', '${jurisdiction}',
         '3.1.2-dpdpa-2023', 'DPDPA §4 — Demo G1B backfill',
         ${grantedAt}, ${grantedAt} + interval '365 days')
      ON CONFLICT DO NOTHING
    `));
    if (i % 5 === 0) {
      await db.execute(sql.raw(`
        UPDATE nv_schema.nv_consent_records
        SET status = 'withdrawn', withdrawn_at = ${grantedAt} + interval '4 hours'
        WHERE user_id = '${userId}' AND purpose = '${purpose}' AND status = 'granted'
      `));
    }
  }
  logger.info('consent_backfill_complete', { records: target });
}

export const nvPolicyEngine = {
  /** Idempotent bootstrap. Safe to call on every cold start. */
  async bootstrap(): Promise<void> {
    if (_bootstrapped) return;
    if (!db) {
      logger.warn('policy_engine_bootstrap_skipped_no_db');
      return;
    }
    try {
      await ensureTables();
      await seedPoliciesIfMissing();
      await backfillConsentTrafficIfSparse();
      _bootstrapped = true;
    } catch (err: any) {
      logger.warn('policy_engine_bootstrap_failed', { err: err?.message });
    }
  },

  /** DPDPA 9-principle posture, joined to backing policies. */
  dpdpaPrinciples() {
    return DPDPA_PRINCIPLES;
  },

  /** Demo policy seed (used by the docs / canonical exports). */
  demoPolicies(): readonly PolicySeed[] {
    return DEMO_POLICIES;
  },
};

export default nvPolicyEngine;
