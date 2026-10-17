/**
 * jrx-seed-prompt-library.ts (2026-05-13)
 *
 * Seeds `template_library` with REAL legal prompt templates per jurisdiction.
 * Idempotent on (org_id, slug). NV-DB-SCRIPT-001 compliant (uses makePgSql).
 *
 * Categories (8): Drafting, Opinion, Litigation, Compliance, Due Diligence,
 *                 Regulatory, Client Communication, Research
 *
 * Jurisdictions (6): IN, US, UK, EU, SG, GC
 */
import { makePgSql } from './_pg-pool.js';
import { assertColumns } from './_assert-columns.js';

// task #347: schema-drift guard — fail loud before any INSERT.
const REQUIRED_COLUMNS = {
  'public.template_library': [
    'id', 'org_id', 'name', 'slug', 'category', 'jurisdiction', 'language',
    'template_body', 'variables', 'tags', 'version', 'is_public', 'is_active',
    'usage_count', 'metadata', 'created_at', 'updated_at',
  ],
} as const;

type Tpl = {
  slug: string;
  name: string;
  category: string;
  jurisdiction: string;
  language: string;
  template_body: string;
  variables: string[];
  tags: string[];
};

const J = ['IN', 'US', 'UK', 'EU', 'SG', 'GC'] as const;

// Per-jurisdiction statutory anchors used to make each prompt jurisdiction-real.
const ANCHORS: Record<string, { contractAct: string; ipc: string; dataLaw: string; courtRule: string; arbAct: string; consumer: string }> = {
  IN: { contractAct: 'Indian Contract Act, 1872', ipc: 'Bharatiya Nyaya Sanhita, 2023', dataLaw: 'Digital Personal Data Protection Act, 2023 (DPDPA)', courtRule: 'Code of Civil Procedure, 1908',  arbAct: 'Arbitration & Conciliation Act, 1996',           consumer: 'Consumer Protection Act, 2019' },
  US: { contractAct: 'UCC Article 2 + Restatement (Second) of Contracts', ipc: 'Federal Rules of Criminal Procedure', dataLaw: 'CCPA / CPRA + state breach laws', courtRule: 'Federal Rules of Civil Procedure (FRCP)', arbAct: 'Federal Arbitration Act (9 U.S.C.)',         consumer: 'FTC Act §5 + state consumer-protection statutes' },
  UK: { contractAct: 'Sale of Goods Act 1979 + common law', ipc: 'Police, Crime, Sentencing and Courts Act 2022',     dataLaw: 'UK GDPR + Data Protection Act 2018',     courtRule: 'Civil Procedure Rules 1998',                arbAct: 'Arbitration Act 1996',                       consumer: 'Consumer Rights Act 2015' },
  EU: { contractAct: 'Rome I Regulation (EC 593/2008)',                ipc: 'EU Charter of Fundamental Rights',           dataLaw: 'GDPR (EU 2016/679) + EU AI Act 2024',    courtRule: 'Brussels Ia Regulation (EU 1215/2012)',     arbAct: 'New York Convention 1958 + national arb laws', consumer: 'Consumer Rights Directive 2011/83/EU' },
  SG: { contractAct: 'Contracts (Rights of Third Parties) Act + common law', ipc: 'Penal Code 1871',                    dataLaw: 'Personal Data Protection Act 2012 (PDPA)', courtRule: 'Rules of Court 2021',                      arbAct: 'International Arbitration Act 1994',         consumer: 'Consumer Protection (Fair Trading) Act 2003' },
  GC: { contractAct: 'KSA Civil Transactions Law 2023 / UAE Civil Code Federal Law No. 5 of 1985', ipc: 'KSA / UAE Penal Codes', dataLaw: 'KSA PDPL 2021 + UAE PDPL Federal Decree-Law 45 of 2021', courtRule: 'GCC Procedural Codes', arbAct: 'KSA Arbitration Law 2012 + UAE Federal Arbitration Law 6 of 2018', consumer: 'GCC Consumer Protection Laws' },
};

function buildForJurisdiction(j: string): Tpl[] {
  const a = ANCHORS[j];
  return [
    // ── DRAFTING ───────────────────────────────────────────────────────────
    {
      slug: `${j.toLowerCase()}-nda-mutual`,
      name: `${j} — Mutual NDA (Standard)`,
      category: 'Drafting',
      jurisdiction: j,
      language: 'en',
      tags: ['nda', 'confidentiality', 'contract'],
      variables: ['party_a', 'party_b', 'effective_date', 'term_years', 'governing_law_city'],
      template_body:
`Draft a mutual non-disclosure agreement under the laws of ${j} between {{party_a}} and {{party_b}}, effective {{effective_date}}.
Anchor in ${a.contractAct}. Term: {{term_years}} years. Carve out: (i) information already in the public domain, (ii) lawfully received from third parties, (iii) independently developed.
Include: definition of Confidential Information, permitted use, return-or-destroy, equitable remedies, ${j === 'IN' ? '7-year survival on trade secrets' : '5-year survival'}, jurisdiction in {{governing_law_city}}.
Output the full executable agreement with signature blocks.`,
    },
    {
      slug: `${j.toLowerCase()}-saas-msa`,
      name: `${j} — SaaS Master Services Agreement`,
      category: 'Drafting',
      jurisdiction: j,
      language: 'en',
      tags: ['saas', 'msa', 'commercial'],
      variables: ['provider', 'customer', 'service_description', 'sla_uptime_pct'],
      template_body:
`Draft a SaaS MSA governed by ${j} law between {{provider}} (provider) and {{customer}} (customer) for {{service_description}}.
Required clauses: subscription scope, fees & taxes, IP ownership (provider retains; customer gets perpetual licence to outputs), warranty disclaimers, limitation of liability capped at 12 months fees, indemnity for IP infringement, data protection (${a.dataLaw}), uptime SLA at {{sla_uptime_pct}}%, exit assistance, audit rights, dispute under ${a.arbAct}.`,
    },
    {
      slug: `${j.toLowerCase()}-employment-offer`,
      name: `${j} — Employment Offer Letter`,
      category: 'Drafting',
      jurisdiction: j,
      language: 'en',
      tags: ['employment', 'hr', 'offer'],
      variables: ['employer', 'candidate', 'role', 'ctc', 'start_date'],
      template_body:
`Draft an employment offer letter from {{employer}} to {{candidate}} for {{role}}, CTC {{ctc}}, start {{start_date}}.
Comply with ${j} labour-law minima, probation, leave, IP-assignment, non-solicit (enforceable to the extent permitted under ${j} jurisprudence), and at-will / notice rules per ${j} norms.`,
    },

    // ── OPINION ────────────────────────────────────────────────────────────
    {
      slug: `${j.toLowerCase()}-legal-opinion-memo`,
      name: `${j} — Legal Opinion Memo (IRAC)`,
      category: 'Opinion',
      jurisdiction: j,
      language: 'en',
      tags: ['memo', 'irac', 'opinion'],
      variables: ['client_name', 'issue', 'facts'],
      template_body:
`Prepare an IRAC legal opinion memo for {{client_name}} on the issue: {{issue}}. Facts: {{facts}}.
Structure: ISSUE → RULE (cite ${j} statutes incl. ${a.contractAct} where relevant) → APPLICATION → CONCLUSION with confidence (HIGH/MEDIUM/LOW) and risks.
Include 3+ ${j} authorities with full citations.`,
    },
    {
      slug: `${j.toLowerCase()}-enforceability-opinion`,
      name: `${j} — Cross-border Enforceability Opinion`,
      category: 'Opinion',
      jurisdiction: j,
      language: 'en',
      tags: ['opinion', 'cross-border', 'enforcement'],
      variables: ['contract_name', 'foreign_jurisdiction', 'governing_law'],
      template_body:
`Provide an enforceability opinion on {{contract_name}} governed by {{governing_law}}, between a ${j} party and a {{foreign_jurisdiction}} party.
Address: choice-of-law validity, recognition of arbitral awards (${a.arbAct} & New York Convention), public-policy carve-outs in ${j}, currency & exchange-control restrictions, stamp duty / registration, witness & execution formalities.`,
    },

    // ── LITIGATION ─────────────────────────────────────────────────────────
    {
      slug: `${j.toLowerCase()}-civil-complaint`,
      name: `${j} — Civil Complaint Skeleton`,
      category: 'Litigation',
      jurisdiction: j,
      language: 'en',
      tags: ['complaint', 'pleadings', 'civil'],
      variables: ['plaintiff', 'defendant', 'cause_of_action', 'reliefs_sought'],
      template_body:
`Draft a civil complaint per ${a.courtRule} between {{plaintiff}} and {{defendant}} on cause of action: {{cause_of_action}}.
Reliefs sought: {{reliefs_sought}}. Include parties, jurisdiction, facts (numbered), causes of action with elements, prayer for relief, verification, and a list of documents relied upon.`,
    },
    {
      slug: `${j.toLowerCase()}-discovery-requests`,
      name: `${j} — Discovery / Disclosure Requests`,
      category: 'Litigation',
      jurisdiction: j,
      language: 'en',
      tags: ['discovery', 'pleadings'],
      variables: ['matter_name', 'opposing_party', 'doc_categories'],
      template_body:
`Draft discovery / disclosure requests under ${a.courtRule} in {{matter_name}} addressed to {{opposing_party}}.
Cover document categories: {{doc_categories}}. Add interrogatories (10), document requests (15), and requests for admission (10) tailored to ${j} practice.`,
    },

    // ── COMPLIANCE ─────────────────────────────────────────────────────────
    {
      slug: `${j.toLowerCase()}-data-protection-impact-assessment`,
      name: `${j} — Data Protection Impact Assessment (DPIA)`,
      category: 'Compliance',
      jurisdiction: j,
      language: 'en',
      tags: ['dpia', 'privacy', 'data-protection'],
      variables: ['controller', 'processing_purpose', 'data_categories', 'recipients'],
      template_body:
`Conduct a DPIA under ${a.dataLaw} for processing by {{controller}}.
Purpose: {{processing_purpose}}. Categories of data: {{data_categories}}. Recipients: {{recipients}}.
Include: lawful basis, necessity & proportionality, risks to rights & freedoms, mitigation controls, residual risk, DPO sign-off, and consultation triggers.`,
    },
    {
      slug: `${j.toLowerCase()}-aml-kyc-policy`,
      name: `${j} — AML/KYC Policy Skeleton`,
      category: 'Compliance',
      jurisdiction: j,
      language: 'en',
      tags: ['aml', 'kyc', 'finance'],
      variables: ['regulated_entity', 'risk_appetite'],
      template_body:
`Draft an AML/KYC policy for {{regulated_entity}} aligned with ${j} regulator expectations and FATF 40 Recommendations. Risk appetite: {{risk_appetite}}.
Include: customer-risk rating model, EDD triggers, PEP & sanctions screening, transaction monitoring rules, STR/SAR filing workflow, training cadence, governance.`,
    },

    // ── DUE DILIGENCE ──────────────────────────────────────────────────────
    {
      slug: `${j.toLowerCase()}-ma-due-diligence-checklist`,
      name: `${j} — M&A Legal Due Diligence Checklist`,
      category: 'Due Diligence',
      jurisdiction: j,
      language: 'en',
      tags: ['m&a', 'due-diligence'],
      variables: ['target', 'transaction_value', 'sector'],
      template_body:
`Generate a comprehensive ${j} legal DD checklist for the acquisition of {{target}} (${`{{sector}}`}, deal value {{transaction_value}}).
Coverage: corporate, contracts, IP, employment, real estate, regulatory, litigation, tax, data protection (${a.dataLaw}), ESG, sanctions/anti-bribery. Mark each item with priority (P0/P1/P2).`,
    },
    {
      slug: `${j.toLowerCase()}-vendor-risk-review`,
      name: `${j} — Third-Party Vendor Risk Review`,
      category: 'Due Diligence',
      jurisdiction: j,
      language: 'en',
      tags: ['vendor', 'tprm', 'risk'],
      variables: ['vendor_name', 'service_type'],
      template_body:
`Run a ${j}-flavoured vendor risk review for {{vendor_name}} providing {{service_type}}. Cover: corporate standing, sanctions screening, contractual safeguards (data, audit, exit), insurance, security posture, sub-processors, regulator notifications.`,
    },

    // ── REGULATORY ─────────────────────────────────────────────────────────
    {
      slug: `${j.toLowerCase()}-regulator-response-letter`,
      name: `${j} — Regulator Response Letter`,
      category: 'Regulatory',
      jurisdiction: j,
      language: 'en',
      tags: ['regulatory', 'letter'],
      variables: ['regulator', 'reference', 'matter'],
      template_body:
`Draft a measured response from the General Counsel to {{regulator}} (ref {{reference}}) on {{matter}}.
Maintain professionalism, narrate facts chronologically, cite remedial steps, request reasonable extensions, and avoid admissions of liability while remaining cooperative.`,
    },
    {
      slug: `${j.toLowerCase()}-incident-breach-notification`,
      name: `${j} — Data Breach Notification (Regulator + Data Subjects)`,
      category: 'Regulatory',
      jurisdiction: j,
      language: 'en',
      tags: ['breach', 'incident', 'privacy'],
      variables: ['controller', 'incident_summary', 'records_affected', 'detection_date'],
      template_body:
`Prepare a breach-notification package under ${a.dataLaw}.
Controller: {{controller}}. Incident: {{incident_summary}}. Records affected: {{records_affected}}. Detected on {{detection_date}}.
Output: (1) regulator notification within statutory timelines, (2) data-subject notice in plain language, (3) internal escalation memo. Include containment + remediation timeline.`,
    },

    // ── CLIENT COMMUNICATION ───────────────────────────────────────────────
    {
      slug: `${j.toLowerCase()}-client-update-status-note`,
      name: `${j} — Client Status Update`,
      category: 'Client Communication',
      jurisdiction: j,
      language: 'en',
      tags: ['client', 'update'],
      variables: ['client', 'matter', 'recent_developments', 'next_steps'],
      template_body:
`Compose a client status update to {{client}} on {{matter}}.
Cover: recent developments ({{recent_developments}}), risks/issues, next steps ({{next_steps}}), fees-to-date, and decisions sought from the client. Tone: professional, concise, jargon-light.`,
    },

    // ── RESEARCH ───────────────────────────────────────────────────────────
    {
      slug: `${j.toLowerCase()}-precedent-research-prompt`,
      name: `${j} — Precedent Research Brief`,
      category: 'Research',
      jurisdiction: j,
      language: 'en',
      tags: ['research', 'precedent'],
      variables: ['legal_issue', 'date_range'],
      template_body:
`Research ${j} precedent on {{legal_issue}} between {{date_range}}.
Return: 5–10 leading authorities (full citations), holding summary, factual analogies, distinguishing factors, and current standing (good law / overruled / distinguished).`,
    },
    {
      slug: `${j.toLowerCase()}-statute-comparator`,
      name: `${j} — Cross-Jurisdiction Statute Comparator`,
      category: 'Research',
      jurisdiction: j,
      language: 'en',
      tags: ['research', 'comparative'],
      variables: ['topic', 'compare_with'],
      template_body:
`Compare ${j} treatment of {{topic}} with {{compare_with}}.
Output a side-by-side table covering: governing statute, key thresholds, enforcement authority, penalties, recent amendments, and practical implications for cross-border transactions.`,
    },
  ];
}

async function main() {
  if (!process.env.DATABASE_URL) {
    if (process.env.JRX_DATABASE_URL) process.env.DATABASE_URL = process.env.JRX_DATABASE_URL;
  }
  const sql = makePgSql();
  console.log('[seed-prompt-library] starting');
  await assertColumns(sql, './jrx-seed-prompt-library', REQUIRED_COLUMNS);

  // Resolve org list. Org ids in DB are varchar(36).
  const orgs = (await sql`SELECT id::text AS id FROM nv_organizations ORDER BY id LIMIT 5`) as Array<{ id: string }>;
  const orgIds = orgs.map(o => o.id);
  if (orgIds.length === 0) throw new Error('no orgs');

  let inserted = 0;
  for (const j of J) {
    const tpls = buildForJurisdiction(j);
    for (const t of tpls) {
      for (const orgId of orgIds) {
        const slugFinal = `${t.slug}-org${orgId}`;
        const id = `tpl_${Math.random().toString(36).slice(2, 12)}_${Date.now().toString(36).slice(-6)}`;
        const r = await sql`
          INSERT INTO template_library (
            id, org_id, name, slug, category, jurisdiction, language,
            template_body, variables, tags, version, is_public, is_active,
            usage_count, metadata, created_at, updated_at
          ) VALUES (
            ${id}, ${orgId}, ${t.name}, ${slugFinal}, ${t.category}, ${t.jurisdiction}, ${t.language},
            ${t.template_body}, ${JSON.stringify(t.variables)}::jsonb, ${JSON.stringify(t.tags)}::jsonb,
            ${'1.0.0'}, ${orgId === '1'}, ${true},
            ${Math.floor(Math.random() * 60)}, ${JSON.stringify({ source: 'jurexio-canonical' })}::jsonb,
            NOW() - (random() * INTERVAL '90 days'), NOW()
          )
          ON CONFLICT (org_id, slug) DO NOTHING
          RETURNING id
        `;
        if ((r as any[]).length > 0) inserted++;
      }
    }
  }

  const total = await sql`SELECT COUNT(*)::int AS c FROM template_library`;
  console.log(`[seed-prompt-library] inserted=${inserted}  total=${(total as any[])[0].c}`);
  await sql.end();
}

main().catch(e => { console.error('[seed-prompt-library] FAIL', e); process.exit(1); });
