#!/usr/bin/env node
/**
 * Generate filing-ready multi-party legal instruments for NYS Knowledge Plane.
 * Bodies are fillable final documents (agreement / pleading / notice) — not outlines.
 *
 * Output: data/seed-templates-{in,us}-filing-2026-07.json
 * Run: node scripts/generate-nys-filing-instruments.mjs
 * Then: node scripts/merge-nys-seed-expansions.mjs
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, "../data");

/** @typedef {{ id: string, role: string, capacity: string, fields: string[] }} Party */

/**
 * @param {object} opts
 * @param {string} opts.jur
 * @param {string} opts.category
 * @param {string} opts.slug
 * @param {string} opts.title
 * @param {string} opts.description
 * @param {string[]} opts.tags
 * @param {Party[]} opts.parties
 * @param {string} opts.instrumentType  agreement|pleading|notice|consent|deed
 * @param {string} opts.governingLaw
 * @param {string} opts.forum
 * @param {string[]} opts.schedules
 * @param {string} opts.body
 */
function instrument(opts) {
  const partyBlock = opts.parties
    .map(
      (p, i) =>
        `${i + 1}. **${p.role}** (${p.id}) — capacity: ${p.capacity}\n` +
        p.fields.map((f) => `   - ${f}: ________`).join("\n"),
    )
    .join("\n\n");

  const scheduleBlock = opts.schedules.map((s, i) => `- Schedule ${String.fromCharCode(65 + i)} — ${s}`).join("\n");

  const metaHeader = `<!--
nys-instrument: filing-ready
jurisdiction: ${opts.jur}
category: ${opts.category}
instrumentType: ${opts.instrumentType}
parties: ${opts.parties.map((p) => p.id + "=" + p.role).join("; ")}
governingLaw: ${opts.governingLaw}
forum: ${opts.forum}
usage: Fill every ________ / [BRACKET] field; delete unused optional clauses; counsel must verify stamps, filings, and capacity before execution or court filing.
-->

`;

  return {
    kind: "template",
    slug: opts.slug,
    title: opts.title,
    category: opts.category,
    jurisdiction: opts.jur,
    description: opts.description,
    tags: [...new Set(["filing-ready", "multi-party", "fillable", opts.jur, opts.category, opts.instrumentType, ...opts.tags])],
    body:
      metaHeader +
      opts.body
        .replace("{{PARTY_SCHEDULE}}", partyBlock)
        .replace("{{SCHEDULES}}", scheduleBlock)
        .replace("{{GOVERNING_LAW}}", opts.governingLaw)
        .replace("{{FORUM}}", opts.forum),
  };
}

function signatureBlock(parties) {
  return parties
    .map(
      (p) => `### ${p.role} (${p.id})

Signed for and on behalf of **[LEGAL NAME OF ${p.id}]**

Signature: ____________________    Name: ____________________  
Title / capacity: ____________________    Date: ____________________  
Witness (if required): ____________________`,
    )
    .join("\n\n");
}

function buildIn() {
  const out = [];

  out.push(
    instrument({
      jur: "IN",
      category: "corporate",
      slug: "in-sha-multiparty-filing",
      title: "Shareholders Agreement (Multi-Party) — Filing / Execution Form",
      description:
        "Execution-ready Indian SHA for Company + Promoters + Investor(s), with reserved matters, transfer restrictions, and schedules. Fill brackets and execute.",
      tags: ["SHA", "shareholders", "investors", "companies-act"],
      instrumentType: "agreement",
      governingLaw: "Laws of India",
      forum: "Courts at [CITY], India / Arbitration seat [CITY] under ACA 1996",
      parties: [
        { id: "P1", role: "Company", capacity: "company", fields: ["[COMPANY NAME]", "[CIN]", "[REGISTERED OFFICE]"] },
        { id: "P2", role: "Promoter / Founder", capacity: "individual_or_entity", fields: ["[PROMOTER NAME]", "[PAN / DIN]", "[ADDRESS]"] },
        { id: "P3", role: "Investor", capacity: "entity", fields: ["[INVESTOR NAME]", "[INCORPORATION JURISDICTION]", "[ADDRESS]"] },
        { id: "P4", role: "Additional Shareholder (optional)", capacity: "entity_or_individual", fields: ["[NAME]", "[HOLDING %]"] },
      ],
      schedules: ["Shareholding & capitalisation", "Reserved matters", "Deed of adherence form", "Key employee list"],
      body: `# SHAREHOLDERS AGREEMENT

**Effective Date:** [EFFECTIVE DATE]  
**Place of execution:** [CITY], India

## Parties
{{PARTY_SCHEDULE}}

(Collectively, the **Parties**; individually, a **Party**.)

## Recitals
A. The Company is incorporated under the Companies Act, 2013 with authorised share capital of ₹[AMOUNT] divided into [NUMBER] equity shares of ₹[FACE VALUE] each.
B. The Parties wish to record the terms governing shareholding, governance, transfers, and exit.
C. This Agreement is intended as the **final binding instrument** upon execution (and payment of stamp duty, where applicable).

## 1. Definitions
**Affiliate**, **Board**, **Business Day**, **Encumbrance**, **Equity Shares**, **Fully Diluted**, **Reserved Matters**, and **Transfer** have the meanings set out in Schedule A / clause definitions below. Words importing singular include plural.

## 2. Capitalisation & shareholding
2.1 As of the Effective Date, the Fully Diluted shareholding is as set out in **Schedule A**.
2.2 The Company shall not issue securities except as permitted herein or with Investor consent for Reserved Matters.
2.3 Pre-emptive rights: each Shareholder may subscribe pro rata to new Equity Shares within [15] Business Days of notice.

## 3. Board & governance
3.1 Board size: [NUMBER]. Investor nominee directors: [NUMBER]. Quorum: [NUMBER] including [Investor nominee / Promoter nominee].
3.2 Reserved Matters (Schedule B) require prior written consent of Investor holding ≥ [X]% Fully Diluted.
3.3 Information rights: quarterly financials within [45] days; annual audited statements; inspection on reasonable notice.

## 4. Transfer restrictions
4.1 Lock-in: Promoters shall not Transfer for [LOCK-IN PERIOD] except Permitted Transfers to Affiliates bound by a Deed of Adherence (Schedule C).
4.2 ROFR / ROFO: [describe procedure, notice period, matching rights].
4.3 Tag-along / drag-along: thresholds [X]% / [Y]% as detailed in Schedule A footnotes.

## 5. Founder & employee matters
5.1 Founder vesting / reverse vesting: [TERMS].
5.2 Key Employees (Schedule D) subject to IP assignment and confidentiality.

## 6. Non-compete / non-solicit (to the extent enforceable)
During the Term and [12] months thereafter, Promoters shall not compete with the Business in [TERRITORY] or solicit Key Employees / material customers, subject to applicable law.

## 7. Warranties
Each Party warrants capacity and authority. Company and Promoters warrant title to shares, accuracy of Schedule A, and absence of Undisclosed Liabilities above ₹[THRESHOLD], as of the Effective Date.

## 8. Term, termination & survival
Term continues until IPO, trade sale, or mutual written termination. Clauses on confidentiality, indemnity, and dispute resolution survive.

## 9. Confidentiality & announcements
No public announcement without prior written consent, except as required by law / stock exchange / regulator.

## 10. Governing law & dispute resolution
10.1 Governing law: {{GOVERNING_LAW}}.
10.2 Dispute resolution: {{FORUM}}.
10.3 Interim relief may be sought from competent courts at [CITY].

## 11. Miscellaneous
Entire agreement; amendments in writing; severability; counterparts (including electronic); notices to addresses above; stamp duty borne by [PARTY].

## Schedules
{{SCHEDULES}}

## Execution
IN WITNESS WHEREOF the Parties have executed this Agreement as of the Effective Date.

${signatureBlock([
  { id: "P1", role: "Company" },
  { id: "P2", role: "Promoter / Founder" },
  { id: "P3", role: "Investor" },
])}

*(Optional P4 signature block — attach if Additional Shareholder is party.)*
`,
    }),
  );

  out.push(
    instrument({
      jur: "IN",
      category: "commercial",
      slug: "in-msa-services-multiparty-filing",
      title: "Master Services Agreement (Customer–Vendor–Affiliate) — Execution Form",
      description:
        "Fillable Indian MSA with Customer, Primary Vendor, and optional Guarantor/Affiliate for SOW-driven services. Ready to sign after filling commercial schedules.",
      tags: ["MSA", "services", "SOW", "contract"],
      instrumentType: "agreement",
      governingLaw: "Laws of India",
      forum: "Courts at [CITY] / Arbitration seat [CITY]",
      parties: [
        { id: "P1", role: "Customer", capacity: "company", fields: ["[CUSTOMER NAME]", "[CIN]", "[BILLING ADDRESS]"] },
        { id: "P2", role: "Service Provider", capacity: "company", fields: ["[VENDOR NAME]", "[CIN]", "[REGISTERED OFFICE]"] },
        { id: "P3", role: "Performance Guarantor (optional)", capacity: "company_or_individual", fields: ["[GUARANTOR NAME]", "[LIMIT OF GUARANTEE]"] },
      ],
      schedules: ["Statement(s) of Work", "Fees & payment", "Service levels / credits", "Data processing / security"],
      body: `# MASTER SERVICES AGREEMENT

**Effective Date:** [DATE]  
**Agreement No.:** [MSA-ID]

## Parties
{{PARTY_SCHEDULE}}

## 1. Scope
1.1 Provider shall perform Services described in each Statement of Work (**SOW**) under Schedule A.
1.2 Affiliates of Customer may order Services by executing an SOW referencing this MSA; Customer remains jointly liable unless SOW states otherwise.

## 2. Term & termination
Initial Term: [TERM]. Either Party may terminate for convenience on [90] days' written notice, or for material breach uncured within [30] days.

## 3. Fees & taxes
Fees per Schedule B. Invoices due [NET 30]. GST / taxes extra as applicable. Late interest: [RATE]% per month or maximum permitted by law.

## 4. Service levels
SLAs and service credits in Schedule C. Credits are Customer's sole monetary remedy for SLA failure unless wilful misconduct.

## 5. IP & confidentiality
Pre-existing IP remains with the owning Party. Work Product vests in Customer upon full payment, subject to Provider's residual know-how. Confidentiality: [3] years post-termination (trade secrets: perpetual).

## 6. Data protection
If personal data is processed, Schedule D (DPDPA-aligned DPA) applies. Breach notice within [72] hours of becoming aware.

## 7. Indemnity & liability
Mutual IP indemnity. Cap: fees paid in prior [12] months under the applicable SOW, except fraud, death/personal injury, or confidentiality breach.

## 8. Guarantee (if P3 is party)
Guarantor irrevocably guarantees Provider's payment and performance obligations up to [LIMIT], as primary obligor.

## 9. Governing law & disputes
{{GOVERNING_LAW}}. Forum: {{FORUM}}.

## Schedules
{{SCHEDULES}}

## Execution
${signatureBlock([
  { id: "P1", role: "Customer" },
  { id: "P2", role: "Service Provider" },
  { id: "P3", role: "Performance Guarantor (if applicable)" },
])}
`,
    }),
  );

  out.push(
    instrument({
      jur: "IN",
      category: "employment",
      slug: "in-separation-settlement-multiparty-filing",
      title: "Employment Separation & Mutual Release (Employee–Employer–Witness) — Execution Form",
      description:
        "Final settlement and mutual release for Indian employment exits, with optional HR witness / group company. Fill amounts and execute as binding settlement.",
      tags: ["separation", "settlement", "release", "employment"],
      instrumentType: "agreement",
      governingLaw: "Laws of India",
      forum: "Labour / Civil courts at [CITY]",
      parties: [
        { id: "P1", role: "Employer", capacity: "company", fields: ["[EMPLOYER NAME]", "[CIN]", "[ADDRESS]"] },
        { id: "P2", role: "Employee", capacity: "individual", fields: ["[EMPLOYEE NAME]", "[EMPLOYEE ID]", "[LAST WORKING DAY]"] },
        { id: "P3", role: "Witness / HR Authorised Signatory", capacity: "individual", fields: ["[WITNESS NAME]", "[DESIGNATION]"] },
      ],
      schedules: ["Settlement computation", "Return-of-property checklist", "IP / confidentiality reminder"],
      body: `# SETTLEMENT AND MUTUAL RELEASE AGREEMENT

**Date:** [DATE]

## Parties
{{PARTY_SCHEDULE}}

## 1. Separation
Employment ends on [LAST WORKING DAY] on account of [resignation / mutual separation / redundancy]. Relieving letter to be issued within [7] Business Days of clearance.

## 2. Settlement payments
Employer shall pay the amounts in Schedule A (subject to statutory deductions) within [15] days of execution and property return (Schedule B).

## 3. Mutual release
Subject to receipt of settlement sums, each of Employer and Employee releases the other from claims arising out of employment up to the Date, except (a) statutory claims that cannot be waived, (b) fraud, and (c) ongoing confidentiality / IP obligations (Schedule C).

## 4. Non-disparagement & references
Parties shall not disparage each other. Employer will provide a factual experience letter stating designation and tenure.

## 5. Governing law
{{GOVERNING_LAW}}. Disputes: {{FORUM}}.

## Schedules
{{SCHEDULES}}

## Execution
${signatureBlock([
  { id: "P1", role: "Employer" },
  { id: "P2", role: "Employee" },
  { id: "P3", role: "Witness" },
])}
`,
    }),
  );

  out.push(
    instrument({
      jur: "IN",
      category: "property",
      slug: "in-commercial-lease-tripartite-filing",
      title: "Commercial Lease Deed (Lessor–Lessee–Guarantor) — Execution Form",
      description:
        "Tripartite commercial lease for Indian premises with optional rent guarantor. Fill schedules and stamp/register as required by state law before possession.",
      tags: ["lease", "rent", "property", "guarantor"],
      instrumentType: "deed",
      governingLaw: "Laws of [STATE], India",
      forum: "Courts at [CITY]",
      parties: [
        { id: "P1", role: "Lessor / Landlord", capacity: "owner", fields: ["[LESSOR NAME]", "[TITLE DOCUMENTS REF]", "[ADDRESS]"] },
        { id: "P2", role: "Lessee / Tenant", capacity: "company_or_individual", fields: ["[LESSEE NAME]", "[USE OF PREMISES]", "[ADDRESS]"] },
        { id: "P3", role: "Rent Guarantor (optional)", capacity: "company_or_individual", fields: ["[GUARANTOR NAME]", "[GUARANTEE CAP]"] },
      ],
      schedules: ["Premises description & floor plan", "Rent, deposit & escalation", "Fit-out & handover checklist"],
      body: `# COMMERCIAL LEASE DEED

**Date of Deed:** [DATE]  
**Commencement Date:** [DATE]  
**Term:** [YEARS / MONTHS] ending [END DATE]

## Parties
{{PARTY_SCHEDULE}}

## 1. Demise
Lessor demises the Premises described in Schedule A to Lessee for the Term at the rent in Schedule B, together with rights of access and parking as specified.

## 2. Rent, deposit & escalation
Monthly rent, security deposit, and escalation formula are in Schedule B. Deposit is interest-free / interest-bearing as stated and refundable subject to deductions for arrears and damage beyond fair wear and tear.

## 3. Use & compliance
Premises used only for [PERMITTED USE]. Lessee shall obtain trade licences and comply with fire, municipal, and RERA (if applicable) requirements.

## 4. Maintenance & alterations
Lessee maintains interior; Lessor structural. Alterations require prior written consent. Handover per Schedule C.

## 5. Assignment & subletting
No assignment / subletting without Lessor consent (not to be unreasonably withheld for Affiliates).

## 6. Default & termination
Events of default include rent arrears > [15] days after notice, insolvency, and unlawful use. Termination and re-entry subject to applicable rent-control / transfer-of-property rules.

## 7. Guarantee
If P3 is party, Guarantor guarantees Lessee's monetary obligations up to [CAP] as primary obligor.

## 8. Stamp duty & registration
Parties shall stamp and register this Deed as required under the [STATE] Stamp Act and Registration Act; costs borne by [PARTY].

## 9. Governing law
{{GOVERNING_LAW}}. Forum: {{FORUM}}.

## Schedules
{{SCHEDULES}}

## Execution
${signatureBlock([
  { id: "P1", role: "Lessor" },
  { id: "P2", role: "Lessee" },
  { id: "P3", role: "Guarantor (if applicable)" },
])}
`,
    }),
  );

  out.push(
    instrument({
      jur: "IN",
      category: "arbitration",
      slug: "in-arbitration-settlement-consent-award-filing",
      title: "Consent Terms / Settlement for Arbitral Award (Claimant–Respondent–Tribunal) — Filing Form",
      description:
        "Multi-party consent terms suitable to request a consent award under the Arbitration & Conciliation Act, 1996. Fill and file with the tribunal.",
      tags: ["arbitration", "consent-award", "settlement", "ACA"],
      instrumentType: "consent",
      governingLaw: "Arbitration & Conciliation Act, 1996; Laws of India",
      forum: "Arbitral Tribunal in [CASE CAPTION]; seat [CITY]",
      parties: [
        { id: "P1", role: "Claimant", capacity: "party", fields: ["[CLAIMANT NAME]", "[COUNSEL]"] },
        { id: "P2", role: "Respondent", capacity: "party", fields: ["[RESPONDENT NAME]", "[COUNSEL]"] },
        { id: "P3", role: "Additional Respondent / Intervener (optional)", capacity: "party", fields: ["[NAME]"] },
      ],
      schedules: ["Payment schedule", "Withdrawn claims list", "Confidentiality carve-outs"],
      body: `# CONSENT TERMS FOR SETTLEMENT / CONSENT AWARD

**In the matter of arbitration between:** [CLAIMANT] and [RESPONDENT]  
**Seat:** [CITY] | **Rules:** [UNCITRAL / ICA / ad hoc] | **Tribunal:** [ARBITRATOR NAMES]

## Parties to these Consent Terms
{{PARTY_SCHEDULE}}

## 1. Settlement
Without admission of liability, the Parties settle all claims in the arbitration on the terms below and request the Tribunal to pass a **consent award** under Section 30 of the Arbitration & Conciliation Act, 1996.

## 2. Payment
Respondent shall pay Claimant ₹[AMOUNT] per Schedule A. Upon full payment, Claimant withdraws claims listed in Schedule B with prejudice.

## 3. Mutual release
Subject to performance, Parties release arbitration claims existing as of the date of the consent award, except enforcement of these terms and confidentiality (Schedule C).

## 4. Costs
Each Party bears its own costs; Tribunal fees shared [equally / as awarded].

## 5. Request to Tribunal
Parties jointly request that these Consent Terms be recorded as a consent award, executable as a decree.

## Governing framework
{{GOVERNING_LAW}}. Forum / seat: {{FORUM}}.

## Schedules
{{SCHEDULES}}

## Execution (for filing with Tribunal)
${signatureBlock([
  { id: "P1", role: "Claimant" },
  { id: "P2", role: "Respondent" },
])}
`,
    }),
  );

  out.push(
    instrument({
      jur: "IN",
      category: "family",
      slug: "in-mutual-consent-divorce-petition-filing",
      title: "Mutual Consent Divorce Petition (Husband–Wife) — Court Filing Form",
      description:
        "HMA s.13B-style mutual consent petition skeleton for Family Court filing. Fill personal particulars, terms of settlement, and verification before filing.",
      tags: ["divorce", "mutual-consent", "HMA", "family-court"],
      instrumentType: "pleading",
      governingLaw: "Hindu Marriage Act, 1955 (or applicable personal law)",
      forum: "Family Court at [CITY]",
      parties: [
        { id: "P1", role: "First Petitioner (Husband / Spouse A)", capacity: "individual", fields: ["[NAME]", "[AGE]", "[ADDRESS]"] },
        { id: "P2", role: "Second Petitioner (Wife / Spouse B)", capacity: "individual", fields: ["[NAME]", "[AGE]", "[ADDRESS]"] },
      ],
      schedules: ["Terms of settlement (maintenance, custody, property)", "List of dates", "Document index"],
      body: `# PETITION UNDER SECTION 13B OF THE HINDU MARRIAGE ACT, 1955
## (Mutual Consent Divorce)

**IN THE FAMILY COURT AT [CITY]**  
**Petition No.** ________ of [YEAR]

## Parties
{{PARTY_SCHEDULE}}

## Most respectfully showeth
1. Marriage was solemnised on [DATE] at [PLACE] according to [rites].
2. Petitioners have lived separately since [DATE] (≥ one year) and have mutually agreed that the marriage should be dissolved.
3. Terms of settlement regarding maintenance, custody/visitation, and property are set out in Schedule A and form part of this Petition.
4. Consent is free and voluntary; there is no collusion.

## Prayer
Petitioners pray that this Hon'ble Court be pleased to:
(a) dissolve the marriage by a decree of divorce by mutual consent;
(b) record and make Schedule A terms part of the decree; and
(c) pass such other orders as are just.

## Verification
We, the Petitioners, verify that the contents are true to our knowledge and belief.

## Schedules
{{SCHEDULES}}

## Governing law / forum
{{GOVERNING_LAW}}. {{FORUM}}.

## Signatures
${signatureBlock([
  { id: "P1", role: "First Petitioner" },
  { id: "P2", role: "Second Petitioner" },
])}

**Through counsel:** [ADVOCATE NAME], Enrolment No. [NUMBER]
`,
    }),
  );

  out.push(
    instrument({
      jur: "IN",
      category: "banking",
      slug: "in-loan-facility-guarantor-filing",
      title: "Facility Agreement (Borrower–Lender–Guarantor) — Execution Form",
      description:
        "Indian facility agreement with borrower, lender, and personal/corporate guarantor. Fill facilities schedule; stamp before drawdown.",
      tags: ["loan", "facility", "guarantor", "banking"],
      instrumentType: "agreement",
      governingLaw: "Laws of India",
      forum: "Courts / DRT at [CITY] as applicable",
      parties: [
        { id: "P1", role: "Borrower", capacity: "company_or_individual", fields: ["[BORROWER NAME]", "[PAN / CIN]", "[ADDRESS]"] },
        { id: "P2", role: "Lender", capacity: "bank_or_nbfc", fields: ["[LENDER NAME]", "[BRANCH]", "[FACILITY LIMIT]"] },
        { id: "P3", role: "Guarantor", capacity: "company_or_individual", fields: ["[GUARANTOR NAME]", "[GUARANTEE TYPE]"] },
      ],
      schedules: ["Facility terms (limit, interest, tenor)", "Security package", "Conditions precedent"],
      body: `# FACILITY AGREEMENT

**Date:** [DATE]

## Parties
{{PARTY_SCHEDULE}}

## 1. Facility
Lender agrees to make available the Facility described in Schedule A subject to Conditions Precedent in Schedule C.

## 2. Interest, fees & repayment
As per Schedule A. Default interest: [RATE]. Prepayment: [TERMS].

## 3. Security
Security documents in Schedule B shall be executed and perfected before first drawdown.

## 4. Representations & covenants
Borrower represents solvency, authority, and accuracy of information. Affirmative / negative covenants as customary for this Facility class.

## 5. Events of default
Non-payment, breach, insolvency, cross-default above ₹[THRESHOLD], and repudiation. Acceleration and enforcement follow notice as required by law.

## 6. Guarantee
Guarantor unconditionally guarantees Borrower's obligations as primary obligor; waiver of defences to the extent permitted by law.

## 7. Governing law
{{GOVERNING_LAW}}. Forum: {{FORUM}}.

## Schedules
{{SCHEDULES}}

## Execution
${signatureBlock([
  { id: "P1", role: "Borrower" },
  { id: "P2", role: "Lender" },
  { id: "P3", role: "Guarantor" },
])}
`,
    }),
  );

  out.push(
    instrument({
      jur: "IN",
      category: "ip",
      slug: "in-ip-assignment-multiparty-filing",
      title: "IP Assignment & Licence (Assignor–Assignee–Developer) — Execution Form",
      description:
        "Multi-party IP assignment with developer confirmation for Indian software/content deals. Fill schedules of IP and execute.",
      tags: ["IP", "assignment", "licence", "copyright"],
      instrumentType: "agreement",
      governingLaw: "Laws of India",
      forum: "Courts at [CITY]",
      parties: [
        { id: "P1", role: "Assignor", capacity: "company_or_individual", fields: ["[ASSIGNOR NAME]"] },
        { id: "P2", role: "Assignee", capacity: "company", fields: ["[ASSIGNEE NAME]", "[CIN]"] },
        { id: "P3", role: "Developer / Creator (confirming party)", capacity: "individual", fields: ["[DEVELOPER NAME]", "[EMPLOYMENT / CONTRACT REF]"] },
      ],
      schedules: ["IP schedule (works, registrations, apps)", "Licence back (if any)", "Moral rights waiver acknowledgement"],
      body: `# INTELLECTUAL PROPERTY ASSIGNMENT AND CONFIRMATION AGREEMENT

**Effective Date:** [DATE]

## Parties
{{PARTY_SCHEDULE}}

## 1. Assignment
Assignor hereby assigns to Assignee all right, title, and interest in the Intellectual Property listed in Schedule A, including copyrights, patents (if any), trade secrets, and related claims, worldwide, for the full term of protection.

## 2. Developer confirmation
Developer confirms that the Works were created in the course of [employment / contract] and that all rights have been or are hereby vested in Assignor for onward assignment to Assignee. Moral rights waived to the maximum extent permitted (Schedule C).

## 3. Licence back (optional)
If Schedule B so provides, Assignee grants Assignor a non-exclusive licence to use specified IP for [PURPOSE].

## 4. Further assurance
Parties shall execute filings with CGPDTM / Copyright Office as reasonably requested.

## 5. Governing law
{{GOVERNING_LAW}}. {{FORUM}}.

## Schedules
{{SCHEDULES}}

## Execution
${signatureBlock([
  { id: "P1", role: "Assignor" },
  { id: "P2", role: "Assignee" },
  { id: "P3", role: "Developer" },
])}
`,
    }),
  );

  return out;
}

function buildUs() {
  const out = [];

  out.push(
    instrument({
      jur: "US",
      category: "corporate",
      slug: "us-stockholders-agreement-multiparty-filing",
      title: "Stockholders Agreement (Company–Founders–Investor) — Execution Form",
      description:
        "Delaware-style multiparty stockholders agreement ready for signature with voting, transfer, and drag/tag provisions. Fill schedules before closing.",
      tags: ["stockholders", "delaware", "venture", "SPA-side"],
      instrumentType: "agreement",
      governingLaw: "Laws of the State of Delaware",
      forum: "State or federal courts in [COUNTY], Delaware",
      parties: [
        { id: "P1", role: "Company", capacity: "delaware_corporation", fields: ["[COMPANY NAME]", "[STATE OF INCORPORATION]", "[EIN]"] },
        { id: "P2", role: "Founder", capacity: "individual", fields: ["[FOUNDER NAME]", "[ADDRESS]"] },
        { id: "P3", role: "Investor", capacity: "entity", fields: ["[INVESTOR NAME]", "[STATE]", "[ADDRESS]"] },
        { id: "P4", role: "Additional Holder (optional)", capacity: "entity_or_individual", fields: ["[NAME]", "[SHARES]"] },
      ],
      schedules: ["Capitalization table", "Reserved matters / protective provisions", "Joinder agreement"],
      body: `# STOCKHOLDERS AGREEMENT

**Effective Date:** [DATE]

## Parties
{{PARTY_SCHEDULE}}

## Recitals
The Parties enter this Agreement in connection with [Series __ financing / reorganization] to govern voting, transfers, and certain governance rights. This document is intended as the **final binding agreement** upon execution.

## 1. Definitions
Capitalized terms have meanings in Exhibit A / Schedule A capitalization footnotes.

## 2. Voting & board
Board composition: [NUMBER]. Investor Designated Directors: [NUMBER]. Protective provisions in Schedule B.

## 3. Transfer restrictions
Lock-up, ROFR, co-sale, and drag-along as set forth herein; Joinder required for Permitted Transferees (Schedule C).

## 4. Information rights
Quarterly and annual financial statements; inspection rights for Major Investors (≥ [X]%).

## 5. Representations
Each Party represents due authorization and enforceability.

## 6. Governing law & venue
{{GOVERNING_LAW}}. Exclusive venue: {{FORUM}}.

## Schedules / Exhibits
{{SCHEDULES}}

## Counterparts; electronic signatures
This Agreement may be executed in counterparts (including DocuSign / Adobe Sign).

## Execution
${signatureBlock([
  { id: "P1", role: "Company" },
  { id: "P2", role: "Founder" },
  { id: "P3", role: "Investor" },
])}
`,
    }),
  );

  out.push(
    instrument({
      jur: "US",
      category: "commercial",
      slug: "us-msa-customer-vendor-affiliate-filing",
      title: "Master Services Agreement (Customer–Vendor–Affiliate) — Execution Form",
      description:
        "US MSA with optional affiliate joinder and order forms. Fill commercial exhibits; execute as binding contract.",
      tags: ["MSA", "SOW", "SaaS", "services"],
      instrumentType: "agreement",
      governingLaw: "Laws of the State of [STATE]",
      forum: "State or federal courts in [COUNTY], [STATE]",
      parties: [
        { id: "P1", role: "Customer", capacity: "entity", fields: ["[CUSTOMER LEGAL NAME]", "[STATE]", "[NOTICE ADDRESS]"] },
        { id: "P2", role: "Vendor", capacity: "entity", fields: ["[VENDOR LEGAL NAME]", "[STATE]", "[NOTICE ADDRESS]"] },
        { id: "P3", role: "Customer Affiliate (optional joinder)", capacity: "entity", fields: ["[AFFILIATE NAME]"] },
      ],
      schedules: ["Order Form / SOW", "Fees", "SLA", "DPA / security exhibit"],
      body: `# MASTER SERVICES AGREEMENT

**Effective Date:** [DATE]

## Parties
{{PARTY_SCHEDULE}}

## 1. Services
Vendor will provide Services under Order Forms / SOWs (Schedule A). Affiliates may purchase under a joinder or separate Order Form.

## 2. Fees; taxes
Per Schedule B. Late fees [1.5%]/R] or maximum allowed by law.

## 3. Warranties; disclaimer
Services performed in a professional manner. EXCEPT AS EXPRESSLY STATED, WARRANTIES OF MERCHANTABILITY AND FITNESS ARE DISCLAIMED TO THE EXTENT PERMITTED BY LAW.

## 4. Limitation of liability
Aggregate cap: fees paid in the [12] months preceding the claim, excluding confidentiality, IP indemnity, and data breach obligations to the extent negotiated in Schedule D.

## 5. Term; termination
As stated in the applicable Order Form; survival of confidentiality, IP, and liability clauses.

## 6. Governing law
{{GOVERNING_LAW}}. Venue: {{FORUM}}. EACH PARTY WAIVES JURY TRIAL TO THE EXTENT PERMITTED.

## Schedules
{{SCHEDULES}}

## Execution
${signatureBlock([
  { id: "P1", role: "Customer" },
  { id: "P2", role: "Vendor" },
])}
`,
    }),
  );

  out.push(
    instrument({
      jur: "US",
      category: "employment",
      slug: "us-separation-release-multiparty-filing",
      title: "Separation Agreement & General Release (Employee–Company–Benefit Plan) — Execution Form",
      description:
        "US employment separation with ADEA-compliant release language placeholders and optional plan administrator acknowledgement.",
      tags: ["separation", "release", "ADEA", "employment"],
      instrumentType: "agreement",
      governingLaw: "Laws of the State of [STATE]",
      forum: "Courts in [COUNTY], [STATE]",
      parties: [
        { id: "P1", role: "Company", capacity: "employer", fields: ["[COMPANY NAME]", "[STATE]"] },
        { id: "P2", role: "Employee", capacity: "individual", fields: ["[EMPLOYEE NAME]", "[TERMINATION DATE]"] },
        { id: "P3", role: "Plan Administrator (optional)", capacity: "fiduciary", fields: ["[PLAN NAME]"] },
      ],
      schedules: ["Severance & COBRA", "Return of property", "ADEA disclosure (40+)"],
      body: `# SEPARATION AGREEMENT AND GENERAL RELEASE

**Date:** [DATE]

## Parties
{{PARTY_SCHEDULE}}

## 1. Separation
Employment ends on [TERMINATION DATE]. Final wages paid per applicable law.

## 2. Consideration
Company pays severance per Schedule A in exchange for the releases herein. Employee acknowledges adequacy of consideration.

## 3. Release
Employee releases Company and Related Parties from Claims through the Effective Date, excluding non-waivable rights, unemployment/workers' compensation as applicable, and vested ERISA benefits. **ADEA:** Employee has [21/45] days to consider and [7] days to revoke (Schedule C).

## 4. Restrictive covenants
Confidentiality, non-solicit, and return-of-property (Schedule B) survive as stated.

## 5. Governing law
{{GOVERNING_LAW}}. {{FORUM}}.

## Schedules
{{SCHEDULES}}

## Execution
${signatureBlock([
  { id: "P1", role: "Company" },
  { id: "P2", role: "Employee" },
])}
`,
    }),
  );

  out.push(
    instrument({
      jur: "US",
      category: "property",
      slug: "us-commercial-lease-guarantor-filing",
      title: "Commercial Lease (Landlord–Tenant–Guarantor) — Execution Form",
      description:
        "US commercial lease with optional lease guarantor. Fill rent exhibits; execute before possession.",
      tags: ["lease", "guarantor", "real-estate"],
      instrumentType: "agreement",
      governingLaw: "Laws of the State of [STATE]",
      forum: "Courts of [COUNTY], [STATE]",
      parties: [
        { id: "P1", role: "Landlord", capacity: "owner", fields: ["[LANDLORD NAME]", "[PREMISES ADDRESS]"] },
        { id: "P2", role: "Tenant", capacity: "entity_or_individual", fields: ["[TENANT NAME]", "[DBA]"] },
        { id: "P3", role: "Guarantor", capacity: "entity_or_individual", fields: ["[GUARANTOR NAME]"] },
      ],
      schedules: ["Premises & permitted use", "Rent & operating expenses", "Rules & regulations"],
      body: `# COMMERCIAL LEASE AGREEMENT

**Lease Date:** [DATE] | **Commencement:** [DATE] | **Expiration:** [DATE]

## Parties
{{PARTY_SCHEDULE}}

## 1. Premises
Landlord leases Premises in Schedule A to Tenant for Permitted Use.

## 2. Rent
Base Rent, Additional Rent, and security deposit per Schedule B.

## 3. Maintenance; alterations
As allocated herein; Landlord consent required for alterations.

## 4. Default; remedies
Including late fees, interest, and re-entry subject to applicable law and notice requirements.

## 5. Guaranty
Guarantor absolutely guarantees Tenant's obligations; primary liability.

## 6. Governing law
{{GOVERNING_LAW}}. {{FORUM}}.

## Schedules
{{SCHEDULES}}

## Execution
${signatureBlock([
  { id: "P1", role: "Landlord" },
  { id: "P2", role: "Tenant" },
  { id: "P3", role: "Guarantor" },
])}
`,
    }),
  );

  out.push(
    instrument({
      jur: "US",
      category: "arbitration",
      slug: "us-settlement-consent-award-filing",
      title: "Arbitration Settlement Stipulation (Claimant–Respondent) — Award Filing Form",
      description:
        "Stipulation suitable for consent award under FAA / AAA rules. Fill payment terms and submit to arbitrator.",
      tags: ["arbitration", "FAA", "settlement", "consent-award"],
      instrumentType: "consent",
      governingLaw: "Federal Arbitration Act; Laws of [STATE]",
      forum: "Arbitration seated in [CITY], [STATE]",
      parties: [
        { id: "P1", role: "Claimant", capacity: "party", fields: ["[CLAIMANT]", "[COUNSEL]"] },
        { id: "P2", role: "Respondent", capacity: "party", fields: ["[RESPONDENT]", "[COUNSEL]"] },
      ],
      schedules: ["Payment schedule", "Dismissed claims", "Confidentiality"],
      body: `# STIPULATION FOR CONSENT AWARD

**Case caption:** [CAPTION] | **Forum:** [AAA / JAMS / ad hoc]

## Parties
{{PARTY_SCHEDULE}}

## 1. Settlement
Parties settle all claims in the arbitration on the terms below and request a consent award.

## 2. Payment
Per Schedule A. Upon payment, claims in Schedule B are dismissed with prejudice.

## 3. Release & confidentiality
Mutual release of arbitrated claims; confidentiality per Schedule C.

## 4. Request
Arbitrator is requested to enter these terms as a final consent award, confirmable under the FAA.

## Governing law / seat
{{GOVERNING_LAW}}. {{FORUM}}.

## Schedules
{{SCHEDULES}}

## Execution
${signatureBlock([
  { id: "P1", role: "Claimant" },
  { id: "P2", role: "Respondent" },
])}
`,
    }),
  );

  out.push(
    instrument({
      jur: "US",
      category: "banking",
      slug: "us-credit-agreement-guarantor-filing",
      title: "Credit Agreement (Borrower–Lender–Guarantor) — Execution Form",
      description:
        "US bilateral credit agreement with guarantor. Fill facility exhibit; execute before funding.",
      tags: ["credit", "loan", "guarantor", "banking"],
      instrumentType: "agreement",
      governingLaw: "Laws of the State of New York (or [STATE])",
      forum: "Courts of New York County / [COUNTY]",
      parties: [
        { id: "P1", role: "Borrower", capacity: "entity", fields: ["[BORROWER]", "[STATE]", "[EIN]"] },
        { id: "P2", role: "Lender", capacity: "bank", fields: ["[LENDER]", "[FACILITY COMMITMENT]"] },
        { id: "P3", role: "Guarantor", capacity: "entity_or_individual", fields: ["[GUARANTOR]"] },
      ],
      schedules: ["Commitments & pricing", "Collateral", "Conditions precedent"],
      body: `# CREDIT AGREEMENT

**Dated as of:** [DATE]

## Parties
{{PARTY_SCHEDULE}}

## 1. Commitments
Lender agrees to make Loans per Schedule A subject to Schedule C conditions.

## 2. Interest; fees; repayment
As set forth in Schedule A.

## 3. Collateral
Security interests described in Schedule B.

## 4. Guaranty
Guarantor absolutely and unconditionally guarantees the Obligations.

## 5. Events of default; remedies
Customary defaults; acceleration upon notice as required.

## 6. Governing law
{{GOVERNING_LAW}}. {{FORUM}}. WAIVER OF JURY TRIAL.

## Schedules
{{SCHEDULES}}

## Execution
${signatureBlock([
  { id: "P1", role: "Borrower" },
  { id: "P2", role: "Lender" },
  { id: "P3", role: "Guarantor" },
])}
`,
    }),
  );

  out.push(
    instrument({
      jur: "US",
      category: "privacy",
      slug: "us-dpa-controller-processor-subprocessor-filing",
      title: "Data Processing Agreement (Controller–Processor–Subprocessor) — Execution Form",
      description:
        "Multi-party DPA for CCPA/CPRA / state privacy + GDPR-style transfers. Fill processing schedules and execute with MSA.",
      tags: ["DPA", "privacy", "CCPA", "GDPR"],
      instrumentType: "agreement",
      governingLaw: "Laws of the State of [STATE]",
      forum: "Courts of [COUNTY], [STATE]",
      parties: [
        { id: "P1", role: "Controller / Business", capacity: "entity", fields: ["[CONTROLLER NAME]"] },
        { id: "P2", role: "Processor / Service Provider", capacity: "entity", fields: ["[PROCESSOR NAME]"] },
        { id: "P3", role: "Subprocessor (optional)", capacity: "entity", fields: ["[SUBPROCESSOR NAME]", "[SERVICE]"] },
      ],
      schedules: ["Processing details", "Security measures", "Subprocessor list"],
      body: `# DATA PROCESSING AGREEMENT

**Effective Date:** [DATE]  
**(Annex to MSA dated [MSA DATE])**

## Parties
{{PARTY_SCHEDULE}}

## 1. Roles
Controller determines purposes; Processor processes Personal Information only on documented instructions. Subprocessor (if party) processes solely for the services in Schedule C.

## 2. Processing details
Categories, purposes, and retention in Schedule A.

## 3. Security
Technical and organizational measures in Schedule B; breach notice within [72] hours.

## 4. Assistance
Processor assists with DSAR / consumer requests, DPIAs, and regulator inquiries as reasonably required.

## 5. International transfers
SCCs / state transfer mechanisms attached if applicable.

## 6. Governing law
{{GOVERNING_LAW}}. {{FORUM}}.

## Schedules
{{SCHEDULES}}

## Execution
${signatureBlock([
  { id: "P1", role: "Controller" },
  { id: "P2", role: "Processor" },
  { id: "P3", role: "Subprocessor (if applicable)" },
])}
`,
    }),
  );

  out.push(
    instrument({
      jur: "US",
      category: "litigation",
      slug: "us-complaint-civil-multiparty-filing",
      title: "Civil Complaint (Plaintiff–Defendant–Relief Defendants) — Court Filing Form",
      description:
        "Federal/state civil complaint caption with multiple defendants. Fill facts, counts, and prayer before filing; verify local rules.",
      tags: ["complaint", "pleading", "FRCP", "litigation"],
      instrumentType: "pleading",
      governingLaw: "Laws of [STATE] / United States",
      forum: "[DISTRICT COURT / STATE COURT] at [VENUE]",
      parties: [
        { id: "P1", role: "Plaintiff", capacity: "party", fields: ["[PLAINTIFF NAME]", "[CITIZENSHIP / RESIDENCE]"] },
        { id: "P2", role: "Defendant", capacity: "party", fields: ["[DEFENDANT NAME]", "[CITIZENSHIP / RESIDENCE]"] },
        { id: "P3", role: "Additional Defendant / Relief Defendant", capacity: "party", fields: ["[NAME]"] },
      ],
      schedules: ["List of exhibits", "Damages computation (optional)"],
      body: `# COMPLAINT

**{{FORUM}}**  
**Civil Action No.** ________

## Parties
{{PARTY_SCHEDULE}}

## Jurisdiction & venue
1. This Court has jurisdiction under [statute / diversity / federal question].
2. Venue is proper under [statute] because [FACTS].

## Facts common to all counts
3–[N]. [NUMBERED FACTUAL ALLEGATIONS — fill chronologically; attach exhibits per Schedule A.]

## Count I — [CAUSE OF ACTION]
[Elements pleaded with supporting facts.]

## Count II — [CAUSE OF ACTION]
[Optional additional count.]

## Prayer for relief
WHEREFORE, Plaintiff requests judgment for:
(a) damages of $[AMOUNT] or as proven;
(b) interest, costs, and attorneys' fees as allowed;
(c) injunctive / declaratory relief as specified; and
(d) such other relief as the Court deems just.

## Jury demand
Plaintiff [demands / waives] trial by jury.

## Governing law
{{GOVERNING_LAW}}.

## Schedules
{{SCHEDULES}}

## Signature block (counsel)
Respectfully submitted,

_______________________________  
[ATTORNEY NAME], Esq.  
[BAR NO.] | [FIRM] | [ADDRESS] | [EMAIL] | [PHONE]  
*Attorney for Plaintiff*

## Verification (if required)
[PARTY VERIFICATION UNDER PENALTY OF PERJURY]
`,
    }),
  );

  return out;
}

const inInstruments = buildIn();
const usInstruments = buildUs();

writeFileSync(
  path.join(dataDir, "seed-templates-in-filing-2026-07.json"),
  `${JSON.stringify(inInstruments, null, 2)}\n`,
);
writeFileSync(
  path.join(dataDir, "seed-templates-us-filing-2026-07.json"),
  `${JSON.stringify(usInstruments, null, 2)}\n`,
);

console.log(
  JSON.stringify(
    {
      inFiling: inInstruments.length,
      usFiling: usInstruments.length,
      total: inInstruments.length + usInstruments.length,
      sampleSlugs: [...inInstruments, ...usInstruments].slice(0, 6).map((t) => t.slug),
    },
    null,
    2,
  ),
);
