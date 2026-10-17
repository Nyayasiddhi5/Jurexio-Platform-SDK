#!/usr/bin/env node
/**
 * Generate deep IN/US template + task catalog expansions for NYS Knowledge Plane.
 * Output: data/seed-templates-{in,us}-catalog-2026-07.json
 *         data/seed-tasks-{in,us}-catalog-2026-07.json
 *
 * Run: node scripts/generate-nys-catalog-expansion.mjs
 * Then: node scripts/merge-nys-seed-expansions.mjs
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, "../data");

const TEMPLATE_CATEGORIES = [
  "criminal",
  "civil",
  "constitutional",
  "commercial",
  "litigation",
  "corporate",
  "consumer",
  "family",
  "banking",
  "arbitration",
  "insolvency",
  "employment",
  "property",
  "privacy",
  "compliance",
  "ip",
  "estate",
];

/** India practice / department framing per category */
const IN_META = {
  criminal: {
    acts: "BNS 2023 / BNSS 2023 / BSA 2023",
    dept: "Ministry of Home Affairs / State Police",
    caseTypes: ["FIR & investigation", "Bail & remand", "Charge-sheet defence", "Trial arguments", "Appeal / revision"],
  },
  civil: {
    acts: "CPC 1908 / Limitation Act / Specific Relief Act",
    dept: "Ministry of Law & Justice / Civil Courts",
    caseTypes: ["Plaint & written statement", "Interim injunction", "Execution", "Appeal", "Review"],
  },
  constitutional: {
    acts: "Constitution of India / Art. 32 & 226",
    dept: "Supreme Court / High Courts",
    caseTypes: ["Writ petition", "PIL", "Fundamental rights", "Service matters", "Federal disputes"],
  },
  commercial: {
    acts: "Indian Contract Act / Sale of Goods / Commercial Courts Act",
    dept: "Ministry of Commerce / Commercial Courts",
    caseTypes: ["Contract dispute", "Supply chain claim", "Guarantee enforcement", "Damages memo", "Settlement"],
  },
  litigation: {
    acts: "CPC / CrPC/BNSS procedure / Evidence (BSA)",
    dept: "District Judiciary / High Court",
    caseTypes: ["Case strategy", "Discovery plan", "Witness prep", "Hearing brief", "Settlement memo"],
  },
  corporate: {
    acts: "Companies Act 2013 / SEBI LODR / FEMA",
    dept: "MCA / SEBI / RBI",
    caseTypes: ["Board resolutions", "Shareholder dispute", "M&A diligence", "Oppression & mismanagement", "Regulatory filing"],
  },
  consumer: {
    acts: "Consumer Protection Act 2019",
    dept: "Department of Consumer Affairs",
    caseTypes: ["District Commission complaint", "Product liability", "Unfair trade practice", "Appeal", "Mediation"],
  },
  family: {
    acts: "HMA / HSA / Guardians and Wards / DV Act",
    dept: "Family Courts",
    caseTypes: ["Divorce petition", "Maintenance", "Custody", "DV protection", "Succession"],
  },
  banking: {
    acts: "NI Act / SARFAESI / IBC / RBI circulars",
    dept: "RBI / DRT / NCLT",
    caseTypes: ["Cheque bounce s.138", "SARFAESI challenge", "Loan recovery", "Guarantee claim", "DRT appeal"],
  },
  arbitration: {
    acts: "Arbitration & Conciliation Act 1996",
    dept: "Arbitration tribunals / Courts under ACA",
    caseTypes: ["Notice of arbitration", "Section 9 interim", "Section 11 appointment", "Section 34 challenge", "Enforcement"],
  },
  insolvency: {
    acts: "IBC 2016 / Companies Act",
    dept: "NCLT / NCLAT / IBBI",
    caseTypes: ["Section 7/9 application", "CIRP checklist", "Resolution plan review", "Liquidation", "Avoidance actions"],
  },
  employment: {
    acts: "Industrial Relations Code / Shops & Establishments / POSH",
    dept: "Ministry of Labour / Labour Courts",
    caseTypes: ["Termination challenge", "POSH enquiry", "Wage claim", "Settlement agreement", "Labour audit"],
  },
  property: {
    acts: "Transfer of Property Act / Registration Act / RERA",
    dept: "State Revenue / RERA Authority",
    caseTypes: ["Title diligence", "Specific performance", "RERA complaint", "Partition", "Lease dispute"],
  },
  privacy: {
    acts: "DPDPA 2023 / IT Act / SPDI Rules (legacy)",
    dept: "MeitY / Data Protection Board",
    caseTypes: ["Consent notice", "DPIA", "Breach response", "Cross-border transfer", "Data principal request"],
  },
  compliance: {
    acts: "Prevention of Corruption / PMLA / Competition Act / GST",
    dept: "ED / CBI / CCI / CBIC",
    caseTypes: ["Internal investigation", "Dawn raid response", "Leniency", "Policy gap assessment", "Board briefing"],
  },
  ip: {
    acts: "Trade Marks Act / Patents Act / Copyright Act",
    dept: "CGPDTM / IPAB successor benches",
    caseTypes: ["TM opposition", "Patent FTO", "Copyright notice", "Infringement suit", "Licensing"],
  },
  estate: {
    acts: "Indian Succession Act / Hindu Succession / Trusts Act",
    dept: "Civil Courts / Probate",
    caseTypes: ["Will drafting", "Probate petition", "Letters of administration", "Trust deed", "Family settlement"],
  },
};

const US_META = {
  criminal: {
    acts: "Title 18 USC / FRCrP / Speedy Trial Act",
    dept: "DOJ / USAO / Federal Defender",
    caseTypes: ["Indictment review", "Detention hearing", "Plea agreement", "Motion to suppress", "Sentencing memo"],
  },
  civil: {
    acts: "28 USC / FRCP / state codes of civil procedure",
    dept: "Federal & State Courts",
    caseTypes: ["Complaint", "Answer & affirmative defenses", "Discovery plan", "Summary judgment", "Appeal brief"],
  },
  constitutional: {
    acts: "US Constitution / 42 USC § 1983",
    dept: "Federal Courts",
    caseTypes: ["§ 1983 complaint", "Preliminary injunction", "Qualified immunity brief", "Habeas", "Cert petition outline"],
  },
  commercial: {
    acts: "UCC Arts. 2/9 / Restatement (Contracts)",
    dept: "State commercial courts / federal diversity",
    caseTypes: ["Breach of contract", "UCC remedies", "Guaranty enforcement", "Demand letter", "Settlement"],
  },
  litigation: {
    acts: "FRCP / FRE / local rules",
    dept: "Litigation practice",
    caseTypes: ["Case assessment", "ESI protocol", "Deposition outline", "Hearing binder", "Mediation brief"],
  },
  corporate: {
    acts: "DGCL / Model Business Corporation Act / Exchange Act",
    dept: "SEC / Delaware Court of Chancery",
    caseTypes: ["Board minutes", "Stockholder consent", "SPA diligence", "Fiduciary duty memo", "8-K checklist"],
  },
  consumer: {
    acts: "FTC Act / TCPA / FCRA / state UDAP",
    dept: "FTC / CFPB / AG offices",
    caseTypes: ["UDAP complaint response", "Class action intake", "TCPA defense", "Settlement class notice", "CID response"],
  },
  family: {
    acts: "State domestic relations codes / UCCJEA",
    dept: "Family / Domestic Relations Courts",
    caseTypes: ["Divorce petition", "Temporary orders", "Custody evaluation", "Support calculation", "QDRO"],
  },
  banking: {
    acts: "TILA / RESPA / BSA / National Bank Act",
    dept: "OCC / FDIC / Fed / CFPB",
    caseTypes: ["Loan default", "Foreclosure defense", "BSA SAR memo", "Guaranty claim", "Regulatory exam response"],
  },
  arbitration: {
    acts: "FAA / AAA / JAMS rules",
    dept: "Arbitration forums",
    caseTypes: ["Demand for arbitration", "Motion to compel", "Interim relief", "Award challenge", "Confirmation petition"],
  },
  insolvency: {
    acts: "11 USC Bankruptcy Code",
    dept: "US Bankruptcy Courts",
    caseTypes: ["Ch. 11 first-day", "Proof of claim", "Preference analysis", "Plan confirmation", "341 prep"],
  },
  employment: {
    acts: "Title VII / ADA / ADEA / FLSA / NLRA",
    dept: "EEOC / DOL / NLRB",
    caseTypes: ["EEOC charge response", "Separation agreement", "Wage & hour audit", "Investigation memo", "Arbitration demand"],
  },
  property: {
    acts: "State property codes / RESPA / FIRREA",
    dept: "State courts / land records",
    caseTypes: ["Title objection", "Quiet title", "Commercial lease dispute", "Construction lien", "Closing checklist"],
  },
  privacy: {
    acts: "CCPA/CPRA / HIPAA / GLBA / state privacy acts",
    dept: "FTC / HHS OCR / State AGs",
    caseTypes: ["Privacy notice", "DPIA", "Breach notice", "DSAR response", "Vendor DPA"],
  },
  compliance: {
    acts: "FCPA / SOX / AML / antitrust / sanctions",
    dept: "DOJ / SEC / OFAC / FinCEN",
    caseTypes: ["Internal investigation", "Monitorship report", "OFAC screening", "Whistleblower intake", "Board update"],
  },
  ip: {
    acts: "35 USC / 15 USC Lanham / 17 USC Copyright",
    dept: "USPTO / ITC / Federal Circuit",
    caseTypes: ["Patent claim chart", "TM opposition", "DMCA notice", "License agreement", "ITC 337 outline"],
  },
  estate: {
    acts: "Uniform Probate Code / IRC Subtitle B",
    dept: "Probate courts / IRS",
    caseTypes: ["Will & pour-over", "Trust funding", "Probate petition", "706 estate tax outline", "Beneficiary notice"],
  },
};

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72);
}

function draftBody(jur, cat, meta, caseType) {
  const law = jur === "IN" ? "Indian law" : "U.S. law";
  return `# ${caseType} — Draft Template (${jur})

**Practice area:** ${cat}
**Primary authorities:** ${meta.acts}
**Department / forum:** ${meta.dept}
**Governing law:** ${law}

## Caption / parties
[COURT OR FORUM]

[PARTY A] — [role]
v.
[PARTY B] — [role]
Matter / Case No. ________

## Purpose
Prepare a practitioner-ready draft for **${caseType}** covering facts, legal issues, prayer/relief, and annexures.

## Structure
1. **Parties and jurisdiction.** Identify capacity, residence/incorporation, and basis for forum competence.
2. **Material facts.** Chronology with dates, documents, and witnesses; mark contested vs. admitted facts.
3. **Issues / causes of action.** Map each claim or defence to ${meta.acts}.
4. **Legal analysis.** Cite only verified authorities; distinguish adverse precedent; note amendments/orders in force as of [DATE].
5. **Relief sought.** Precise prayers, interim relief, costs, and alternative remedies.
6. **Verification / certificate.** Counsel certification, list of dates, and annexure index.

## Placeholders
- [CLIENT], [OPPOSING PARTY], [DATE], [AMOUNT], [STATUTE SECTION], [FORUM]

## Drafting notes
- Confirm the latest consolidated text and any amending Act / Ordinance / Rules / Circular before filing.
- Cross-check limitation / statute of limitations and mandatory pre-suit notices.
- Align facts with underlying evidence; never invent citations.
- For ${jur === "IN" ? "India" : "the United States"}, verify local practice directions and filing formats.
- Flag conflicts of interest and privilege before circulation.

*Nyayasiddhi Knowledge Plane catalog — ${jur} ${cat} / ${caseType}*
`;
}

function researchBody(jur, cat, meta, caseType) {
  return `# Research Memorandum — ${caseType} (${jur})

**To:** [Partner / Client]
**From:** [Associate]
**Re:** Research on ${caseType} under ${meta.acts}
**Date:** [DATE]
**Jurisdiction:** ${jur} | Practice: ${cat} | Forum focus: ${meta.dept}

## Question presented
Whether and how ${caseType.toLowerCase()} remedies are available under ${meta.acts}, including recent amendments and binding precedent.

## Brief answer
[1–3 sentences with confidence level: High / Medium / Low]

## Facts assumed
1. [ASSUMED FACT 1]
2. [ASSUMED FACT 2]

## Discussion
### A. Statutory framework
Summarise operative sections of ${meta.acts} relevant to ${caseType}, noting amendments/orders effective as of [DATE].

### B. Elements / tests
List each element or regulatory test with burden of proof and leading cases (verify citations via Knowledge Plane caselaw search).

### C. Counter-arguments
Anticipate opposing constructions and distinguish adverse authority.

### D. Practical risks
Forum strategy, limitation, costs, enforcement, and reputational/regulatory exposure (${meta.dept}).

## Conclusion & next steps
Recommended filing / negotiation path; documents to collect; open research questions.

**Research checklist**
- [ ] Pull latest Act text + amending instruments
- [ ] Search Knowledge Plane caselaw (jurisdiction=${jur})
- [ ] Confirm secondary sources / practice notes
- [ ] Cite-check every authority before circulation
`;
}

function checklistBody(jur, cat, meta, caseType) {
  return `# Checklist — ${caseType} (${jur} / ${cat})

**Authorities:** ${meta.acts}
**Forum / department:** ${meta.dept}

## Intake
- [ ] Conflict check completed and documented
- [ ] Engagement letter / fee agreement signed
- [ ] Client identity and KYC / CIP verified
- [ ] Matter jurisdiction tagged ${jur}; practice area ${cat}

## Facts & evidence
- [ ] Chronology prepared with document map
- [ ] Key exhibits gathered and Bates/indexed
- [ ] Witness list and contact details secured
- [ ] Privilege / work-product log started

## Law & procedure
- [ ] Confirm current text of ${meta.acts} (amendments/orders)
- [ ] Limitation / SOL diary entries calendared
- [ ] Mandatory notices / pre-suit requirements identified
- [ ] Forum rules, stamps/fees, and filing format verified

## Work product for ${caseType}
- [ ] Draft pleading / motion / memo outline approved
- [ ] Cite-check via Knowledge Plane (caselaw + statutes)
- [ ] Peer / partner review completed
- [ ] Client approval obtained where required

## Filing & follow-up
- [ ] File / serve / e-file with proof of service
- [ ] Diary next hearing / response deadline
- [ ] Update matter status and HITL if AI-assisted draft used
- [ ] Archive final PDF/DOCX to matter vault

**Notes:** Treat AI outputs as drafts only; human counsel remains responsible for accuracy.
`;
}

function amendmentOrderBody(jur, cat, meta) {
  return `# Amendment / Order / Circular Tracking Note (${jur} — ${cat})

**Primary Act(s):** ${meta.acts}
**Regulator / department:** ${meta.dept}

## Instrument metadata
| Field | Value |
|---|---|
| Instrument type | [Amending Act / Ordinance / Rules / Order / Circular / Notification] |
| Citation / Gazette | [CITE] |
| Date of assent / publication | [DATE] |
| Effective date | [DATE] / [phased] |
| Supersedes | [PRIOR INSTRUMENT] |

## Operative changes
1. Sections inserted / substituted / omitted: [LIST]
2. Transitional provisions: [SUMMARY]
3. Impact on pending matters: [SUMMARY]

## Practice implications (${cat})
- Pleadings / forms to update: [LIST]
- Compliance controls to revise: [LIST]
- Training / SOP updates: [LIST]

## Knowledge Plane actions
- [ ] Upsert amended sections into statutes corpus (jurisdiction=${jur})
- [ ] Refresh embeddings for touched codes
- [ ] Update related templates and checklists in this category
- [ ] Notify ecosystem partners (NSP / NYM / JRX) via release note

**Drafting notes:** Prefer primary Gazette / CFR / Federal Register sources; never rely on secondary summaries alone.
`;
}

function buildTemplates(jur, metaMap) {
  const out = [];
  for (const cat of TEMPLATE_CATEGORIES) {
    const meta = metaMap[cat];
    const prefix = jur.toLowerCase();
    // One research + one amendment tracker per category
    out.push({
      kind: "template",
      slug: `${prefix}-${cat}-research-memo`,
      title: `${jur} Research Memo — ${cat.replace(/-/g, " ")} (${meta.acts.split(" / ")[0]})`,
      category: cat,
      jurisdiction: jur,
      description: `Deep research memorandum skeleton for ${cat} matters under ${meta.acts}, oriented to ${meta.dept}.`,
      tags: [jur, cat, "research", "memo", "practice-area"],
      body: researchBody(jur, cat, meta, meta.caseTypes[0]),
    });
    out.push({
      kind: "template",
      slug: `${prefix}-${cat}-amendment-order-tracker`,
      title: `${jur} Amendment/Order Tracker — ${cat}`,
      category: cat,
      jurisdiction: jur,
      description: `Structured note for Acts, amendments, rules, orders and circulars affecting ${cat} practice (${meta.acts}).`,
      tags: [jur, cat, "amendment", "order", "circular", "gazette"],
      body: amendmentOrderBody(jur, cat, meta),
    });
    // Draft + checklist per case type
    for (const caseType of meta.caseTypes) {
      const s = slugify(caseType);
      out.push({
        kind: "template",
        slug: `${prefix}-${cat}-draft-${s}`,
        title: `${jur} Draft — ${caseType}`,
        category: cat,
        jurisdiction: jur,
        description: `Comprehensive draft template for ${caseType} (${meta.acts}).`,
        tags: [jur, cat, "draft", "pleading", s],
        body: draftBody(jur, cat, meta, caseType),
      });
      out.push({
        kind: "checklist",
        slug: `${prefix}-${cat}-checklist-${s}`,
        title: `${jur} Checklist — ${caseType}`,
        category: cat,
        jurisdiction: jur,
        description: `End-to-end checklist for ${caseType} matters under ${meta.acts}.`,
        tags: [jur, cat, "checklist", "case-type", s],
        body: checklistBody(jur, cat, meta, caseType),
      });
    }
  }
  return out;
}

const TASK_CATEGORIES = Object.keys({
  "antitrust-competition": 1,
  "arbitration-international-dispute-resolution": 1,
  "banking-finance": 1,
  "bankruptcy-restructuring": 1,
  "capital-markets": 1,
  "corporate-governance": 1,
  "corporate-ma": 1,
  "data-privacy-cybersecurity": 1,
  "emerging-companies-venture-capital": 1,
  "employment-labor": 1,
  "energy-natural-resources": 1,
  "environmental-esg": 1,
  "funds-asset-management": 1,
  "healthcare-life-sciences": 1,
  immigration: 1,
  insurance: 1,
  "intellectual-property": 1,
  "international-trade-sanctions": 1,
  "litigation-dispute-resolution": 1,
  "real-estate": 1,
  "structured-finance-securitization": 1,
  tax: 1,
  "trusts-estates-private-client": 1,
  "white-collar-defense-investigations": 1,
});

function buildTasks(jur, countPerCategory = 1) {
  const out = [];
  for (const category of TASK_CATEGORIES) {
    for (let i = 1; i <= countPerCategory; i++) {
      const slug = `${jur.toLowerCase()}-catalog-${category}-workup-${i}`;
      out.push({
        category,
        slug,
        title: `${jur} Matter Workup — ${category.replace(/-/g, " ")} (Pack ${i})`,
        work_type: "analyze",
        tags: [jur, category, "catalog", "checklist", "research"],
        instructions: `Prepare a jurisdiction-specific (${jur}) matter workup for ${category.replace(/-/g, " ")}. Use Knowledge Plane statutes and caselaw for ${jur} only. Deliver: (1) issues list mapped to Acts/Titles, (2) draft outline, (3) evidence checklist, (4) risk rating. Output: \`workup-memo.docx\`. Do not invent citations.`,
        deliverables: {
          "workup-memo.docx": "workup-memo.docx",
        },
        documents: ["client-intake.docx", "key-exhibits-index.xlsx"],
        jurisdiction: jur,
        criteria: [
          {
            id: "C-001",
            title: `Jurisdiction locked to ${jur}`,
            match_criteria: `PASS if the memo expressly states governing jurisdiction ${jur} and does not rely on the other jurisdiction's primary statutes as controlling. FAIL if ${jur === "IN" ? "US" : "Indian"} statutes are treated as controlling without comparative framing.`,
          },
          {
            id: "C-002",
            title: "Issues mapped to primary authorities",
            match_criteria: "PASS if at least three discrete legal issues are listed with corresponding Act/Title or Code references. FAIL if issues lack statutory anchors.",
          },
          {
            id: "C-003",
            title: "Evidence checklist present",
            match_criteria: "PASS if the memo includes a numbered evidence or document checklist with at least five items. FAIL if no checklist or fewer than five items.",
          },
          {
            id: "C-004",
            title: "Risk rating with rationale",
            match_criteria: "PASS if the memo assigns High/Medium/Low (or equivalent) risk with a one-paragraph rationale. FAIL if risk is missing or unexplained.",
          },
          {
            id: "C-005",
            title: "Cite-check / no fabricated authorities",
            match_criteria: "PASS if the memo warns that authorities must be verified via Knowledge Plane retrieve/search and does not invent case citations. FAIL if clearly fabricated case names or section numbers appear.",
          },
        ],
      });
    }
  }
  return out;
}

const inTemplates = buildTemplates("IN", IN_META);
const usTemplates = buildTemplates("US", US_META);
const inTasks = buildTasks("IN", 1);
const usTasks = buildTasks("US", 1);

writeFileSync(path.join(dataDir, "seed-templates-in-catalog-2026-07.json"), `${JSON.stringify(inTemplates, null, 2)}\n`);
writeFileSync(path.join(dataDir, "seed-templates-us-catalog-2026-07.json"), `${JSON.stringify(usTemplates, null, 2)}\n`);
writeFileSync(path.join(dataDir, "seed-tasks-in-catalog-2026-07.json"), `${JSON.stringify(inTasks, null, 2)}\n`);
writeFileSync(path.join(dataDir, "seed-tasks-us-catalog-2026-07.json"), `${JSON.stringify(usTasks, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      inTemplates: inTemplates.length,
      usTemplates: usTemplates.length,
      inTasks: inTasks.length,
      usTasks: usTasks.length,
    },
    null,
    2,
  ),
);
