/**
 * Jurexio Curated Prompt Library — task-303 (Demo G3A)
 *
 * Static, read-only seed of ≥ 60 production-grade legal prompts spanning
 * 5 categories × 6 jurisdictions, each tagged with the agent groups that
 * are best equipped to run them. Returned as-is by /api/jrx/prompts.
 *
 * Categories:
 *   Litigation · Contract Review · Compliance · Research · Citizen-Facing
 *
 * Jurisdictions: IN · US · UK · EU · GC · SG
 *
 * Agent compatibility uses the canonical agent-group ids from
 * config/agent-registries/* (litigation, contracts, compliance, research,
 * citizen). The Console "Try in Universal Chat" CTA stashes the body to
 * sessionStorage and routes to /console/chat?tab=universal.
 */

export type PromptCategory =
  | 'Litigation'
  | 'Contract Review'
  | 'Compliance'
  | 'Research'
  | 'Citizen-Facing';

export type PromptJurisdiction = 'IN' | 'US' | 'UK' | 'EU' | 'GC' | 'SG';

export interface CuratedPrompt {
  id: string;
  slug: string;
  name: string;
  category: PromptCategory;
  jurisdiction: PromptJurisdiction;
  language: string;
  version: string;
  is_public: boolean;
  usage_count: number;
  agents: string[];
  tags: string[];
  template_body: string;
}

const make = (
  slug: string,
  name: string,
  category: PromptCategory,
  jurisdiction: PromptJurisdiction,
  agents: string[],
  template_body: string,
  tags: string[] = [],
  usage_count = 0,
): CuratedPrompt => ({
  id: `nv-prompt-${slug}`,
  slug,
  name,
  category,
  jurisdiction,
  language: 'en',
  version: '1.0.0',
  is_public: true,
  usage_count,
  agents,
  tags,
  template_body,
});

export const NV_PROMPT_LIBRARY: CuratedPrompt[] = [
  // ─── Litigation (12) ──────────────────────────────────────────────
  make('lit-in-bail-application', 'Anticipatory Bail Application (BNSS s.482)', 'Litigation', 'IN', ['litigation','criminal'],
    'Draft an anticipatory bail application under Section 482 BNSS for {{client_name}} in FIR {{fir_number}} ({{police_station}}). Cover: parity with co-accused, no custodial interrogation needed, willingness to cooperate, no flight risk. Cite Arnesh Kumar v. State of Bihar (2014) and Sushila Aggarwal (2020).',
    ['bnss','bail','criminal'], 142),
  make('lit-in-writ-326', 'Writ Petition under Article 226 — Service Matter', 'Litigation', 'IN', ['litigation'],
    'Draft a writ petition under Article 226 challenging the impugned order dated {{order_date}} of {{respondent_authority}}. Set out (a) facts, (b) grounds — violation of Article 14/16, principles of natural justice, (c) prayer for quashing + consequential reliefs.',
    ['constitutional','writ','service-law'], 87),
  make('lit-in-section-9-arbitration', 'Section 9 Arbitration & Conciliation Act Petition', 'Litigation', 'IN', ['litigation','contracts'],
    'Draft a Section 9 petition before the {{court}} seeking interim measures pending arbitration in dispute under contract dated {{contract_date}} between {{petitioner}} and {{respondent}}. Address prima facie case, balance of convenience, irreparable injury.',
    ['arbitration','interim-relief'], 64),
  make('lit-us-rule-12b6-motion', 'Motion to Dismiss — FRCP 12(b)(6)', 'Litigation', 'US', ['litigation'],
    'Draft a Rule 12(b)(6) motion to dismiss the complaint by {{plaintiff}} in {{case_caption}}. Argue failure to state a claim under Twombly/Iqbal plausibility standard. Each count: identify element, plead deficiency, cite controlling authority in {{circuit}}.',
    ['frcp','motion-to-dismiss','federal'], 119),
  make('lit-us-summary-judgment', 'Motion for Summary Judgment — FRCP 56', 'Litigation', 'US', ['litigation'],
    'Draft a Rule 56 motion for summary judgment for {{movant}} in {{case_caption}}. Statement of undisputed material facts (numbered, record-cited), legal standard, argument per claim, exhibit index.',
    ['frcp','msj','federal'], 78),
  make('lit-uk-witness-statement', 'CPR 32 Witness Statement', 'Litigation', 'UK', ['litigation'],
    'Draft a CPR Part 32 compliant witness statement of {{witness_name}} in {{claim_number}}. First person, chronological, exhibit references ({{witness_initials}}1, …), statement of truth in CPR-prescribed form.',
    ['cpr','witness'], 55),
  make('lit-uk-pre-action-protocol', 'Pre-Action Protocol Letter — Professional Negligence', 'Litigation', 'UK', ['litigation'],
    'Draft a Letter of Claim under the Pre-Action Protocol for Professional Negligence against {{defendant_firm}}. Identify retainer, breach, causation, loss; demand acknowledgment within 21 days, substantive response within 3 months.',
    ['professional-negligence','protocol'], 41),
  make('lit-eu-cjeu-art-267', 'Article 267 TFEU Reference for Preliminary Ruling', 'Litigation', 'EU', ['litigation','research'],
    'Draft a request for a preliminary ruling under Article 267 TFEU referring {{number}} questions on the interpretation of {{eu_instrument}} arising in proceedings between {{parties}}. Include necessary factual and legal context per Recommendations to national courts.',
    ['cjeu','preliminary-ruling'], 29),
  make('lit-gc-difc-claim', 'DIFC Court Claim Form (Part 7)', 'Litigation', 'GC', ['litigation','contracts'],
    'Draft a DIFC Courts Part 7 Claim Form for breach of {{contract_type}} between {{claimant}} and {{defendant}}. State jurisdictional gateway (DIFC body / opt-in / DIFC connection), governing law, particulars of breach, quantum.',
    ['difc','uae','commercial'], 22),
  make('lit-sg-originating-claim', 'Singapore Originating Claim — ROC 2021', 'Litigation', 'SG', ['litigation'],
    'Draft an Originating Claim under the Rules of Court 2021 (O.6) on behalf of {{claimant}} v {{defendant}} in the {{court}}. Concise statement of nature of claim, relief sought, statement of value.',
    ['roc-2021','originating-claim'], 18),
  make('lit-sg-injunction-application', 'Mareva Injunction Application (Singapore)', 'Litigation', 'SG', ['litigation'],
    'Draft a Mareva (asset preservation) injunction application before the General Division of the High Court. Address good arguable case, real risk of dissipation, just and convenient, undertaking as to damages.',
    ['injunction','interim-relief'], 12),
  make('lit-in-cheque-bounce-138', 'NI Act §138 Complaint — Cheque Dishonour', 'Litigation', 'IN', ['litigation','citizen'],
    'Draft a complaint under Section 138 of the Negotiable Instruments Act for dishonour of cheque no. {{cheque_no}} dated {{cheque_date}} for ₹{{amount}}. Statutory notice, cause of action, jurisdiction (post Dashrath Rupsingh v. State).',
    ['ni-act','cheque-bounce'], 211),

  // ─── Contract Review (12) ─────────────────────────────────────────
  make('cr-in-msa-review', 'Master Services Agreement — Indian Counterparty Review', 'Contract Review', 'IN', ['contracts'],
    'Review the attached MSA where {{indian_party}} is the {{role}}. Flag: unlimited liability clauses, IP assignment vs licence, payment terms vs MSME Act §15, jurisdiction (Indian seat), GST gross-up, data-protection (DPDPA 2023) terms.',
    ['msa','dpdpa','gst'], 167),
  make('cr-in-shareholders-agreement', 'Shareholders Agreement — Tag/Drag/ROFR Audit', 'Contract Review', 'IN', ['contracts'],
    'Audit the SHA for {{company_name}}. Specifically check: tag-along threshold, drag-along trigger, ROFR/ROFO mechanics, reserved matters, deadlock resolution, exit (IPO/strategic sale), Companies Act §6 compliance.',
    ['sha','vc','companies-act'], 92),
  make('cr-us-saas-msa', 'SaaS MSA — Vendor Side Markup (US)', 'Contract Review', 'US', ['contracts'],
    'Mark up the customer\'s SaaS MSA from {{vendor}}\'s perspective. Push back on: uncapped indemnities, data return obligations, audit rights frequency, SLA credits as sole remedy, mutual limitation of liability at 12 months\' fees.',
    ['saas','msa','vendor'], 134),
  make('cr-us-nda-mutual', 'Mutual NDA — US Standard Markup', 'Contract Review', 'US', ['contracts'],
    'Review the mutual NDA between {{party_a}} and {{party_b}}. Confirm: definition of Confidential Information, 3-year term, residual knowledge clause, return/destroy, no obligation to negotiate, governing law ({{state}}).',
    ['nda','confidentiality'], 188),
  make('cr-uk-employment-contract', 'UK Employment Contract — s.1 ERA 1996 Compliance', 'Contract Review', 'UK', ['contracts','compliance'],
    'Review the employment contract for {{employee_name}} for s.1 Employment Rights Act 1996 written-statement compliance, restrictive covenants reasonableness, IR35 status (if contractor), pension auto-enrolment.',
    ['employment','era-1996'], 71),
  make('cr-uk-supply-of-goods', 'UK Supply of Goods Contract — Brexit Impact Review', 'Contract Review', 'UK', ['contracts'],
    'Review supply contract dated {{contract_date}} between {{supplier}} (EU) and {{buyer}} (UK). Address: Incoterms 2020, customs declarations, UKCA marking transition, Northern Ireland Protocol implications, force majeure for border delays.',
    ['supply','brexit','incoterms'], 38),
  make('cr-eu-dpa-art28', 'GDPR Art.28 Data Processing Agreement Review', 'Contract Review', 'EU', ['contracts','compliance'],
    'Review the DPA between {{controller}} and {{processor}} for GDPR Art.28(3) compliance: subject-matter, duration, nature, purpose, type of personal data, categories of data subjects, controller obligations, sub-processor consent, audit rights.',
    ['gdpr','dpa','privacy'], 126),
  make('cr-eu-ai-act-supplier', 'EU AI Act — Supplier Contract Clauses', 'Contract Review', 'EU', ['contracts','compliance'],
    'Draft AI Act-compliant clauses for procurement of {{ai_system}} from {{supplier}}. Cover: provider/deployer allocation, risk classification, technical documentation, post-market monitoring, incident reporting (Art. 73), human oversight.',
    ['ai-act','procurement'], 47),
  make('cr-gc-construction-fidic', 'FIDIC Yellow Book Contract Review (GCC Project)', 'Contract Review', 'GC', ['contracts'],
    'Review FIDIC 1999 Yellow Book contract for {{project}} in {{country}}. Flag local-law overrides: UAE Civil Code Art. 880 (10-year decennial liability), payment vs Construction Law, dispute board v DIFC arbitration, Sharia-compliance of interest.',
    ['fidic','construction','uae'], 24),
  make('cr-gc-distribution-agency', 'GCC Commercial Agency Law — Distribution Agreement', 'Contract Review', 'GC', ['contracts'],
    'Review distribution agreement appointing {{distributor}} in {{gcc_country}}. Address: registration under Commercial Agencies Law, exclusivity, term and termination compensation (goodwill), price-fixing prohibition.',
    ['agency','distribution','gcc'], 19),
  make('cr-sg-shareholders-rights', 'Singapore Shareholders Agreement — Companies Act Audit', 'Contract Review', 'SG', ['contracts'],
    'Audit Singapore SHA against Companies Act (Cap.50) and SGX listing rules. Address: pre-emption rights, voting agreements (s.39A), oppression remedy availability (s.216), conversion to public co.',
    ['sha','sg-companies-act'], 16),
  make('cr-sg-employment-iao', 'Singapore Employment Contract — KETs + IAO Compliance', 'Contract Review', 'SG', ['contracts','compliance'],
    'Review SG employment contract for Key Employment Terms (KETs) compliance, IAO leave entitlements, FWL/levy if foreign worker, restrictive covenants reasonableness post Pulau Manukan v PT Kabaena.',
    ['employment','sg-mom'], 13),

  // ─── Compliance (12) ──────────────────────────────────────────────
  make('co-in-dpdpa-fiduciary', 'DPDPA 2023 — Data Fiduciary Readiness Checklist', 'Compliance', 'IN', ['compliance'],
    'Generate a DPDPA 2023 readiness checklist for {{company}}: notice & consent design, DPO appointment trigger (Significant Data Fiduciary), grievance officer, breach notification (72h to DPB), retention limits, cross-border rules (Schedule).',
    ['dpdpa','privacy'], 156),
  make('co-in-pmla-kyc', 'PMLA + KYC Master Direction Compliance Audit', 'Compliance', 'IN', ['compliance'],
    'Audit {{regulated_entity}} for PMLA + RBI KYC Master Direction compliance: customer due diligence, risk categorisation, periodic updation, beneficial-owner identification (10/15/25%), STR/CTR thresholds and reporting cadence.',
    ['pmla','kyc','aml'], 89),
  make('co-us-sox-404', 'SOX §404 Internal Controls Documentation', 'Compliance', 'US', ['compliance'],
    'Generate SOX §404 documentation for {{control_id}} ({{control_objective}}). Include: process narrative, risk-control matrix, control owner, frequency, evidence type, COSO 2013 component mapping, deficiency rating rubric.',
    ['sox','icfr','coso'], 73),
  make('co-us-ccpa-cpra-rights', 'CCPA/CPRA Consumer Rights Response Workflow', 'Compliance', 'US', ['compliance','citizen'],
    'Draft a CCPA/CPRA consumer-rights response for a {{request_type}} request from {{requester}}. Verify identity, scope, exemptions (1798.145), response within 45 days (extendable 45), authorized agent rules.',
    ['ccpa','cpra','privacy'], 64),
  make('co-uk-uk-gdpr-dpia', 'UK GDPR DPIA Template', 'Compliance', 'UK', ['compliance'],
    'Conduct a Data Protection Impact Assessment for {{processing_activity}}. Cover: Art.35 trigger, systematic description, necessity & proportionality, risk assessment, mitigations, residual risk, ICO consultation if needed.',
    ['uk-gdpr','dpia'], 58),
  make('co-uk-fca-treating-customers', 'FCA Consumer Duty (PRIN 12) Gap Assessment', 'Compliance', 'UK', ['compliance'],
    'Assess {{firm_name}}\'s compliance with FCA Consumer Duty (PRIN 12) outcomes: products & services, price & value, consumer understanding, consumer support. Provide RAG rating and remediation roadmap.',
    ['fca','consumer-duty'], 41),
  make('co-eu-gdpr-ropas', 'GDPR Art.30 Records of Processing (RoPA)', 'Compliance', 'EU', ['compliance'],
    'Draft a GDPR Art.30 RoPA entry for processing activity {{activity_name}} performed by {{controller}}. Include: purposes, categories of data subjects/data, recipients, third-country transfers + safeguards, retention, security measures.',
    ['gdpr','ropa'], 122),
  make('co-eu-dora-ict-risk', 'DORA ICT Risk Management Framework Mapping', 'Compliance', 'EU', ['compliance'],
    'Map {{financial_entity}}\'s existing ICT risk framework to DORA Articles 5–16 requirements. Identify gaps in: governance, ICT risk management, incident reporting, digital operational resilience testing, third-party risk.',
    ['dora','ict-risk'], 19),
  make('co-gc-uae-pdpl', 'UAE Federal Decree-Law 45/2021 (PDPL) Readiness', 'Compliance', 'GC', ['compliance'],
    'Assess {{controller}}\'s readiness for UAE PDPL (Federal Decree-Law 45/2021): lawful bases, data subject rights, cross-border transfers, breach notification (72h to UAE Data Office), DPIA triggers.',
    ['uae-pdpl','privacy'], 22),
  make('co-gc-saudi-pdpl', 'Saudi PDPL (KSA) — SDAIA Registration & Controls', 'Compliance', 'GC', ['compliance'],
    'Generate compliance roadmap for KSA PDPL: SDAIA registration thresholds, lawful processing bases (no legitimate interest), data localisation defaults, transfer mechanisms, sensitive data categories.',
    ['ksa-pdpl','sdaia'], 16),
  make('co-sg-pdpa', 'Singapore PDPA — DPMP Documentation', 'Compliance', 'SG', ['compliance'],
    'Generate Singapore PDPA Data Protection Management Programme documents for {{organisation}}: DPO appointment, policies, breach notification (72h to PDPC if significant), Do Not Call register checks, transfer limitation safeguards.',
    ['sg-pdpa','dpmp'], 31),
  make('co-sg-mas-trm', 'MAS TRM Guidelines — Outsourcing Risk Assessment', 'Compliance', 'SG', ['compliance'],
    'Conduct a MAS TRM Guidelines (June 2021) outsourcing risk assessment for {{vendor}} providing {{service}} to {{regulated_fi}}. Address material outsourcing definition, due diligence, contractual safeguards, exit strategy, sub-contracting.',
    ['mas-trm','outsourcing'], 14),

  // ─── Research (12) ────────────────────────────────────────────────
  make('rs-in-precedent-search', 'Indian Precedent Search — Issue Framing', 'Research', 'IN', ['research'],
    'Research Indian case law on the issue: "{{legal_issue}}". Return: top 5 Supreme Court authorities, top 5 High Court authorities (last 10 years), conflicting views if any, current binding position, recommended citation order.',
    ['precedent','case-law'], 198),
  make('rs-in-statute-evolution', 'Statutory Evolution — Section Tracking', 'Research', 'IN', ['research'],
    'Trace the legislative history of {{act_name}} §{{section}}. Include: original 19xx text, every amendment with bare-act reference, current text post-{{latest_amendment}}, judicial interpretation milestones.',
    ['statute','amendments'], 67),
  make('rs-in-comparative-bnss-crpc', 'BNSS 2023 vs CrPC 1973 — Section Mapping', 'Research', 'IN', ['research','litigation'],
    'Generate a mapping of CrPC 1973 §{{crpc_section}} to its BNSS 2023 equivalent. Highlight substantive changes, transitional provisions (S. 531 BNSS), and impact on pending matters.',
    ['bnss','crpc','reform'], 84),
  make('rs-us-circuit-split', 'US Circuit Split Analysis', 'Research', 'US', ['research'],
    'Identify and analyze the circuit split on "{{legal_question}}". Provide: majority view (which circuits + leading case), minority view, scholarly commentary, likelihood of SCOTUS cert (CVSG, percolation, splits).',
    ['circuit-split','scotus'], 51),
  make('rs-us-shepardize', 'Citation Validity — Shepardize Equivalent', 'Research', 'US', ['research'],
    'Check the validity of {{case_citation}}. Report: subsequent treatment (followed/distinguished/criticized/overruled), depth of treatment, parallel citations, key cases that cite it for the proposition "{{proposition}}".',
    ['citator','case-validity'], 44),
  make('rs-uk-bailii-search', 'UK Case Law Research via BAILII', 'Research', 'UK', ['research'],
    'Find UK authorities on "{{legal_proposition}}". Prioritise: UKSC > Court of Appeal > High Court divisions. Note: any pre-2009 House of Lords decisions still binding, post-Brexit divergence from CJEU jurisprudence.',
    ['bailii','uk-case-law'], 36),
  make('rs-uk-statutory-interp', 'UK Statutory Interpretation — Pepper v Hart Analysis', 'Research', 'UK', ['research'],
    'Apply Pepper v Hart [1993] AC 593 framework to interpret {{statute}} §{{section}}: (a) ambiguity/obscurity, (b) Hansard reference of Minister/promoter, (c) clear statement. Cite subsequent narrowing in R (Spath Holme).',
    ['statutory-interp','hansard'], 19),
  make('rs-eu-cjeu-jurisprudence', 'CJEU Jurisprudence Synthesis', 'Research', 'EU', ['research'],
    'Synthesise CJEU jurisprudence on "{{eu_law_topic}}" from 2015 onwards. Identify: foundational cases, evolution of test, AG opinions departed from, current consolidated position, pending references.',
    ['cjeu','eu-law'], 27),
  make('rs-eu-direct-effect', 'EU Direct Effect & Direct Applicability Analysis', 'Research', 'EU', ['research'],
    'Analyse whether {{eu_provision}} has direct effect (Van Gend en Loos criteria) and whether it can be invoked horizontally vs. vertically (Marshall, Faccini Dori limits).',
    ['direct-effect','eu-law'], 14),
  make('rs-gc-dual-system', 'GCC Dual System Research — Civil + Sharia', 'Research', 'GC', ['research'],
    'Research treatment of "{{legal_issue}}" in {{gcc_country}}. Cover both civil-code (Federal Civil Code / Majalla) and Sharia angles, role of personal-status laws, DIFC/ADGM common-law alternatives if commercial.',
    ['gcc','sharia','dual-system'], 11),
  make('rs-sg-precedent-elite', 'Singapore Precedent Hierarchy Research', 'Research', 'SG', ['research'],
    'Research SG authorities on "{{issue}}". Hierarchy: Court of Appeal > Appellate Division (post-2021) > General Division. Note any English authorities still followed and SICC commercial-law decisions.',
    ['sg-case-law','sicc'], 18),
  make('rs-multi-jurisdiction-survey', 'Multi-Jurisdiction Comparative Survey', 'Research', 'IN', ['research'],
    'Compare treatment of "{{legal_concept}}" across IN, UK, US, EU, GC, SG. Use a 6-column matrix: governing instrument, scope, key elements, remedies, recent reforms, leading authority.',
    ['comparative','survey'], 31),

  // ─── Citizen-Facing (12) ──────────────────────────────────────────
  make('cf-in-rti-application', 'RTI Application Drafter (India)', 'Citizen-Facing', 'IN', ['citizen'],
    'Draft an RTI application under the Right to Information Act 2005 to the {{public_authority}} seeking information about {{subject}}. Include: applicant details, specific information sought (5–10 numbered queries), fee details, BPL declaration if applicable.',
    ['rti','citizen'], 312),
  make('cf-in-consumer-complaint', 'Consumer Complaint — DCDRC (India)', 'Citizen-Facing', 'IN', ['citizen','litigation'],
    'Draft a consumer complaint to the {{district_dcdrc}} against {{opposite_party}} for {{deficiency}} in {{goods_or_service}}. Cover: pecuniary jurisdiction (₹50L), territorial jurisdiction, deficiency particulars, reliefs (refund + compensation + costs).',
    ['consumer','dcdrc'], 245),
  make('cf-in-divorce-mutual', 'Mutual Consent Divorce Petition (Hindu Marriage Act §13B)', 'Citizen-Facing', 'IN', ['citizen','litigation'],
    'Draft a joint petition under Section 13B of the Hindu Marriage Act 1955 by {{petitioner_1}} and {{petitioner_2}}. Cover: marriage particulars, separation > 1 year, mutual consent, settlement terms (custody, alimony, property).',
    ['family','divorce','13b'], 178),
  make('cf-us-small-claims', 'Small Claims Court Demand Letter (US)', 'Citizen-Facing', 'US', ['citizen'],
    'Draft a small-claims demand letter from {{plaintiff}} to {{defendant}} for ${{amount}} arising from {{transaction}}. State deadline (14 days), consequences (suit in {{county}} small-claims court), preserved rights.',
    ['small-claims','demand'], 156),
  make('cf-us-tenant-rights', 'Tenant Rights Letter — Habitability', 'Citizen-Facing', 'US', ['citizen'],
    'Draft a tenant letter to landlord {{landlord}} demanding repair of {{habitability_issue}} at {{property_address}}. Reference state implied warranty of habitability, statutory repair-and-deduct or rent-withholding rights in {{state}}.',
    ['tenant','habitability'], 132),
  make('cf-uk-money-claim-online', 'UK Money Claim Online — Particulars', 'Citizen-Facing', 'UK', ['citizen'],
    'Draft particulars of claim for Money Claim Online (MCOL) by {{claimant}} against {{defendant}} for £{{amount}} arising from {{cause}}. Plain English, chronology, breach, loss, interest under s.69 County Courts Act.',
    ['mcol','small-claim'], 88),
  make('cf-uk-tribunal-employment', 'Employment Tribunal ET1 — Unfair Dismissal', 'Citizen-Facing', 'UK', ['citizen','litigation'],
    'Draft ET1 narrative for unfair-dismissal claim by {{claimant}} (employed {{start_date}}–{{end_date}}) against {{respondent}}. Cover: qualifying service (2 years), dismissal date, reason given, why unfair (ERA s.98), Acas Early Conciliation reference.',
    ['et1','unfair-dismissal'], 64),
  make('cf-eu-gdpr-sar', 'GDPR Subject Access Request Template', 'Citizen-Facing', 'EU', ['citizen','compliance'],
    'Draft a GDPR Art.15 Subject Access Request to {{controller}} on behalf of {{data_subject}}. Specify: scope of personal data sought, format (electronic), 1-month statutory response deadline, complaint route to {{supervisory_authority}}.',
    ['gdpr','sar'], 174),
  make('cf-eu-flight-delay-261', 'EU 261/2004 Flight Delay Compensation Letter', 'Citizen-Facing', 'EU', ['citizen'],
    'Draft a Regulation (EC) 261/2004 compensation claim letter from {{passenger}} to {{airline}} for flight {{flight_no}} on {{date}}. State delay duration, distance band, compensation due (€250/€400/€600), reject "extraordinary circumstances" defence boilerplate.',
    ['ec-261','consumer'], 112),
  make('cf-gc-labour-complaint', 'UAE MOHRE Labour Complaint Letter', 'Citizen-Facing', 'GC', ['citizen'],
    'Draft a labour complaint to UAE MOHRE on behalf of {{employee}} against {{employer}} for {{grievance}} (unpaid wages / wrongful termination / end-of-service gratuity). Cite Federal Decree-Law 33/2021, demand mediation referral.',
    ['uae-labour','mohre'], 39),
  make('cf-sg-cpf-complaint', 'Singapore CPF / MOM Complaint Drafter', 'Citizen-Facing', 'SG', ['citizen'],
    'Draft a complaint to Singapore MOM / CPF Board on behalf of {{employee}} against {{employer}} for non-payment of CPF contributions for the period {{period}}. Cite CPF Act, request investigation and back-payment with interest.',
    ['sg-cpf','mom'], 24),
  make('cf-sg-scribe-poa', 'Singapore Lasting Power of Attorney (LPA) Drafter', 'Citizen-Facing', 'SG', ['citizen'],
    'Draft a Singapore Lasting Power of Attorney (Form 1) appointing {{donee}} as donee for {{donor}}. Cover: personal welfare and/or property and affairs, replacement donees, conditions/restrictions, donee\'s certificate.',
    ['lpa','elder-law'], 17),
];

export function listPrompts(opts: {
  category?: string;
  jurisdiction?: string;
  agent?: string;
  q?: string;
  limit?: number;
  offset?: number;
} = {}): { rows: CuratedPrompt[]; total: number } {
  const { category, jurisdiction, agent, q } = opts;
  const limit = Math.min(2000, Math.max(1, opts.limit ?? 200));
  const offset = Math.max(0, opts.offset ?? 0);
  const ql = (q ?? '').trim().toLowerCase();
  const filtered = NV_PROMPT_LIBRARY.filter(p => {
    if (category && p.category !== category) return false;
    if (jurisdiction && p.jurisdiction !== jurisdiction) return false;
    if (agent && !p.agents.includes(agent)) return false;
    if (ql && !(p.name.toLowerCase().includes(ql) || p.template_body.toLowerCase().includes(ql) || p.tags.some(t => t.toLowerCase().includes(ql)))) return false;
    return true;
  });
  return { rows: filtered.slice(offset, offset + limit), total: filtered.length };
}

export function getPromptById(id: string): CuratedPrompt | undefined {
  return NV_PROMPT_LIBRARY.find(p => p.id === id || p.slug === id);
}

export const NV_PROMPT_CATEGORIES: PromptCategory[] = [
  'Litigation', 'Contract Review', 'Compliance', 'Research', 'Citizen-Facing',
];
export const NV_PROMPT_JURISDICTIONS: PromptJurisdiction[] = ['IN','US','UK','EU','GC','SG'];
