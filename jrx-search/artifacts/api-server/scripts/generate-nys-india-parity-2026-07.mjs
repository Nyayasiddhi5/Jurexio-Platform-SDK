#!/usr/bin/env node
/**
 * India jurisdiction parity pack (5.0.0) — extra IN templates (orders/checklists/filing)
 * and IN legal_tasks so Console/NYS pages are India-first complete.
 *
 * Output:
 *   data/seed-templates-in-parity-2026-07.json
 *   data/seed-tasks-in-parity-2026-07.json
 *
 * Run (local):
 *   node scripts/generate-nys-india-parity-2026-07.mjs
 *   node scripts/merge-nys-seed-expansions.mjs
 *
 * Worker reseed requires explicit GO (never run silently on EC2).
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, "../data");

const ORDER_INSTRUMENTS = [
  {
    slug: "in-sc-interim-stay-order",
    title: "IN — Supreme Court Interim Stay Order (template)",
    category: "constitutional",
    tags: ["IN", "order", "filing-ready", "supreme-court", "interim"],
    body: `# INTERIM STAY ORDER — SUPREME COURT OF INDIA

**Petition No.** ________ / ________  
**Petitioner:** ________  
**Respondent:** ________  

Upon hearing counsel and perusing the record, IT IS ORDERED that:

1. Operation of the Impugned Order / Notice dated ________ is stayed pending further orders.
2. Parties shall maintain status quo as on ________ regarding ________.
3. Respondent shall file counter-affidavit within ________ weeks; rejoinder within ________ weeks thereafter.
4. List on ________.

**Place:** New Delhi  
**Date:** ________  

*(Judge / Bench)*  
*Nyayasiddhi India parity pack — filing-ready order*`,
  },
  {
    slug: "in-hc-writ-admission-order",
    title: "IN — High Court Writ Admission / Rule Nisi Order",
    category: "constitutional",
    tags: ["IN", "order", "filing-ready", "high-court", "writ"],
    body: `# ADMISSION ORDER — HIGH COURT OF ________

**W.P. (C) No.** ________  
Admit. Issue notice to respondents returnable on ________.  
Interim relief as prayed in para ________ is granted / refused as under: ________.  
Dasti permitted.  

**Date:** ________`,
  },
  {
    slug: "in-district-injunction-order",
    title: "IN — Temporary Injunction Order (Order XXXIX CPC)",
    category: "civil",
    tags: ["IN", "order", "filing-ready", "cpc", "injunction"],
    body: `# TEMPORARY INJUNCTION ORDER

**Suit No.** ________ — Court of ________  
Plaintiff ________ vs Defendant ________  

Heard. Prima facie case / balance of convenience / irreparable injury considered.  
IT IS ORDERED that defendants are restrained from ________ until further orders.  
Bond / undertaking as directed. Next date: ________.`,
  },
  {
    slug: "in-nclt-admission-order",
    title: "IN — NCLT Admission Order (IBC outline)",
    category: "insolvency",
    tags: ["IN", "order", "filing-ready", "ibc", "nclt"],
    body: `# NCLT — ADMISSION ORDER (CP (IB) No. ________)

Application under Section ________ of the IBC is admitted.  
IRP ________ is appointed. Moratorium under Section 14 operates.  
IRP to make public announcement; file progress as directed.`,
  },
  {
    slug: "in-consumer-commission-order",
    title: "IN — Consumer Commission Final Order (outline)",
    category: "consumer",
    tags: ["IN", "order", "filing-ready", "consumer"],
    body: `# FINAL ORDER — ________ CONSUMER DISPUTES REDRESSAL COMMISSION

Complaint No. ________  
Opposite parties directed to ________ within ________ days.  
Compensation ₹________; costs ₹________. Appeal rights noted.`,
  },
  {
    slug: "in-labour-award-order",
    title: "IN — Labour / Industrial Award Order (outline)",
    category: "employment",
    tags: ["IN", "order", "filing-ready", "labour"],
    body: `# AWARD / ORDER — ________  

Reference / ID No. ________  
Workman ________ vs Management ________  
Relief: reinstatement / compensation / continuity as under: ________.`,
  },
  {
    slug: "in-family-interim-maintenance-order",
    title: "IN — Family Court Interim Maintenance Order",
    category: "family",
    tags: ["IN", "order", "filing-ready", "family", "maintenance"],
    body: `# INTERIM MAINTENANCE ORDER — FAMILY COURT ________

Petition No. ________  
Respondent to pay ₹________ per month from ________. Arrears by ________.  
Next date: ________.`,
  },
  {
    slug: "in-arbitration-section-17-order",
    title: "IN — Arbitral Tribunal Interim Measure Order (S.17)",
    category: "arbitration",
    tags: ["IN", "order", "filing-ready", "arbitration"],
    body: `# INTERIM MEASURES ORDER — ARBITRAL TRIBUNAL

Arbitration between ________ and ________  
Under Section 17 of the Arbitration & Conciliation Act, 1996:  
Parties directed to ________. Security / bank guarantee as: ________.`,
  },
];

const CHECKLISTS = [
  {
    slug: "in-bns-fir-investigation-checklist",
    title: "IN Checklist — FIR to Charge-sheet (BNS/BNSS)",
    category: "criminal",
    tags: ["IN", "checklist", "bns", "bnss", "fir"],
    body: `# Checklist — FIR → Investigation → Charge-sheet (India)

- [ ] FIR particulars / zero FIR if applicable
- [ ] Sections under BNS mapped; prior IPC equivalents noted if needed
- [ ] Seizure memos / 161/183 statements plan (BNSS)
- [ ] Medical / FSL / CDR requests logged
- [ ] Default bail calendar tracked
- [ ] Charge-sheet annexures index complete
- [ ] Victim / witness protection notes
*Parity pack 2026-07*`,
  },
  {
    slug: "in-writ-petition-filing-checklist",
    title: "IN Checklist — Article 226/32 Writ Filing",
    category: "constitutional",
    tags: ["IN", "checklist", "writ", "filing-ready"],
    body: `# Checklist — Writ Petition Filing

- [ ] Cause title & jurisdiction (HC/SC)
- [ ] Facts chronology with dates
- [ ] Grounds mapped to Articles / statutes
- [ ] Interim relief prayers precise
- [ ] Annexures & vakalatnama
- [ ] Caveat / listing urgency note
- [ ] Service plan`,
  },
  {
    slug: "in-commercial-suit-checklist",
    title: "IN Checklist — Commercial Suit (CCA)",
    category: "commercial",
    tags: ["IN", "checklist", "commercial-courts"],
    body: `# Checklist — Commercial Suit

- [ ] Specified value / CCA applicability
- [ ] Pre-institution mediation (where required)
- [ ] Plaint + documents under Order XI
- [ ] Urgent interim applications
- [ ] Case management timeline`,
  },
  {
    slug: "in-ibc-section-7-checklist",
    title: "IN Checklist — IBC Section 7 / 9 Filing",
    category: "insolvency",
    tags: ["IN", "checklist", "ibc", "nclt"],
    body: `# Checklist — IBC Application

- [ ] Debt & default evidence
- [ ] Limitation check
- [ ] Form & fee
- [ ] Proposed IRP consent
- [ ] Advance service / e-filing`,
  },
  {
    slug: "in-dpdpa-compliance-checklist",
    title: "IN Checklist — DPDPA Compliance Readiness",
    category: "privacy",
    tags: ["IN", "checklist", "dpdpa", "compliance"],
    body: `# Checklist — DPDPA

- [ ] Data principal notice & consent records
- [ ] Purpose limitation map
- [ ] Cross-border transfer basis
- [ ] Significant Data Fiduciary triggers
- [ ] Breach notification playbook
- [ ] Retention & deletion schedule`,
  },
  {
    slug: "in-sebi-lodr-disclosure-checklist",
    title: "IN Checklist — SEBI LODR Material Disclosure",
    category: "corporate",
    tags: ["IN", "checklist", "sebi", "lodr"],
    body: `# Checklist — LODR Disclosure

- [ ] Event classification (Reg. 30)
- [ ] Timeline (immediate / 24h)
- [ ] Board / committee minutes
- [ ] Stock exchange filing pack
- [ ] Insider trading window check`,
  },
  {
    slug: "in-sarfaesi-enforcement-checklist",
    title: "IN Checklist — SARFAESI Enforcement Steps",
    category: "banking",
    tags: ["IN", "checklist", "sarfaesi", "banking"],
    body: `# Checklist — SARFAESI

- [ ] NPA classification evidence
- [ ] 13(2) notice
- [ ] Representation disposal
- [ ] 13(4) measures / symbolic possession
- [ ] DM / CMM application if needed
- [ ] Auction / sale compliance`,
  },
  {
    slug: "in-arbitration-section-11-checklist",
    title: "IN Checklist — Section 11 Appointment Petition",
    category: "arbitration",
    tags: ["IN", "checklist", "arbitration", "section-11"],
    body: `# Checklist — Section 11

- [ ] Arbitration agreement extract
- [ ] Notice invoking arbitration
- [ ] Seat / venue / rules
- [ ] Impasse evidence
- [ ] Proposed arbitrator disclosures`,
  },
];

const FILING_DRAFTS = [
  {
    slug: "in-bail-application-bnss",
    title: "IN Filing — Bail Application (BNSS)",
    category: "criminal",
    tags: ["IN", "filing-ready", "bail", "bnss"],
    body: `# BAIL APPLICATION

In the Court of ________  
Applicant / Accused: ________  
FIR No. ________ P.S. ________ Sections: ________ (BNS)

Most respectfully showeth…  
Prayer for regular / anticipatory bail with conditions as the Court may deem fit.`,
  },
  {
    slug: "in-specific-performance-plaint",
    title: "IN Filing — Suit for Specific Performance (outline)",
    category: "civil",
    tags: ["IN", "filing-ready", "specific-relief"],
    body: `# PLAINT — SPECIFIC PERFORMANCE

Plaintiff ________ vs Defendant ________  
Agreement dated ________; breach particulars; readiness & willingness; prayer for decree + injunction + costs.`,
  },
  {
    slug: "in-rti-first-appeal",
    title: "IN Filing — RTI First Appeal",
    category: "compliance",
    tags: ["IN", "filing-ready", "rti"],
    body: `# FIRST APPEAL UNDER RTI ACT

To: First Appellate Authority, ________  
Against CPIO reply dated ________ to RTI Application No. ________  
Grounds & prayer for disclosure.`,
  },
  {
    slug: "in-gst-appeal-outline",
    title: "IN Filing — GST Appeal Outline",
    category: "compliance",
    tags: ["IN", "filing-ready", "gst"],
    body: `# GST APPEAL OUTLINE

Appeal against Order-in-Original / Order-in-Appeal No. ________  
Questions of law/fact; pre-deposit; prayer.`,
  },
];

const TASKS = [
  {
    category: "litigation-dispute-resolution",
    slug: "in-sc-slp-strategy-memo",
    title: "IN — SLP strategy memorandum (Supreme Court)",
    jurisdiction: "IN",
    difficulty: "hard",
    prompt: "Draft an SLP strategy memo under Article 136 identifying questions of law, concurrent findings risk, and interim stay prospects.",
    tags: ["IN", "supreme-court", "slp"],
  },
  {
    category: "litigation-dispute-resolution",
    slug: "in-hc-writ-urgency-note",
    title: "IN — High Court writ urgency listing note",
    jurisdiction: "IN",
    difficulty: "medium",
    prompt: "Prepare an urgency note for listing a writ petition with interim prayer against a demolition / coercive action.",
    tags: ["IN", "writ", "urgency"],
  },
  {
    category: "banking-finance",
    slug: "in-ni-138-complaint-pack",
    title: "IN — NI Act 138 complaint pack outline",
    jurisdiction: "IN",
    difficulty: "medium",
    prompt: "Outline a Section 138 NI Act complaint with statutory notice timeline and evidence checklist.",
    tags: ["IN", "ni-act", "138"],
  },
  {
    category: "data-privacy-cybersecurity",
    slug: "in-dpdpa-ropa-gap",
    title: "IN — DPDPA RoPA gap analysis task",
    jurisdiction: "IN",
    difficulty: "hard",
    prompt: "Produce a Record of Processing Activities gap analysis against DPDPA obligations for a mid-size fintech.",
    tags: ["IN", "dpdpa", "ropa"],
  },
  {
    category: "corporate-governance",
    slug: "in-oppression-mismanagement-241",
    title: "IN — Companies Act s.241/242 petition outline",
    jurisdiction: "IN",
    difficulty: "hard",
    prompt: "Outline an oppression and mismanagement petition with reliefs under sections 241/242.",
    tags: ["IN", "companies-act", "nclt"],
  },
  {
    category: "employment-labor",
    slug: "in-posh-inquiry-checklist-task",
    title: "IN — POSH internal committee inquiry task",
    jurisdiction: "IN",
    difficulty: "medium",
    prompt: "Create an IC inquiry plan under the POSH Act with timelines, confidentiality, and report structure.",
    tags: ["IN", "posh", "employment"],
  },
  {
    category: "arbitration-international-dispute-resolution",
    slug: "in-section-9-interim-measures",
    title: "IN — Section 9 interim measures petition outline",
    jurisdiction: "IN",
    difficulty: "medium",
    prompt: "Outline a Section 9 petition for interim measures before commencement of arbitration.",
    tags: ["IN", "arbitration", "section-9"],
  },
  {
    category: "bankruptcy-restructuring",
    slug: "in-ibc-resolution-plan-issues",
    title: "IN — IBC resolution plan issue list",
    jurisdiction: "IN",
    difficulty: "hard",
    prompt: "List key legal issues for reviewing a resolution plan under IBC for a manufacturing corporate debtor.",
    tags: ["IN", "ibc", "resolution-plan"],
  },
  {
    category: "intellectual-property",
    slug: "in-trademark-opposition-brief",
    title: "IN — Trademark opposition brief outline",
    jurisdiction: "IN",
    difficulty: "medium",
    prompt: "Outline an opposition under the Trade Marks Act with confusion / prior use grounds.",
    tags: ["IN", "trademark", "ip"],
  },
  {
    category: "real-estate",
    slug: "in-rera-complaint-outline",
    title: "IN — RERA complaint outline",
    jurisdiction: "IN",
    difficulty: "medium",
    prompt: "Outline a homebuyer RERA complaint for delay and refund with interest.",
    tags: ["IN", "rera", "property"],
  },
  {
    category: "environmental-esg",
    slug: "in-ngt-application-outline",
    title: "IN — NGT original application outline",
    jurisdiction: "IN",
    difficulty: "hard",
    prompt: "Outline an NGT OA alleging environmental clearance violations with reliefs.",
    tags: ["IN", "ngt", "environment"],
  },
  {
    category: "tax",
    slug: "in-income-tax-appeal-itact",
    title: "IN — Income-tax appeal issues memo",
    jurisdiction: "IN",
    difficulty: "hard",
    prompt: "Draft issues for an ITAT appeal against an addition under the Income-tax Act.",
    tags: ["IN", "income-tax", "itat"],
  },
];

function asTemplate(row) {
  return {
    kind: row.tags.includes("checklist") ? "checklist" : "template",
    slug: row.slug,
    title: row.title,
    category: row.category,
    jurisdiction: "IN",
    description: row.title,
    tags: row.tags,
    body: row.body,
  };
}

const templates = [
  ...ORDER_INSTRUMENTS.map(asTemplate),
  ...CHECKLISTS.map(asTemplate),
  ...FILING_DRAFTS.map(asTemplate),
];

writeFileSync(
  path.join(dataDir, "seed-templates-in-parity-2026-07.json"),
  `${JSON.stringify(templates, null, 2)}\n`,
);
writeFileSync(
  path.join(dataDir, "seed-tasks-in-parity-2026-07.json"),
  `${JSON.stringify(TASKS, null, 2)}\n`,
);

console.log(
  JSON.stringify(
    {
      templates: templates.length,
      tasks: TASKS.length,
      note: "Merge via merge-nys-seed-expansions.mjs; EC2 reseed requires GO",
    },
    null,
    2,
  ),
);
