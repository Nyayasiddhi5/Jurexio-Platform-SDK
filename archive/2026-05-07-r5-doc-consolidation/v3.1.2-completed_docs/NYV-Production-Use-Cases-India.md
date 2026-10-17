---
status: completed
version: 3.1.2
superseded_by: null
last_verified: 2026-04-27T13:30Z
prior_last_verified: 2026-04-25
remediation_closeout: 2026-04-27
---
# Nyayavigya Platform 3.1.2 — Production Use Cases: Indian Jurisdiction

**Version**: 3.1.2 | **Date**: April 11, 2026 (reaffirmed 2026-04-27) | **Jurisdiction**: India (IN)
**Agents**: 149 ROMA L5 | **Patterns**: 22 Agentic | **Modules**: 8

> **2026-04-27 — Use-case relevance update.** The Indian-jurisdiction execution path described below is now live-validated against the post-2023 Indian criminal code on `nv-dev-edge` (EC2 `13.232.165.242` + RDS `nv-dev-edge-pg`). A representative `legal_research` query — *"Summarise BNS Section 318 cheating in 4 lines, citing the section"* — returned an HTTP 200 in **2476 ms** with `compliancePassed:true`, `hallucinationCheck.status:passed`, and a structured BNS-grounded answer (no Indian-Penal-Code drift). The two prior NSP launch blockers that affected these flows are CLOSED: the **content-filter false-positive** that was rejecting legitimate phrases like *"you should sue"* / *"file a case"* / *"bail guidance"* has been rewritten (HARD list trimmed to 14 strict-prescriptive terms; `legal advice` kept as a soft term, exempted when a disclaimer is present), and the **60-second SDK timeout** that was clipping ensemble + fallback paths has been raised to 120 seconds in the `outbound:llm` circuit-breaker. **Live IN statute corpus = 305 entries** today; growing this to ≥ 500 (incl. the full Constitution: Articles 1–395 + 12 Schedules; IT Act 2000; DPDPA 2023; Companies Act 2013; GST Acts; CPA 2019; RERA 2016; A&C 1996; NIA 1881) is tracked as follow-up FU-T004 — the use cases below assume that expansion in any retrieval-grounded flow citation count.

---

## EXECUTION ARCHITECTURE

Every use case follows this production flow:

```
User Request
    |
    v
ns-queen (Master Orchestrator)
    |
    +-- 1. Task Classification (practice_area, complexity, jurisdiction)
    +-- 2. Routing Algorithm Selection (SIMPLE / ACONIC / ADaPT / HTA / SWARM)
    +-- 3. Budget Check (token limits, monthly cap)
    +-- 4. Agent Selection (BM25 + performance ranking)
    +-- 5. HITL Gate (risk tier → human approval if critical)
    |
    v
Selected Agent(s) Execute
    |
    +-- System Prompt (Universal Base + Role Delta)
    +-- LLM Call (OpenRouter → Claude/GPT/Gemini with auto-failover)
    +-- NyayaRAG (pgvector HNSW, BM-25 hybrid search)
    +-- Guardrails (PII redaction, citation check, anti-hallucination)
    +-- Memory (conversation context, case history)
    |
    v
Response Pipeline
    |
    +-- Citation Verification
    +-- Compliance Check (DPDPA 2023, BNS 2023)
    +-- Audit Log (hash chain)
    +-- Response to User
```

### Routing Algorithms

| Algorithm | When Used | Agents |
|-----------|-----------|--------|
| SIMPLE | Single-agent tasks (research, Q&A) | 1 |
| ACONIC | Sequential multi-step (draft + review) | 2-3 |
| ADaPT | Adaptive complexity (compliance audit) | 3-5 |
| HTA | Hierarchical task decomposition (M&A due diligence) | 5-10 |
| SWARM | Full swarm (complex litigation, cross-border) | 10+ |

---

## CATEGORY 1: CONTRACT LAW (Use Cases 1-8)

### UC-01: NDA Drafting for IT Company

**Scenario**: Bangalore-based IT startup needs a mutual NDA with a US partner.

**Agents Involved**:
- `ns-queen` → routes to ACONIC (sequential draft + review)
- `contract-specialist` → analyzes NDA requirements
- `contract-drafting` → generates NDA with Indian Contract Act 1872 clauses
- `contract-review` → reviews for enforceability
- `cross-border-transactions` → adds US-India cross-border provisions

**Flow**:
1. User submits: `{ "documentType": "NDA", "parties": ["TechStart Pvt Ltd", "US Corp Inc"], "jurisdiction": "IN", "crossBorder": true }`
2. `ns-queen` classifies → practice_area: contract, complexity: moderate, routing: ACONIC
3. `contract-drafting` generates NDA using Indian Contract Act 1872 §§ 10-75
4. Adds DPDPA 2023 data protection clause for cross-border data transfer
5. `cross-border-transactions` adds ICC arbitration clause (seat: Singapore)
6. `contract-review` validates enforceability under both jurisdictions
7. NyayaRAG retrieves relevant SC precedents on enforceability
8. Response: Complete NDA with 12 clauses, risk annotations, citation links

**API Call**:
```
POST /api/nv/gateway/documents/draft
Authorization: Bearer nyv_live_sk_...
{
  "documentType": "NDA",
  "parties": ["TechStart Pvt Ltd", "US Corp Inc"],
  "jurisdiction": "IN",
  "crossBorder": true,
  "governingLaw": "Indian Contract Act 1872"
}
```

**Indian Law References**: Indian Contract Act 1872 §§ 10-75, DPDPA 2023 § 16 (cross-border transfer), IT Act 2000 § 72A (data breach penalty)

---

### UC-02: Employment Agreement with Non-Compete

**Scenario**: Mumbai law firm drafting employment agreement for senior associate.

**Agents**: `contract-drafting`, `employment-contracts`, `labour-compliance`, `posh-compliance`
**Routing**: ACONIC (sequential)

**Flow**:
1. `employment-contracts` drafts agreement per Indian Labour Codes 2020
2. Non-compete clause crafted per Indian Contract Act § 27 (restraint of trade — void in India)
3. `labour-compliance` validates against Industrial Relations Code 2020
4. `posh-compliance` adds mandatory POSH policy reference per POSH Act 2013
5. NyayaRAG retrieves: *Niranjan Shankar Golikari v Century Spinning* (non-compete enforceability)

**Indian Law References**: Indian Contract Act 1872 § 27, Industrial Relations Code 2020, POSH Act 2013, Shops & Establishment Act (state-specific)

---

### UC-03: Service Agreement with SLA Clauses

**Scenario**: Pune SaaS company creating service agreement with government client.

**Agents**: `contract-drafting`, `contract-risk`, `government-contracts`, `procurement-agent`
**Routing**: ADaPT (adaptive — government contracts have extra compliance)

**Flow**:
1. `government-contracts` validates GeM (Government e-Marketplace) compliance
2. `contract-drafting` generates agreement with SLA matrix
3. `contract-risk` flags risk in penalty clauses, suggests caps per CPC § 73 (damages)
4. `procurement-agent` validates Public Procurement Policy 2017 compliance
5. Adds mandatory clauses: integrity pact, MSE preference, Make in India provisions

**Indian Law References**: Indian Contract Act 1872, General Financial Rules 2017, Public Procurement Policy 2017, IT Act 2000

---

### UC-04: Franchise Agreement for Restaurant Chain

**Agents**: `contract-drafting`, `ip-specialist`, `trademark-agent`, `gst-agent`
**Routing**: ACONIC

**Flow**:
1. `contract-drafting` creates franchise agreement template
2. `ip-specialist` adds trademark licensing clauses per Trademarks Act 1999
3. `trademark-agent` validates IP protection across jurisdictions
4. `gst-agent` adds GST compliance clauses (franchise fee = service, 18% GST)
5. NyayaRAG retrieves: FEMA 2000 provisions for foreign franchisor payments

**Indian Law References**: Trademarks Act 1999, CGST Act 2017 § 7, FEMA 2000, Competition Act 2002

---

### UC-05: Vendor Contract Risk Analysis

**Agents**: `contract-review`, `contract-risk`, `compliance-lead`
**Routing**: SIMPLE → escalates to ACONIC if high-risk clauses found

**Flow**:
1. User uploads vendor contract PDF
2. `document-intelligence-agent` performs OCR and entity extraction
3. `contract-review` clause-by-clause analysis (indemnity, limitation of liability, termination)
4. `contract-risk` scores each clause: GREEN (safe), AMBER (review), RED (high risk)
5. Flags: unlimited indemnity → RED, no IP assignment → AMBER
6. Generates risk matrix with suggested alternative language

---

### UC-06: Share Purchase Agreement (SPA)

**Agents**: `mergers-acquisitions`, `corporate-specialist`, `tax-specialist`, `stamp-duty-calculator`
**Routing**: HTA (hierarchical — complex M&A document)

**Flow**:
1. `mergers-acquisitions` structures the SPA per Companies Act 2013
2. `tax-specialist` adds tax indemnity clauses (capital gains under IT Act § 45)
3. `stamp-duty-calculator` computes state-specific stamp duty (varies by state)
4. Adds SEBI (SAST) Regulations 2011 compliance for listed company acquisitions
5. `corporate-compliance` validates CCI filing thresholds under Competition Act 2002

**Indian Law References**: Companies Act 2013 §§ 230-240, Income Tax Act 1961 § 45, 47, 48, SEBI SAST Regulations 2011, Competition Act 2002 §§ 5-6

---

### UC-07: Technology License Agreement

**Agents**: `ip-specialist`, `patent-agent`, `contract-drafting`, `tax-specialist`
**Routing**: ACONIC

**Flow**:
1. `ip-specialist` structures technology licensing terms
2. `patent-agent` validates patent claims per Patents Act 1970
3. Adds Technology Transfer Pricing documentation (IT Act § 92CE)
4. `tax-specialist` adds withholding tax clause (Section 195 — NRI payments)
5. FEMA compliance for royalty payments to foreign entity

**Indian Law References**: Patents Act 1970, Copyright Act 1957, FEMA 2000, IT Act 1961 §§ 92CE, 195

---

### UC-08: Joint Venture Agreement

**Agents**: `mergers-acquisitions`, `corporate-governance`, `competition-specialist`, `fdi-agent`
**Routing**: HTA

**Flow**:
1. `mergers-acquisitions` drafts JV framework
2. `fdi-agent` validates FDI sector caps per FEMA and DPIIT Press Notes
3. `competition-specialist` checks CCI combination filing requirements
4. `corporate-governance` adds board composition and deadlock resolution clauses
5. Adds exit mechanisms: put/call options, drag-along/tag-along rights

**Indian Law References**: Companies Act 2013, FEMA 2000, FDI Policy 2020, Competition Act 2002

---

## CATEGORY 2: LITIGATION (Use Cases 9-16)

### UC-09: Written Statement Drafting (Civil Suit)

**Agents**: `litigation-specialist`, `pleading-draft`, `litigation-research`, `limitation-calculator`
**Routing**: ACONIC

**Flow**:
1. User provides plaint details and facts
2. `limitation-calculator` verifies limitation period per Limitation Act 1963
3. `litigation-research` retrieves relevant precedents via NyayaRAG
4. `pleading-draft` drafts written statement per CPC Order VIII Rule 1
5. Adds specific denials, counter-claims, set-off per CPC §§ 3-4
6. `litigation-risk` assesses merits and success probability

**Indian Law References**: CPC 1908 Order VIII, Limitation Act 1963, Evidence Act 1872

---

### UC-10: Bail Application Drafting

**Agents**: `criminal-specialist`, `bail-applications`, `criminal-research`, `fir-analysis`
**Routing**: ADaPT (high-risk — liberty involved)

**Flow**:
1. `fir-analysis` analyzes FIR copy for offence classification under BNS 2023
2. Maps IPC sections to BNS equivalents (IPC 302 → BNS 103, IPC 420 → BNS 318)
3. `criminal-research` retrieves bail jurisprudence via NyayaRAG
4. Key precedents: *Arnesh Kumar v State of Bihar* (2014), *Saurav Das v State* (anticipatory bail)
5. `bail-applications` drafts bail application per CrPC § 437/439 (now BNSS §§ 478-483)
6. HITL gate activated (risk tier: critical — criminal matter)

**Indian Law References**: BNS 2023, BNSS 2023 §§ 478-483, BSA 2023, Supreme Court guidelines on bail

---

### UC-11: Consumer Complaint Filing

**Agents**: `consumer-specialist`, `consumer-disputes`, `pleading-draft`, `unfair-trade-agent`
**Routing**: SIMPLE → ACONIC

**Flow**:
1. `consumer-specialist` classifies: deficiency in service vs defective goods
2. Determines forum: District (< 1Cr), State (1Cr-10Cr), National (> 10Cr)
3. `pleading-draft` drafts complaint per Consumer Protection Act 2019 § 35
4. `unfair-trade-agent` identifies unfair trade practices under CPA 2019 § 2(47)
5. Calculates limitation: 2 years from cause of action per CPA § 69

**Indian Law References**: Consumer Protection Act 2019, CPA Rules 2020, E-Commerce Rules 2020

---

### UC-12: Writ Petition (Article 226)

**Agents**: `constitutional-specialist`, `writ-petitions`, `litigation-research`, `judicial-review`
**Routing**: HTA (constitutional matters require thorough research)

**Flow**:
1. `constitutional-specialist` identifies fundamental right violation
2. `judicial-review` classifies writ type: Mandamus, Certiorari, Habeas Corpus, Quo Warranto, Prohibition
3. `litigation-research` retrieves constitutional law precedents
4. Key precedents: *Maneka Gandhi v UOI* (Art. 21 expanded), *MC Mehta v UOI* (Art. 21 environment)
5. `writ-petitions` drafts petition with prayer clauses
6. HITL gate: constitutional matters always require lawyer review

**Indian Law References**: Constitution of India Articles 14, 19, 21, 226, 32

---

### UC-13: Arbitration Clause Drafting & Dispute

**Agents**: `arbitration-specialist`, `arbitration-drafting`, `arbitration-proceedings`, `arbitration-enforcement`
**Routing**: ACONIC

**Flow**:
1. `arbitration-drafting` creates institutional arbitration clause (SIAC/MCIA)
2. References Arbitration & Conciliation Act 1996 (as amended 2019)
3. `arbitration-proceedings` outlines procedure: notice, appointment, hearings
4. `arbitration-enforcement` validates enforcement per Part II (NY Convention awards)
5. Adds emergency arbitrator provisions per SIAC Rules

**Indian Law References**: Arbitration & Conciliation Act 1996 (amended 2019, 2021), New York Convention 1958

---

### UC-14: PIL (Public Interest Litigation) Drafting

**Agents**: `constitutional-specialist`, `pil-specialist`, `litigation-research`
**Routing**: ADaPT

**Flow**:
1. `pil-specialist` validates locus standi per *SP Gupta v UOI* guidelines
2. Identifies Article 21/14 violations
3. `litigation-research` retrieves PIL success patterns
4. Drafts PIL with detailed factual matrix and prayer
5. HITL gate: mandatory for constitutional litigation

**Indian Law References**: Constitution Articles 32, 226, Supreme Court Rules 2013

---

### UC-15: Motor Accident Claims Tribunal (MACT) Petition

**Agents**: `litigation-specialist`, `pleading-draft`, `limitation-calculator`
**Routing**: SIMPLE

**Flow**:
1. `pleading-draft` drafts MACT petition per Motor Vehicles Act 2019 § 166
2. Calculates compensation using Sarla Verma formula (multiplier method)
3. NyayaRAG retrieves: *National Insurance v Pranay Sethi* (structured formula)
4. Adds structured computation: loss of income, pain, suffering, funeral expenses
5. `limitation-calculator`: no limitation for MACT claims

**Indian Law References**: Motor Vehicles Act 2019 §§ 163-175, Sarla Verma multiplier

---

### UC-16: Cheque Bounce (NI Act § 138) Complaint

**Agents**: `criminal-specialist`, `pleading-draft`, `limitation-calculator`
**Routing**: SIMPLE

**Flow**:
1. Validates prerequisites: demand notice within 30 days, 15-day waiting period
2. `limitation-calculator`: complaint within 30 days of notice expiry → 75 days total
3. `pleading-draft` drafts complaint per NI Act § 138 format
4. NyayaRAG: *Dashrath Rupsingh Rathod v State* (territorial jurisdiction)
5. Generates evidence checklist: cheque copy, return memo, demand notice, postal receipt

**Indian Law References**: Negotiable Instruments Act 1881 §§ 138-142, CrPC § 200 (now BNSS § 223)

---

## CATEGORY 3: CORPORATE LAW (Use Cases 17-24)

### UC-17: Company Incorporation

**Agents**: `corporate-specialist`, `corporate-secretarial`, `tax-specialist`, `mca21-connector`
**Routing**: ACONIC

**Flow**:
1. `corporate-specialist` recommends: Pvt Ltd (recommended), LLP, OPC based on needs
2. `mca21-connector` checks name availability on MCA portal
3. Generates: MOA, AOA, DIR-12, SPICe+ form inputs
4. `tax-specialist` obtains PAN/TAN requirements
5. `corporate-secretarial` creates post-incorporation compliance checklist

**Indian Law References**: Companies Act 2013 §§ 3-22, Companies (Incorporation) Rules 2014, LLP Act 2008

---

### UC-18: Board Resolution for Loan Authorization

**Agents**: `corporate-governance`, `corporate-secretarial`, `banking-specialist`, `loan-documentation`
**Routing**: ACONIC

**Flow**:
1. `corporate-governance` validates board composition and quorum (CA § 174)
2. `corporate-secretarial` drafts board resolution with specific authorization
3. `loan-documentation` creates term sheet review
4. `banking-specialist` validates RBI compliance for borrowing limits
5. Adds necessary CERSAI registration requirements

**Indian Law References**: Companies Act 2013 §§ 174, 179, 180, RBI Master Directions

---

### UC-19: SEBI Compliance for Listed Company

**Agents**: `corporate-compliance`, `regulatory-monitor`, `analytics-agent`
**Routing**: ADaPT

**Flow**:
1. `regulatory-monitor` checks latest SEBI circulars
2. `corporate-compliance` validates LODR compliance (Regulation 30, 33, 46)
3. Generates compliance calendar for quarterly filings
4. `analytics-agent` dashboard: insider trading alerts, UPSI monitoring
5. Flags: related party transactions requiring audit committee approval

**Indian Law References**: SEBI LODR Regulations 2015, SEBI PIT Regulations 2015, Companies Act 2013 § 188

---

### UC-20: DPDPA 2023 Compliance Assessment

**Agents**: `data-protection-agent`, `compliance-lead`, `cyber-specialist`, `privacy-technology-agent`
**Routing**: HTA (comprehensive assessment)

**Flow**:
1. `data-protection-agent` maps data processing activities to DPDPA categories
2. Identifies: Data Fiduciary obligations, Consent Manager requirements
3. `privacy-technology-agent` recommends technical measures (encryption, pseudonymization)
4. `compliance-lead` generates gap analysis: current state vs DPDPA requirements
5. Creates: Data Protection Impact Assessment (DPIA), consent framework, breach notification SOP

**Indian Law References**: DPDPA 2023, Digital Personal Data Protection Rules 2025 (draft), IT Act 2000 § 43A

---

### UC-21: ESG Compliance Report

**Agents**: `esg-agent`, `env-compliance`, `corporate-governance`, `analytics-agent`
**Routing**: ADaPT

**Flow**:
1. `esg-agent` structures BRSR (Business Responsibility and Sustainability Report)
2. `env-compliance` validates environmental clearances and compliance
3. `corporate-governance` maps governance metrics per SEBI LODR
4. `analytics-agent` computes ESG score across parameters
5. Generates BRSR Core framework compliance report

**Indian Law References**: SEBI BRSR Framework 2023, Environment Protection Act 1986, Companies Act 2013 § 135 (CSR)

---

### UC-22: GST Registration and Compliance

**Agents**: `gst-agent`, `tax-compliance`, `regulatory-monitor`
**Routing**: SIMPLE

**Flow**:
1. `gst-agent` determines registration requirement (threshold: Rs 40L goods, Rs 20L services)
2. Generates GST registration checklist and form inputs
3. `tax-compliance` creates monthly/quarterly return calendar (GSTR-1, GSTR-3B)
4. `regulatory-monitor` tracks GST council notifications
5. E-invoicing compliance for turnover > Rs 5 Cr

**Indian Law References**: CGST Act 2017, SGST Acts, GST Rules 2017, E-invoicing Rules

---

### UC-23: Transfer Pricing Documentation

**Agents**: `transfer-pricing-agent`, `tax-specialist`, `analytics-agent`
**Routing**: ADaPT

**Flow**:
1. `transfer-pricing-agent` identifies associated enterprise transactions
2. Selects Most Appropriate Method (MAM): CUP, RPM, CPM, TNMM, PSM
3. `analytics-agent` performs benchmarking analysis
4. Generates: Master File, Local File, CbCR as per Rule 10DA/10DB
5. `tax-specialist` validates APA (Advance Pricing Agreement) eligibility

**Indian Law References**: Income Tax Act 1961 §§ 92-92F, Transfer Pricing Rules 10A-10TG

---

### UC-24: CCI Merger Filing Assessment

**Agents**: `competition-specialist`, `cci-compliance`, `merger-clearance`, `analytics-agent`
**Routing**: ACONIC

**Flow**:
1. `cci-compliance` checks combination thresholds: assets > Rs 2000 Cr or turnover > Rs 6000 Cr
2. `merger-clearance` determines: no filing / green channel / regular filing
3. `competition-specialist` analyzes AAEC (Appreciable Adverse Effect on Competition)
4. Generates Form I (short form) or Form II (long form) inputs
5. Timeline: CCI must decide within 210 days

**Indian Law References**: Competition Act 2002 §§ 5-6, CCI Combination Regulations 2011 (amended 2023)

---

## CATEGORY 4: REAL ESTATE & PROPERTY (Use Cases 25-30)

### UC-25: Property Due Diligence Report

**Agents**: `realestate-specialist`, `property-due-diligence`, `rera-compliance`, `env-compliance`
**Routing**: HTA

**Flow**:
1. `property-due-diligence` creates title search checklist (30-year chain of title)
2. Verifies encumbrances via sub-registrar records
3. `rera-compliance` checks RERA registration status for under-construction property
4. `env-compliance` validates environmental clearances (CRZ, forest clearance if applicable)
5. Generates: Title Opinion, Risk Matrix, Encumbrance Certificate analysis

**Indian Law References**: Transfer of Property Act 1882, Registration Act 1908, RERA 2016, Environment Protection Act 1986

---

### UC-26: Sale Deed Drafting

**Agents**: `property-drafting`, `stamp-duty-calculator`, `realestate-specialist`
**Routing**: ACONIC

**Flow**:
1. `property-drafting` drafts sale deed per Transfer of Property Act § 54
2. `stamp-duty-calculator` computes stamp duty (state-specific: MH 5%, KA 5.6%, DL 4-6%)
3. Adds TDS clause (1% TDS on sale > Rs 50L per IT Act § 194IA)
4. Validates: vendor's right to sell, FEMA compliance for NRI buyers
5. Generates registration checklist

**Indian Law References**: Transfer of Property Act 1882 § 54, Registration Act 1908 § 17, IT Act § 194IA

---

### UC-27: RERA Complaint Filing

**Agents**: `rera-compliance`, `consumer-specialist`, `pleading-draft`
**Routing**: SIMPLE

**Flow**:
1. `rera-compliance` validates RERA registration of builder/project
2. Identifies violation: delayed possession, structural defect, RERA violation
3. `pleading-draft` drafts complaint to RERA Authority
4. Calculates interest per RERA § 18 (SBI PLR + 2% for delay)
5. Alternative: refund with interest computation

**Indian Law References**: RERA 2016 §§ 12-19, 31-32, RERA Rules (state-specific)

---

### UC-28: Landlord-Tenant Eviction Notice

**Agents**: `realestate-specialist`, `property-drafting`, `realestate-disputes`
**Routing**: SIMPLE

**Flow**:
1. `realestate-specialist` identifies applicable Rent Control Act (state-specific)
2. `property-drafting` drafts eviction notice per applicable grounds
3. Grounds: non-payment, personal occupation, subletting, nuisance
4. `realestate-disputes` advises on process: notice → suit → decree

**Indian Law References**: State Rent Control Acts (varies), Transfer of Property Act § 106, CPC Order 37

---

### UC-29: Lease Agreement (Commercial)

**Agents**: `property-drafting`, `stamp-duty-calculator`, `gst-agent`
**Routing**: ACONIC

**Flow**:
1. `property-drafting` creates commercial lease with standard clauses
2. `stamp-duty-calculator` computes stamp duty on annual rent × lease term
3. `gst-agent` adds GST clause (18% on commercial lease rent)
4. Adds lock-in period, escalation clause (typically 5-10% annual)
5. TDS applicability: 10% TDS on rent > Rs 2.4L/year per IT Act § 194I

**Indian Law References**: Transfer of Property Act § 105-117, Registration Act § 17(1)(d), CGST Act 2017

---

### UC-30: Construction Agreement with Builder

**Agents**: `property-drafting`, `rera-compliance`, `contract-risk`
**Routing**: ACONIC

**Flow**:
1. `property-drafting` drafts construction agreement
2. `rera-compliance` ensures RERA-compliant terms (possession date, penalties)
3. `contract-risk` flags: one-sided termination, unlimited variation, no quality standards
4. Adds payment milestone schedule linked to construction stages
5. Includes arbitration clause per A&C Act 1996

**Indian Law References**: RERA 2016, Indian Contract Act 1872, Arbitration Act 1996

---

## CATEGORY 5: CRIMINAL LAW (Use Cases 31-36)

### UC-31: FIR Analysis & Legal Strategy

**Agents**: `criminal-specialist`, `fir-analysis`, `criminal-research`, `bail-applications`
**Routing**: ADaPT

**Flow**:
1. `fir-analysis` parses FIR: sections invoked, facts alleged, jurisdiction
2. Maps to BNS 2023 equivalents (auto-conversion from IPC)
3. `criminal-research` retrieves: quashing precedents, bail conditions
4. Strategy recommendation: anticipatory bail vs regular bail vs quashing
5. Key jurisprudence: *Lalita Kumari v State* (mandatory FIR registration)

**Indian Law References**: BNS 2023, BNSS 2023, BSA 2023, CrPC (for historical cases)

---

### UC-32: Criminal Appeal Drafting

**Agents**: `criminal-specialist`, `criminal-appeals`, `litigation-research`
**Routing**: ACONIC

**Flow**:
1. `criminal-appeals` analyzes judgment for appealable grounds
2. Identifies: error of law, error of fact, procedural irregularity, excessive sentence
3. `litigation-research` retrieves appeal success precedents
4. Drafts appeal memo with grounds, prayer
5. `limitation-calculator`: 30 days for Sessions, 90 days for High Court

**Indian Law References**: BNSS 2023 §§ 399-432, Constitution Article 134-136

---

### UC-33: Cybercrime Complaint & Response

**Agents**: `cyber-specialist`, `cyber-incident`, `cyber-forensics`, `criminal-specialist`
**Routing**: ADaPT

**Flow**:
1. `cyber-incident` classifies: phishing, data breach, ransomware, identity theft
2. `cyber-forensics` creates evidence preservation checklist
3. `criminal-specialist` drafts complaint to Cyber Crime Cell
4. References IT Act 2000 sections: § 43 (unauthorized access), § 66 (computer offences), § 66C (identity theft)
5. Maps to BNS: § 318 (cheating), § 319 (cheating by personation)

**Indian Law References**: IT Act 2000 §§ 43-66D, BNS 2023 §§ 318-319, CERT-In directions 2022

---

### UC-34: Domestic Violence Protection Order

**Agents**: `family-specialist`, `pleading-draft`, `criminal-research`
**Routing**: SIMPLE

**Flow**:
1. `family-specialist` identifies: physical, sexual, verbal, emotional, economic abuse
2. `pleading-draft` drafts application under DV Act § 12
3. Relief sought: protection order, residence order, monetary relief, custody
4. Adds: evidence checklist, magistrate court procedure
5. NyayaRAG: *Hiral P Harsora v Kusum Narottamdas* (expanded definition)

**Indian Law References**: Protection of Women from Domestic Violence Act 2005, BNS 2023 § 85-86

---

### UC-35: NDPS Act Defence Strategy

**Agents**: `criminal-specialist`, `criminal-research`, `bail-applications`
**Routing**: ADaPT (high-risk)

**Flow**:
1. Classifies: small quantity vs commercial quantity per NDPS Schedule
2. `criminal-research` retrieves mandatory minimum sentence provisions
3. Bail analysis: NDPS § 37 restrictions (twin conditions)
4. Key jurisprudence: *Tofan Singh v State* (confessional statements)
5. HITL gate: mandatory for NDPS matters

**Indian Law References**: NDPS Act 1985 §§ 15-37, BNS correlations for consumption quantities

---

### UC-36: White Collar Crime Investigation Response

**Agents**: `criminal-specialist`, `aml-specialist`, `corporate-compliance`, `cyber-forensics`
**Routing**: HTA (complex investigation)

**Flow**:
1. `aml-specialist` analyzes PMLA applicability (money laundering)
2. `corporate-compliance` reviews Companies Act fraud provisions (§ 447)
3. `cyber-forensics` creates digital evidence preservation plan
4. Strategy: cooperation vs privilege assertion
5. Generates: privilege log, document hold notice, compliance timeline

**Indian Law References**: PMLA 2002, Companies Act 2013 § 447, Prevention of Corruption Act 1988, BNS §§ 316-318

---

## CATEGORY 6: FAMILY LAW (Use Cases 37-42)

### UC-37: Mutual Consent Divorce Petition

**Agents**: `family-specialist`, `family-divorce`, `family-mediation`, `child-custody`
**Routing**: ACONIC

**Flow**:
1. `family-divorce` determines applicable law: Hindu Marriage Act / Special Marriage Act / Muslim Personal Law
2. Drafts petition per HMA § 13B (mutual consent)
3. `child-custody` addresses custody arrangement per Guardian & Wards Act 1890
4. `family-mediation` recommends mediation under CPC § 89
5. Mandatory 6-month cooling period per HMA § 13B(2)

**Indian Law References**: Hindu Marriage Act 1955 § 13B, Guardian & Wards Act 1890, Family Courts Act 1984

---

### UC-38: Maintenance Application (Hindu Law)

**Agents**: `family-specialist`, `pleading-draft`, `succession-planning`
**Routing**: SIMPLE

**Flow**:
1. Determines forum: Family Court / Magistrate Court
2. `pleading-draft` drafts maintenance application under HMA § 24 (interim) and § 25 (permanent)
3. Alternatively: CrPC § 125 (now BNSS § 144) for all religious groups
4. NyayaRAG: *Rajnesh v Neha* (SC guidelines on maintenance computation)
5. Generates income-expenditure statement format

**Indian Law References**: HMA § 24-25, BNSS § 144, Hindu Adoptions & Maintenance Act 1956

---

### UC-39: Succession Certificate Application

**Agents**: `succession-planning`, `family-specialist`, `stamp-duty-calculator`
**Routing**: SIMPLE

**Flow**:
1. Determines: Indian Succession Act (for Christians, Parsis) or Hindu Succession Act
2. `succession-planning` drafts application per Indian Succession Act § 372
3. `stamp-duty-calculator` computes court fees
4. Creates legal heir certificate alternative for simpler cases
5. Adds: No Objection Certificates from other legal heirs

**Indian Law References**: Indian Succession Act 1925, Hindu Succession Act 1956 (amended 2005), Court Fees Act

---

### UC-40: Child Custody Dispute

**Agents**: `child-custody`, `family-specialist`, `litigation-research`
**Routing**: ADaPT

**Flow**:
1. `child-custody` analyzes: welfare of child doctrine (paramount consideration)
2. Applicable law: Hindu Minority & Guardianship Act / Guardian & Wards Act
3. `litigation-research` retrieves: *Gaurav Nagpal v Sumedha Nagpal* (welfare test)
4. Addresses: visitation rights, school proximity, child's preference (if > 9 years)
5. Recommends: family counselling per Family Courts Act

**Indian Law References**: Hindu Minority & Guardianship Act 1956, Guardian & Wards Act 1890

---

### UC-41: Domestic Will Drafting

**Agents**: `succession-planning`, `property-drafting`, `tax-specialist`
**Routing**: SIMPLE

**Flow**:
1. `succession-planning` drafts will per Indian Succession Act § 59
2. Validates testamentary capacity and attestation requirements (2 witnesses)
3. `property-drafting` adds property schedules with proper identification
4. `tax-specialist` advises on inheritance tax implications (currently nil in India)
5. Recommends: will registration (optional but recommended)

**Indian Law References**: Indian Succession Act 1925 §§ 59-75, Registration Act 1908 § 18 (optional registration)

---

### UC-42: Hindu Undivided Family (HUF) Formation

**Agents**: `family-specialist`, `tax-specialist`, `income-tax-agent`
**Routing**: ACONIC

**Flow**:
1. `family-specialist` validates HUF eligibility (coparcenary requirement)
2. Creates HUF deed with karta designation
3. `income-tax-agent` guides PAN application for HUF
4. `tax-specialist` explains tax benefits: separate § 80C deduction, basic exemption
5. Adds: partition rules, succession implications post-2005 amendment

**Indian Law References**: Hindu Succession Act 1956, Income Tax Act 1961 § 171, Hindu law principles

---

## CATEGORY 7: BANKING & FINANCE (Use Cases 43-48)

### UC-43: Loan Agreement Review

**Agents**: `banking-specialist`, `loan-documentation`, `contract-review`, `regulatory-banking`
**Routing**: ACONIC

**Flow**:
1. `loan-documentation` reviews term sheet compliance
2. `contract-review` flags: reset clause risks, prepayment penalties, margin calls
3. `regulatory-banking` validates RBI Fair Practice Code compliance
4. Checks: MCLR/EBLR benchmarking, processing fee caps
5. Generates: borrower rights summary, comparison matrix

**Indian Law References**: RBI Master Directions, SARFAESI Act 2002, Indian Contract Act

---

### UC-44: NBFC Compliance Assessment

**Agents**: `fintech-compliance`, `regulatory-banking`, `regulatory-monitor`, `aml-specialist`
**Routing**: ADaPT

**Flow**:
1. `fintech-compliance` maps NBFC-ICC / NBFC-MFI / NBFC-P2P classification
2. `regulatory-banking` validates prudential norms compliance (CRAR, NPA recognition)
3. `aml-specialist` checks KYC/AML compliance per PMLA Rules
4. `regulatory-monitor` tracks latest RBI circulars
5. Generates: compliance matrix, filing calendar, board report format

**Indian Law References**: RBI Act 1934, NBFC Regulations 2007, PMLA 2002, RBI Scale-Based Regulation 2021

---

### UC-45: Digital Lending Compliance

**Agents**: `fintech-compliance`, `data-protection-agent`, `regulatory-banking`
**Routing**: ACONIC

**Flow**:
1. `fintech-compliance` validates RBI Digital Lending Guidelines 2022
2. `data-protection-agent` checks data collection consent per DPDPA
3. Validates: no-third-party access to borrower's phone, FLDG limits (5%)
4. LSP (Lending Service Provider) agreement compliance
5. Generates: KYC flow compliance report, grievance redressal mechanism

**Indian Law References**: RBI Digital Lending Guidelines 2022, DPDPA 2023, IT Act 2000

---

### UC-46: SARFAESI Notice Drafting

**Agents**: `banking-specialist`, `debt-restructuring`, `loan-documentation`
**Routing**: SIMPLE

**Flow**:
1. `banking-specialist` validates SARFAESI applicability (secured debt > Rs 20L)
2. `loan-documentation` drafts § 13(2) notice (60-day demand notice)
3. Calculates total outstanding: principal + interest + penal interest
4. Validates: borrower response timeline, DRT appeal provisions
5. Post-notice action: symbolic possession, sale notice under § 13(4)

**Indian Law References**: SARFAESI Act 2002 §§ 13-19, DRT Act 1993, RBI Asset Classification norms

---

### UC-47: IBC Insolvency Application

**Agents**: `insolvency-specialist`, `ibc-agent`, `creditor-rights`, `restructuring-plan`
**Routing**: HTA

**Flow**:
1. `ibc-agent` determines: CIRP (§ 7/9/10) vs Pre-Packaged (§ 54A-54P)
2. `creditor-rights` validates: minimum default (Rs 1 Cr), limitation
3. `restructuring-plan` drafts resolution plan framework
4. Creates NCLT application with supporting documents
5. Timeline: 180 + 90 days resolution, 330 days max

**Indian Law References**: IBC 2016 §§ 7-12, 54A-54P, IBBI Regulations, Companies Act 2013

---

### UC-48: UPI/Payment System Dispute Resolution

**Agents**: `fintech-compliance`, `consumer-specialist`, `regulatory-banking`
**Routing**: SIMPLE

**Flow**:
1. `fintech-compliance` identifies: PSS Act provisions, NPCI circular requirements
2. `consumer-specialist` drafts complaint to bank → NPCI → RBI Ombudsman
3. Escalation path: Bank (T+5) → NPCI (T+15) → Banking Ombudsman (T+30)
4. `regulatory-banking` references RBI Integrated Ombudsman Scheme 2021
5. Generates: complaint format, evidence checklist, timeline tracker

**Indian Law References**: Payment & Settlement Systems Act 2007, RBI Ombudsman Scheme 2021

---

## CATEGORY 8: INTELLECTUAL PROPERTY (Use Cases 49-52)

### UC-49: Patent Application Drafting

**Agents**: `ip-specialist`, `patent-agent`, `litigation-research`
**Routing**: ACONIC

**Flow**:
1. `ip-specialist` determines: provisional vs complete specification
2. `patent-agent` structures claims per Patents Act 1970 (amended 2005)
3. Prior art search via NyayaRAG (Indian Patent Office database references)
4. Validates patentability: novelty, inventive step, industrial applicability
5. Generates: Form 1, Form 2 (specification), Form 3 (foreign filing info)

**Indian Law References**: Patents Act 1970 §§ 3-5 (non-patentable), 10 (specification), 48 (rights)

---

### UC-50: Trademark Opposition

**Agents**: `trademark-agent`, `ip-enforcement`, `litigation-research`
**Routing**: ACONIC

**Flow**:
1. `trademark-agent` analyzes: phonetic similarity, visual similarity, trade channel overlap
2. `ip-enforcement` drafts notice of opposition per Trademarks Act § 21
3. `litigation-research` retrieves: *Cadila Healthcare v Cadila Pharma* (deceptive similarity test)
4. Arguments: prior use, descriptive mark, bad faith, confusion likelihood
5. Timeline: opposition within 4 months of journal publication

**Indian Law References**: Trademarks Act 1999 §§ 9-11, 21, 29, Trademarks Rules 2017

---

### UC-51: Copyright Infringement Takedown

**Agents**: `copyright-agent`, `ip-enforcement`, `cyber-specialist`
**Routing**: SIMPLE

**Flow**:
1. `copyright-agent` validates ownership and registration status
2. `ip-enforcement` drafts DMCA-equivalent takedown under IT Act § 79
3. `cyber-specialist` identifies ISP intermediary for notice
4. Generates: takedown notice, evidence documentation, counter-notice guidance
5. Court option: injunction under Copyright Act § 55

**Indian Law References**: Copyright Act 1957 §§ 51-55, IT Act 2000 § 79, IT Intermediary Guidelines 2021

---

### UC-52: Trade Secret Protection Strategy

**Agents**: `ip-specialist`, `employment-contracts`, `cyber-specialist`
**Routing**: ADaPT

**Flow**:
1. `ip-specialist` creates trade secret identification and classification framework
2. `employment-contracts` adds confidentiality clauses (enforceable in India unlike non-compete)
3. `cyber-specialist` recommends technical protection measures
4. Creates: NDA template, access control policy, exit interview checklist
5. Litigation strategy: breach of confidence per Indian Contract Act, equity principles

**Indian Law References**: Indian Contract Act § 27 (trade secret exception), IT Act 2000 § 72A, common law principles

---

## CATEGORY 9: CROSS-CUTTING SCENARIOS (Use Cases 53-55)

### UC-53: Complete Startup Legal Package

**Agents**: Full SWARM topology — 15+ agents coordinated by ns-queen
**Routing**: SWARM

**Flow** (multi-agent parallel execution):
1. `corporate-specialist` → incorporation documents (MOA, AOA, DIR forms)
2. `contract-drafting` → founder agreement, SHA, ESOP policy
3. `ip-specialist` → trademark application, IP assignment deed
4. `employment-contracts` → employment agreements, NDA, POSH policy
5. `data-protection-agent` → privacy policy, DPDPA compliance
6. `tax-specialist` → tax registrations (PAN, GST, TAN, PT)
7. `compliance-lead` → compliance calendar, annual filing checklist
8. `gst-agent` → GST registration, input credit guidance
9. All agents coordinate via ns-queen's SWARM topology
10. Parallel execution with dependency resolution (incorporation before trademark)

**Indian Law References**: Companies Act, Indian Contract Act, Trademarks Act, DPDPA, GST Acts, IT Act, POSH Act, ESOP guidelines

---

### UC-54: Cross-Border Transaction (India-US)

**Agents**: SWARM — `cross-border-transactions`, `fdi-agent`, `tax-specialist`, `transfer-pricing-agent`, `us-law-specialist`, `sanctions-compliance`
**Routing**: HTA

**Flow**:
1. `fdi-agent` validates FDI route: automatic vs government (per DPIIT sector list)
2. `cross-border-transactions` structures: SPA/SHA with dual governing law
3. `transfer-pricing-agent` creates documentation per OECD guidelines + Indian rules
4. `tax-specialist` structures: DTAA benefits (India-US), GAAR applicability
5. `us-law-specialist` validates: CFIUS review (if applicable), SEC filings
6. `sanctions-compliance` checks OFAC, entity list compliance

**Indian Law References**: FEMA 2000, FDI Policy 2020, IT Act §§ 90-94B (DTAA, GAAR), DPIIT Press Notes

---

### UC-55: Multi-Jurisdiction Compliance Audit

**Agents**: SWARM — `multi-jurisdiction-compliance`, `data-protection-agent`, `aml-specialist`, all jurisdiction specialists
**Routing**: SWARM (10+ agents)

**Flow**:
1. `multi-jurisdiction-compliance` maps operations across IN, US, UK, EU, SG, GCC
2. Per jurisdiction: data protection, employment law, tax, anti-corruption, AML
3. India: DPDPA + IT Act + FEMA + GST
4. EU: GDPR + Digital Services Act
5. US: CCPA + SOX + FCPA
6. Creates unified compliance matrix with risk heat map
7. Generates: gap analysis, remediation roadmap, estimated cost

---

## AGENT ORCHESTRATION PATTERNS IN USE

| Pattern | ID | Use Cases | Description |
|---------|-----|-----------|-------------|
| NyayaRAG | P11 | ALL | Hybrid search: pgvector HNSW + BM25 text search |
| ReAct | P01 | UC-09, UC-31 | Reason-Act loop for research |
| Chain-of-Thought | P02 | UC-12, UC-14 | Constitutional analysis |
| GRPO | P21 | UC-05, UC-25 | Group Relative Policy Optimization for risk scoring |
| Digital Twin | P22 | UC-53, UC-55 | Simulation of legal outcomes |
| MoT (Mixture of Thoughts) | P03 | UC-20, UC-54 | Multi-model consensus |
| Self-Refine | P06 | UC-01, UC-06 | Draft → Review → Improve loop |
| HITL | P08 | UC-10, UC-12, UC-35 | Human-in-the-loop for critical matters |
| Swarm | P15 | UC-53, UC-55 | Multi-agent parallel execution |
| ADaPT | P17 | UC-20, UC-35, UC-40 | Adaptive complexity routing |

---

## GUARDRAIL ENFORCEMENT (All Use Cases)

Every response passes through:

1. **PII Redaction**: Aadhaar (12-digit), PAN (XXXXX0000X), bank accounts — 30+ Indian patterns
2. **Anti-Hallucination**: Citations verified against NyayaRAG database
3. **Jurisdiction Lock**: Agent responses confined to authorized jurisdictions
4. **DPDPA Compliance**: No personal data stored beyond consent scope
5. **Bias Detection**: Gender, caste, religion bias patterns detected and flagged
6. **HITL Escalation**: Criminal matters, constitutional matters → mandatory human review
7. **Audit Hash Chain**: Every response logged with tamper-evident hash

---

## API CALL PATTERN (All Use Cases)

```
# Step 1: Provision (one-time per platform startup)
POST /api/nv/sdk/provision
Authorization: Bearer nyv_live_sk_...

# Step 2: Execute Use Case
POST /api/nv/v1/sdk/intelligence/predict-outcome
# or
POST /api/nv/gateway/agents/:agentId/execute
# or
POST /api/nv/gateway/documents/draft

# Step 3: Monitor
GET /api/nv/platforms/:id/usage
```

---

**End of Production Use Cases Document**
**Total Use Cases**: 55
**Jurisdiction**: India (IN) — Primary
**Agents Referenced**: 87 of 149 (remaining are jurisdiction-specific specialists for UK, GCC, EU, US, SG)
