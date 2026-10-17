#!/usr/bin/env node
/**
 * India court-aligned FINAL instrument templates (Nyayasiddhi Knowledge Plane).
 *
 * Taxonomy (tags — queryable):
 *   court:supreme-court | court:high-court | court:district-court | court:contractual
 *   tier:1-simple | tier:2-court-aligned | tier:3-comprehensive
 *   quality:final-instrument
 *   authority:<rules/forms provenance key>
 *
 * Tier meaning:
 *   1 — Simple fillable final form (caption + parties + prayer)
 *   2 — Strong court-rules-aligned pleading (SC Rules / HC rules / CPC Schedules)
 *   3 — Comprehensive high-level instrument (full schedules, verification, annexures / contract depth)
 *
 * Honesty: bodies follow publicly known court rules, CPC forms, and standard Indian
 * practice — NOT scanned government-sealed PDFs. Always verify latest practice
 * directions / e-filing formats before filing.
 *
 * Output: data/seed-templates-in-court-tiers-2026-07.json
 * Run: node scripts/generate-nys-india-court-tier-templates.mjs
 * Then: node scripts/merge-nys-seed-expansions.mjs
 * Worker reseed requires explicit GO.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, "../data");

/**
 * @typedef {'supreme-court'|'high-court'|'district-court'|'contractual'} Court
 * @typedef {1|2|3} Tier
 */

/** @param {object} o */
function tpl(o) {
  const tierTag =
    o.tier === 1 ? "tier:1-simple" : o.tier === 2 ? "tier:2-court-aligned" : "tier:3-comprehensive";
  const courtTag = `court:${o.court}`;
  const tierLabel =
    o.tier === 1
      ? "Tier 1 · Simple final form"
      : o.tier === 2
        ? "Tier 2 · Strong court-rules-aligned"
        : "Tier 3 · Comprehensive high-level";
  return {
    kind: "template",
    slug: o.slug,
    title: o.title,
    category: o.category,
    jurisdiction: "IN",
    description: `${tierLabel}. Forum: ${o.court.replace(/-/g, " ")}. ${o.description} Provenance: ${o.authorityLabel}. Verify current e-filing / practice directions before filing.`,
    tags: [
      "IN",
      courtTag,
      tierTag,
      "quality:final-instrument",
      "filing-ready",
      `authority:${o.authorityKey}`,
      ...(o.extraTags || []),
    ],
    body: o.body,
  };
}

function metaBlock(court, tier, authority) {
  return `<!--
nys-instrument: final
jurisdiction: IN
court: ${court}
tier: ${tier}
authority: ${authority}
quality: final-instrument
-->`;
}

function verificationBlock() {
  return `
## VERIFICATION

I, ________, the ________ above-named, do hereby solemnly affirm and state that the contents of paragraphs ________ are true to my personal knowledge and that the contents of paragraphs ________ are based on information received and believed to be true. No part of this pleading is false and nothing material has been concealed.

Verified at ________ on this ____ day of ________, 20____.

**Deponent**

## ADVOCATE'S CERTIFICATE / UNDERTAKING

Certified that the above pleading is drafted by me / under my instructions and that the annexures referred to are true copies of the originals.

**Advocate** · Enrolment No. ________ · Place ________ · Date ________`;
}

// ─── SUPREME COURT ───────────────────────────────────────────────────────────

const SC = [
  tpl({
    slug: "in-sc-t1-slp-art136-simple",
    title: "SC Tier-1 — Special Leave Petition (Art. 136) · Simple Final Form",
    category: "constitutional",
    court: "supreme-court",
    tier: 1,
    authorityKey: "sc-rules-2013-order-xxi",
    authorityLabel: "Supreme Court Rules, 2013 — Order XXI (SLP)",
    extraTags: ["slp", "article-136", "order"],
    description: "Caption, parties, questions of law, and prayer in Supreme Court SLP format.",
    body: `${metaBlock("supreme-court", 1, "Supreme Court Rules, 2013 Order XXI")}

# SPECIAL LEAVE PETITION
## UNDER ARTICLE 136 OF THE CONSTITUTION OF INDIA

**IN THE SUPREME COURT OF INDIA**  
**CIVIL / CRIMINAL APPELLATE JURISDICTION**

**Special Leave Petition (C / Crl.) No. ________ of 20____**

**BETWEEN**  
________ … Petitioner(s)  
**AND**  
________ … Respondent(s)

**Petition for Special Leave to Appeal against the Judgment / Order dated ________ passed by the Hon'ble High Court of ________ in ________ No. ________ of 20____.**

### A. QUESTIONS OF LAW
1. Whether ________?
2. Whether ________?

### B. GROUNDS (brief)
1. The Impugned Order suffers from ________.
2. The Impugned Order is contrary to ________.

### C. PRAYER
It is most respectfully prayed that this Hon'ble Court may be pleased to:
(a) grant special leave to appeal;
(b) stay operation of the Impugned Order;
(c) pass such other order(s) as this Hon'ble Court may deem fit.

Place: New Delhi  
Date: ________  

**Advocate-on-Record**  
Name / Code: ________  
${verificationBlock()}`,
  }),

  tpl({
    slug: "in-sc-t2-slp-art136-aligned",
    title: "SC Tier-2 — Special Leave Petition (Art. 136) · Court-Rules Aligned",
    category: "constitutional",
    court: "supreme-court",
    tier: 2,
    authorityKey: "sc-rules-2013-order-xxi",
    authorityLabel: "Supreme Court Rules, 2013 — Order XXI + Office Report practice",
    extraTags: ["slp", "article-136", "order"],
    description: "Full SLP structure with synopsis, list of dates, grounds, interim relief, and office checklist.",
    body: `${metaBlock("supreme-court", 2, "Supreme Court Rules, 2013 Order XXI")}

# SPECIAL LEAVE PETITION UNDER ARTICLE 136
## IN THE SUPREME COURT OF INDIA
### CIVIL / CRIMINAL APPELLATE JURISDICTION

**S.L.P. (C / Crl.) No. ________ of 20____**  
*(Against the Judgment and Order dated ________ of the High Court of ________ in ________ No. ________ of 20____)*

**Petitioner(s):** ________  
**Respondent(s):** ________  

---

### 1. SYNOPSIS AND LIST OF DATES
| Date | Event |
|------|--------|
| ________ | ________ |
| ________ | Impugned Judgment / Order |

### 2. PROFORMA / OFFICE PARTICULARS
- Court below: High Court of ________ · Bench ________  
- Impugned Judgment / Order: dated ________ · Neutral citation (if any): ________  
- Limitation: within time / delay of ____ days (application for condonation enclosed)  
- Caveat: lodged / not lodged  

### 3. DECLARATION AS TO INTERLOCUTORY APPLICATIONS
IAs filed: (i) Stay (ii) Condonation of delay (iii) Exemption from filing certified copies / O.T. (as applicable).

### 4. QUESTIONS OF LAW (precise)
1. ________  
2. ________  
3. ________  

### 5. GROUNDS
**A.** The Impugned Order is contrary to the law laid down in ________.  
**B.** The Court below failed to consider ________.  
**C.** The Impugned Order occasions grave miscarriage of justice because ________.  
**D.** The Impugned Order is perverse / suffers from patent illegality in that ________.

### 6. GROUNDS FOR INTERIM RELIEF
Balance of convenience · irreparable injury · prima facie case: ________.

### 7. MAIN PRAYER
(a) Grant special leave to appeal;  
(b) Set aside / modify the Impugned Order;  
(c) Grant interim stay;  
(d) Pass any other order(s) as deemed fit.

### 8. ANNEXURES INDEX
| Annexure | Description | Page |
|----------|-------------|------|
| P-1 | Impugned Judgment / Order | |
| P-2 | Pleadings before High Court (as necessary) | |
| P-3 | ________ | |

${verificationBlock()}

### ADVOCATE-ON-RECORD CERTIFICATE
Certified that the petition is drawn in accordance with the Supreme Court Rules, 2013 and that the Annexures are true copies.

**AOR Name / Code:** ________`,
  }),

  tpl({
    slug: "in-sc-t3-writ-art32-comprehensive",
    title: "SC Tier-3 — Writ Petition (Art. 32) · Comprehensive Final Instrument",
    category: "constitutional",
    court: "supreme-court",
    tier: 3,
    authorityKey: "sc-rules-2013-writ",
    authorityLabel: "Constitution Art. 32 · Supreme Court Rules, 2013 (Writ practice)",
    extraTags: ["writ", "article-32", "fundamental-rights"],
    description: "Comprehensive Article 32 petition with rights matrix, parties array, interim prayer, and annexure schedule.",
    body: `${metaBlock("supreme-court", 3, "Constitution Art. 32 · SC Rules 2013")}

# WRIT PETITION UNDER ARTICLE 32 OF THE CONSTITUTION OF INDIA
## IN THE SUPREME COURT OF INDIA
### ORIGINAL WRIT JURISDICTION

**Writ Petition (Civil / Criminal) No. ________ of 20____**

**IN THE MATTER OF:**  
________ … Petitioner(s)  
**VERSUS**  
1. Union of India through ________  
2. State of ________ through ________  
3. ________ … Respondent(s)

---

### PART A — MAINTAINABILITY
1. The Petitioner approaches this Hon'ble Court under Article 32 for enforcement of fundamental rights under Articles ________.
2. The Impugned action/order dated ________ of Respondent No. ____ directly infringes the said rights.
3. Alternative remedy: ________ (not efficacious because ________).

### PART B — ARRAY OF PARTIES
| No. | Name / Designation | Capacity | Address for service |
|-----|--------------------|----------|---------------------|
| P-1 | | Petitioner | |
| R-1 | | Contesting | |
| R-2 | | Proforma / Necessary | |

### PART C — FACTS (CHRONOLOGY)
1. On ________, ________. *(Annexure P-1)*  
2. On ________, ________. *(Annexure P-2)*  
3. On ________, the Impugned Order / Action ________. *(Annexure P-3)*

### PART D — FUNDAMENTAL RIGHTS MATRIX
| Right | Impugned act | How infringed | Relief linkage |
|-------|--------------|---------------|----------------|
| Art. 14 | | | Prayer (a) |
| Art. 19 | | | Prayer (b) |
| Art. 21 | | | Prayer (c) |

### PART E — GROUNDS
**A. Illegality / ultra vires.** ________  
**B. Arbitrariness / non-application of mind.** ________  
**C. Proportionality / Wednesbury.** ________  
**D. Violation of natural justice.** ________  
**E. Conflict with binding precedent.** ________  

### PART F — INTERIM RELIEF
Pending disposal, stay of ________; status quo as on ________; production of record.

### PART G — MAIN PRAYER
(a) Issue a writ of ________ quashing ________;  
(b) Issue a writ of mandamus directing ________;  
(c) Declare ________ ultra vires / unconstitutional;  
(d) Award costs;  
(e) Pass any other order(s) as deemed fit.

### PART H — SCHEDULE OF ANNEXURES
| Ann. | Description | Pages |
|------|-------------|-------|
| P-1 | | |
| P-2 | | |
| P-3 | Impugned Order | |

${verificationBlock()}`,
  }),

  tpl({
    slug: "in-sc-t2-transfer-petition",
    title: "SC Tier-2 — Transfer Petition (Civil/Criminal) · Court-Rules Aligned",
    category: "litigation",
    court: "supreme-court",
    tier: 2,
    authorityKey: "cpc-s25-crpc-bnss-transfer",
    authorityLabel: "CPC s.25 / BNSS transfer jurisdiction · SC practice",
    extraTags: ["transfer", "order"],
    description: "Transfer petition seeking transfer of proceedings between courts.",
    body: `${metaBlock("supreme-court", 2, "CPC s.25 / BNSS transfer · SC practice")}

# TRANSFER PETITION
## IN THE SUPREME COURT OF INDIA

**Transfer Petition (Civil / Criminal) No. ________ of 20____**

**Petitioner:** ________  
**Respondents:** ________  

**Seeking transfer of ________ No. ________ pending before ________ to ________.**

### FACTS & GROUNDS
1. Pending proceedings: ________  
2. Convenience of parties / witnesses: ________  
3. Risk of conflicting judgments / identical questions: ________  
4. Balance of convenience and ends of justice: ________  

### PRAYER
(a) Transfer ________ No. ________ from ________ to ________;  
(b) Stay further proceedings pending decision;  
(c) Pass any other order(s) as deemed fit.

${verificationBlock()}`,
  }),

  tpl({
    slug: "in-sc-t2-contempt-petition",
    title: "SC Tier-2 — Contempt Petition · Court-Rules Aligned",
    category: "litigation",
    court: "supreme-court",
    tier: 2,
    authorityKey: "contempt-of-courts-act-1971",
    authorityLabel: "Contempt of Courts Act, 1971 · SC Rules (Contempt)",
    extraTags: ["contempt", "order"],
    description: "Contempt petition for wilful disobedience of Supreme Court order.",
    body: `${metaBlock("supreme-court", 2, "Contempt of Courts Act, 1971")}

# CONTEMPT PETITION
## IN THE SUPREME COURT OF INDIA

**Contempt Petition (Civil / Criminal) No. ________ of 20____**  
*(In ________ No. ________ of 20____)*

**Petitioner:** ________  
**Alleged Contemnors:** ________  

### ORDER ALLEGEDLY VIOLATED
Date: ________ · Operative directions: ________ *(Annexure C-1)*

### ACTS OF WILFUL DISOBEDIENCE
1. On ________, Contemnor ________. *(Annexure C-2)*  
2. Despite notice / knowledge, Contemnor failed to ________.

### PRAYER
(a) Initiate contempt proceedings;  
(b) Punish the Contemnors in accordance with law;  
(c) Direct compliance / purge of contempt;  
(d) Pass any other order(s) as deemed fit.

${verificationBlock()}`,
  }),

  tpl({
    slug: "in-sc-t1-caveat",
    title: "SC Tier-1 — Caveat · Simple Final Form",
    category: "litigation",
    court: "supreme-court",
    tier: 1,
    authorityKey: "sc-caveat-practice",
    authorityLabel: "Supreme Court caveat practice",
    extraTags: ["caveat"],
    description: "Caveat opposing ex-parte interim orders on anticipated SLP/appeal.",
    body: `${metaBlock("supreme-court", 1, "SC caveat practice")}

# CAVEAT
## IN THE SUPREME COURT OF INDIA

**Caveat No. ________ of 20____**

Caveator: ________  
Likely Petitioner(s): ________  
Subject matter: Anticipated Special Leave Petition / Appeal against Judgment/Order dated ________ of ________ in ________ No. ________.

The Caveator undertakes to accept notice and appear. No ex-parte interim order be passed without notice.

Date: ________ · **Advocate-on-Record** ________`,
  }),
];

// ─── HIGH COURT ──────────────────────────────────────────────────────────────

const HC = [
  tpl({
    slug: "in-hc-t1-writ-226-simple",
    title: "HC Tier-1 — Writ Petition (Art. 226) · Simple Final Form",
    category: "constitutional",
    court: "high-court",
    tier: 1,
    authorityKey: "constitution-art-226",
    authorityLabel: "Constitution Art. 226 · High Court writ practice",
    extraTags: ["writ", "article-226"],
    description: "Simple High Court writ caption, grounds, and prayer.",
    body: `${metaBlock("high-court", 1, "Constitution Art. 226")}

# WRIT PETITION UNDER ARTICLE 226
## IN THE HIGH COURT OF ________ AT ________

**W.P. (C / Crl.) No. ________ of 20____**

**Petitioner:** ________  
**Respondents:** ________  

### FACTS (brief)
________

### GROUNDS (brief)
1. Violation of Art. ________  
2. Without jurisdiction / arbitrary  

### PRAYER
(a) Issue writ of ________ quashing ________ dated ________;  
(b) Grant interim stay;  
(c) Pass any other order(s) as deemed fit.

${verificationBlock()}`,
  }),

  tpl({
    slug: "in-hc-t2-writ-226-aligned",
    title: "HC Tier-2 — Writ Petition (Art. 226) · Court-Rules Aligned",
    category: "constitutional",
    court: "high-court",
    tier: 2,
    authorityKey: "constitution-art-226-hc-rules",
    authorityLabel: "Constitution Art. 226 · applicable High Court Writ Rules / Practice Directions",
    extraTags: ["writ", "article-226", "order"],
    description: "Full Art. 226 petition with maintainability, alternative remedy, interim, and annexures.",
    body: `${metaBlock("high-court", 2, "Art. 226 · HC Writ Rules")}

# WRIT PETITION UNDER ARTICLE 226 OF THE CONSTITUTION OF INDIA
## IN THE HIGH COURT OF ________
### CIVIL / CRIMINAL WRIT JURISDICTION

**Writ Petition No. ________ of 20____**

**Petitioner:** ________  
**Respondents:**  
1. State of ________ through ________  
2. ________  

---

### 1. MAINTAINABILITY & JURISDICTION
Territorial · subject-matter · cause of action arose at ________.

### 2. ALTERNATIVE REMEDY
________ — not efficacious because ________.

### 3. FACTS
Chronology with annexure references: ________

### 4. IMPUGNED ORDER / ACTION
Date ________ · Authority ________ · Operative portion ________ *(Annexure P-__)*

### 5. GROUNDS
A. Illegality  
B. Irrationality / Wednesbury  
C. Procedural impropriety / natural justice  
D. Disproportionality  
E. Violation of Arts. 14 / 19 / 21  

### 6. INTERIM RELIEF
________

### 7. PRAYER
(a) Certiorari / Mandamus / Prohibition / Quo Warranto as applicable;  
(b) Interim stay / status quo;  
(c) Costs;  
(d) Any other relief.

### 8. LIST OF DATES & ANNEXURES
| Date / Ann. | Particulars |
|-------------|-------------|
| | |

${verificationBlock()}`,
  }),

  tpl({
    slug: "in-hc-t3-criminal-appeal-comprehensive",
    title: "HC Tier-3 — Criminal Appeal · Comprehensive Final Instrument",
    category: "criminal",
    court: "high-court",
    tier: 3,
    authorityKey: "bnss-criminal-appeal-hc",
    authorityLabel: "BNSS / CrPC appeal provisions · High Court criminal appellate practice",
    extraTags: ["appeal", "criminal", "bnss"],
    description: "Comprehensive criminal appeal with grounds of fact/law, sentence challenge, and bail pending appeal.",
    body: `${metaBlock("high-court", 3, "BNSS criminal appeal · HC practice")}

# CRIMINAL APPEAL
## IN THE HIGH COURT OF ________
### CRIMINAL APPELLATE JURISDICTION

**Criminal Appeal No. ________ of 20____**  
*(Against Judgment dated ________ of ________ in Sessions Case / Case No. ________)*

**Appellant:** ________ (Convict / Accused)  
**Respondent:** State of ________  

### PART A — IMPUGNED JUDGMENT
Conviction under Sections ________ of ________ · Sentence: ________ · Fine: ________

### PART B — BRIEF FACTS OF PROSECUTION CASE
________

### PART C — GROUNDS OF APPEAL
**On facts:** ________  
**On law:** ________  
**On appreciation of evidence:** ________  
**On sentence:** ________  

### PART D — POINTS FOR DETERMINATION
1. ________  
2. ________  

### PART E — INTERIM: SUSPENSION OF SENTENCE / BAIL PENDING APPEAL
________

### PART F — PRAYER
(a) Admit the appeal;  
(b) Set aside conviction and sentence / reduce sentence;  
(c) Suspend sentence and enlarge on bail;  
(d) Pass any other order(s) as deemed fit.

### PART G — ANNEXURES
Judgment · Charge · Evidence list · Order on sentence · Custody certificate

${verificationBlock()}`,
  }),

  tpl({
    slug: "in-hc-t2-bail-anticipatory",
    title: "HC Tier-2 — Anticipatory Bail Application · Court-Rules Aligned",
    category: "criminal",
    court: "high-court",
    tier: 2,
    authorityKey: "bnss-anticipatory-bail",
    authorityLabel: "BNSS anticipatory bail · High Court criminal practice",
    extraTags: ["bail", "anticipatory", "bnss", "order"],
    description: "Anticipatory bail application before High Court with twin-condition awareness.",
    body: `${metaBlock("high-court", 2, "BNSS anticipatory bail")}

# APPLICATION FOR ANTICIPATORY BAIL
## IN THE HIGH COURT OF ________
### CRIMINAL MISCELLANEOUS JURISDICTION

**Bail Application No. ________ of 20____**

**Applicant / Accused:** ________  
**Respondent:** State of ________  

**FIR No. ________ · P.S. ________ · Sections ________**

### FACTS
________

### GROUNDS
1. False implication / civil dispute colour  
2. Cooperation · no flight risk · no tampering  
3. Nature of accusation and supporting material  
4. Statutory bars (if any) and satisfaction of twin conditions: ________

### UNDERTAKINGS
Appear as directed · not leave India without permission · not influence witnesses · abide by conditions.

### PRAYER
Grant anticipatory bail in the event of arrest in connection with the said FIR, on such conditions as this Hon'ble Court deems fit.

${verificationBlock()}`,
  }),

  tpl({
    slug: "in-hc-t2-civil-first-appeal",
    title: "HC Tier-2 — Civil First Appeal · Court-Rules Aligned",
    category: "civil",
    court: "high-court",
    tier: 2,
    authorityKey: "cpc-first-appeal",
    authorityLabel: "CPC First Appeal · High Court appellate side rules",
    extraTags: ["appeal", "civil", "cpc"],
    description: "First appeal against decree with grounds and interim stay of execution.",
    body: `${metaBlock("high-court", 2, "CPC First Appeal")}

# MEMORANDUM OF FIRST APPEAL
## IN THE HIGH COURT OF ________
### CIVIL APPELLATE JURISDICTION

**First Appeal No. ________ of 20____**  
*(Against Decree / Judgment dated ________ of ________ in Suit No. ________)*

**Appellant:** ________  
**Respondent(s):** ________  

### VALUATION
Suit valued at ₹________ · Appeal valued at ₹________ · Court-fee paid ₹________

### FACTS IN BRIEF
________

### GROUNDS OF APPEAL
1. ________  
2. ________  
3. ________  

### INTERIM PRAYER
Stay of execution of the Impugned Decree.

### MAIN PRAYER
Set aside / modify the Impugned Judgment and Decree; pass a decree as claimed; costs.

${verificationBlock()}`,
  }),

  tpl({
    slug: "in-hc-t1-revision-simple",
    title: "HC Tier-1 — Criminal Revision · Simple Final Form",
    category: "criminal",
    court: "high-court",
    tier: 1,
    authorityKey: "bnss-revision",
    authorityLabel: "BNSS / CrPC revision · High Court practice",
    extraTags: ["revision", "criminal"],
    description: "Simple criminal revision against inferior court order.",
    body: `${metaBlock("high-court", 1, "BNSS revision")}

# CRIMINAL REVISION
## IN THE HIGH COURT OF ________

**Criminal Revision No. ________ of 20____**  
*(Against Order dated ________ of ________ in ________ No. ________)*

**Revisionist:** ________  
**Respondents:** ________  

### GROUNDS (brief)
________

### PRAYER
Call for records; set aside / modify the Impugned Order; pass any other order(s) as deemed fit.

${verificationBlock()}`,
  }),
];

// ─── DISTRICT / SESSIONS / TRIAL COURTS ───────────────────────────────────────

const DC = [
  tpl({
    slug: "in-dc-t1-plaint-simple",
    title: "District Tier-1 — Plaint (CPC) · Simple Final Form",
    category: "civil",
    court: "district-court",
    tier: 1,
    authorityKey: "cpc-order-vii",
    authorityLabel: "CPC Order VII (Plaint)",
    extraTags: ["plaint", "cpc", "suit"],
    description: "Simple plaint with parties, cause of action, and prayer.",
    body: `${metaBlock("district-court", 1, "CPC Order VII")}

# PLAINT
## IN THE COURT OF ________ AT ________

**Civil Suit No. ________ of 20____**

**Plaintiff:** ________  
**Defendant(s):** ________  

### 1. PARTIES & JURISDICTION
________

### 2. CAUSE OF ACTION
Arose on ________ at ________.

### 3. FACTS
________

### 4. VALUATION & COURT-FEE
₹________ · Court-fee ₹________

### 5. PRAYER
(a) Decree for ________;  
(b) Interest / costs;  
(c) Any other relief.

${verificationBlock()}`,
  }),

  tpl({
    slug: "in-dc-t2-plaint-cpc-aligned",
    title: "District Tier-2 — Plaint (CPC Order VII) · Court-Rules Aligned",
    category: "civil",
    court: "district-court",
    tier: 2,
    authorityKey: "cpc-order-vii",
    authorityLabel: "CPC Order VII · Limitation Act schedule awareness",
    extraTags: ["plaint", "cpc", "suit", "filing-ready"],
    description: "Full plaint with particulars, limitation, valuation, and schedule of documents.",
    body: `${metaBlock("district-court", 2, "CPC Order VII")}

# PLAINT
## IN THE COURT OF THE ________ JUDGE AT ________

**Suit No. ________ of 20____**

**Plaintiff:** ________, aged ____, resident of ________  
**Defendant No. 1:** ________  
**Defendant No. 2:** ________  

---

### 1. DESCRIPTION OF PARTIES
________

### 2. JURISDICTION
Subject-matter · pecuniary · territorial — cause of action wholly / partly arose within jurisdiction because ________.

### 3. FACTS CONSTITUTING CAUSE OF ACTION
1. ________  
2. ________  
3. ________  

### 4. CAUSE OF ACTION — DATE & PLACE
First arose on ________ at ________; continuing: ________.

### 5. LIMITATION
Within limitation under Article ________ of the Limitation Act, 1963.

### 6. VALUATION
For jurisdiction ₹________ · For court-fee ₹________ · Court-fee paid ₹________.

### 7. RELIEFS CLAIMED
(a) ________  
(b) ________  
(c) Costs of the suit  
(d) Any other relief

### 8. LIST OF DOCUMENTS (Order VII Rule 14)
| S.No. | Document | Date | Original/Copy |
|-------|----------|------|---------------|
| 1 | | | |

${verificationBlock()}`,
  }),

  tpl({
    slug: "in-dc-t3-plaint-specific-performance",
    title: "District Tier-3 — Suit for Specific Performance · Comprehensive Final Instrument",
    category: "civil",
    court: "district-court",
    tier: 3,
    authorityKey: "specific-relief-act-cpc",
    authorityLabel: "Specific Relief Act, 1963 · CPC Orders VI–VIII",
    extraTags: ["specific-performance", "contract", "suit"],
    description: "Comprehensive specific performance suit with readiness & willingness, schedules, and alternative damages.",
    body: `${metaBlock("district-court", 3, "Specific Relief Act · CPC")}

# PLAINT — SUIT FOR SPECIFIC PERFORMANCE
## IN THE COURT OF ________ AT ________

**Civil Suit No. ________ of 20____**

**Plaintiff:** ________  
**Defendant(s):** ________  

### PART A — AGREEMENT
Agreement to Sell / Contract dated ________ *(Schedule A)* · Property: ________ *(Schedule B)* · Consideration ₹________ · Earnest ₹________.

### PART B — PLAINTIFF'S READYNESS AND WILLINGNESS
At all material times the Plaintiff has been and is ready and willing to perform essential terms: ________ *(bank proof / draft — Annexure P-__)*.

### PART C — BREACH BY DEFENDANT
On ________ Defendant refused / failed to ________ despite notice dated ________ *(Annexure P-__)*.

### PART D — CAUSE OF ACTION, JURISDICTION, LIMITATION, VALUATION
________

### PART E — PRAYER
(a) Decree of specific performance directing execution of sale deed / performance of ________;  
(b) Permanent injunction restraining alienation;  
(c) Alternatively, damages ₹________;  
(d) Costs;  
(e) Any other relief.

### SCHEDULE A — AGREEMENT PARTICULARS
### SCHEDULE B — PROPERTY DESCRIPTION (boundaries)
### SCHEDULE C — PAYMENT HISTORY

${verificationBlock()}`,
  }),

  tpl({
    slug: "in-dc-t2-written-statement",
    title: "District Tier-2 — Written Statement · Court-Rules Aligned",
    category: "civil",
    court: "district-court",
    tier: 2,
    authorityKey: "cpc-order-viii",
    authorityLabel: "CPC Order VIII (Written Statement)",
    extraTags: ["written-statement", "cpc", "defence"],
    description: "Written statement with preliminary objections, para-wise reply, and set-off/counter-claim slots.",
    body: `${metaBlock("district-court", 2, "CPC Order VIII")}

# WRITTEN STATEMENT
## IN THE COURT OF ________ AT ________

**Suit No. ________ of 20____**

**Defendant:** ________  
**Plaintiff:** ________  

### PRELIMINARY OBJECTIONS
1. Maintainability  
2. Limitation  
3. Jurisdiction  
4. Non-joinder / mis-joinder  
5. Absence of cause of action  

### PARA-WISE REPLY
**Para 1:** ________  
**Para 2:** ________  
*(Continue for each plaint paragraph — admit / deny / explain)*

### ADDITIONAL PLEAS
________

### SET-OFF / COUNTER-CLAIM *(if any)*
________

### PRAYER
Dismiss the suit with costs; decree counter-claim; any other relief.

${verificationBlock()}`,
  }),

  tpl({
    slug: "in-dc-t2-bail-sessions-bnss",
    title: "District Tier-2 — Regular Bail (Sessions) · Court-Rules Aligned",
    category: "criminal",
    court: "district-court",
    tier: 2,
    authorityKey: "bnss-regular-bail",
    authorityLabel: "BNSS regular bail · Sessions Court practice",
    extraTags: ["bail", "bnss", "sessions-court", "order"],
    description: "Regular bail before Sessions Court with undertakings and conditions.",
    body: `${metaBlock("district-court", 2, "BNSS regular bail")}

# APPLICATION FOR REGULAR BAIL
## IN THE COURT OF THE SESSIONS JUDGE AT ________

**Bail Application No. ________ of 20____**

**Applicant / Accused:** ________  
**Respondent:** State of ________  

**FIR No. ________ · P.S. ________ · Sections ________ of ________**

### CUSTODY PARTICULARS
Arrested on ________ · Remanded · Charge-sheet filed / pending: ________

### GROUNDS
1. ________  
2. ________  
3. Parity with co-accused ________ (if applicable)  

### UNDERTAKINGS & PROPOSED CONDITIONS
Sureties · local surety · passport · PS attendance · no contact with witnesses.

### PRAYER
Enlarge the Applicant on bail on such conditions as this Hon'ble Court deems fit.

${verificationBlock()}`,
  }),

  tpl({
    slug: "in-dc-t2-injunction-application",
    title: "District Tier-2 — Temporary Injunction (O.XXXIX CPC) · Court-Rules Aligned",
    category: "civil",
    court: "district-court",
    tier: 2,
    authorityKey: "cpc-order-xxxix",
    authorityLabel: "CPC Order XXXIX Rules 1 & 2",
    extraTags: ["injunction", "interim", "cpc", "order"],
    description: "Temporary injunction application with triple test pleadings.",
    body: `${metaBlock("district-court", 2, "CPC Order XXXIX")}

# APPLICATION FOR TEMPORARY INJUNCTION
## UNDER ORDER XXXIX RULES 1 & 2 CPC
### IN THE COURT OF ________ AT ________

**I.A. No. ________ of 20____ in Suit No. ________ of 20____**

**Applicant / Plaintiff:** ________  
**Respondents / Defendants:** ________  

### FACTS
________

### TRIPLE TEST
1. **Prima facie case:** ________  
2. **Balance of convenience:** ________  
3. **Irreparable injury:** ________  

### PRAYER
Restrain the Respondents from ________ pending disposal of the suit; ad-interim ex-parte injunction; any other order(s).

${verificationBlock()}`,
  }),

  tpl({
    slug: "in-dc-t2-execution-petition",
    title: "District Tier-2 — Execution Petition · Court-Rules Aligned",
    category: "civil",
    court: "district-court",
    tier: 2,
    authorityKey: "cpc-order-xxi",
    authorityLabel: "CPC Order XXI (Execution)",
    extraTags: ["execution", "cpc", "decree"],
    description: "Execution petition for decree with mode of execution.",
    body: `${metaBlock("district-court", 2, "CPC Order XXI")}

# EXECUTION PETITION
## IN THE COURT OF ________ AT ________

**Execution Petition No. ________ of 20____**  
*(In Suit No. ________ of 20____)*

**Decree-Holder:** ________  
**Judgment-Debtor(s):** ________  

### DECREE PARTICULARS
Date of decree ________ · Amount / relief ________ · Costs ________ · Interest ________

### MODE OF EXECUTION SOUGHT
Attachment · sale · arrest · delivery of possession · other: ________

### PRAYER
Execute the decree by ________; issue process; pass any other order(s) as deemed fit.

${verificationBlock()}`,
  }),

  tpl({
    slug: "in-dc-t1-vakalatnama",
    title: "District Tier-1 — Vakalatnama · Simple Final Form",
    category: "litigation",
    court: "district-court",
    tier: 1,
    authorityKey: "advocates-act-vakalatnama",
    authorityLabel: "Standard Indian court vakalatnama practice",
    extraTags: ["vakalatnama", "appearance"],
    description: "Vakalatnama authorizing advocate to appear and act.",
    body: `${metaBlock("district-court", 1, "Vakalatnama practice")}

# VAKALATNAMA

IN THE COURT OF ________ AT ________  
________ No. ________ of 20____  

I/We, ________, appoint ________, Advocate, Enrolment No. ________, to appear, act, and plead on my/our behalf in the above matter, with authority to ________.

Client signature(s): ________  
Advocate acceptance: ________  
Date: ________ · Place: ________`,
  }),

  tpl({
    slug: "in-dc-t3-consumer-complaint-comprehensive",
    title: "District Tier-3 — Consumer Complaint · Comprehensive Final Instrument",
    category: "consumer",
    court: "district-court",
    tier: 3,
    authorityKey: "consumer-protection-act-2019",
    authorityLabel: "Consumer Protection Act, 2019 · District Commission practice",
    extraTags: ["consumer", "complaint", "cpa-2019"],
    description: "Comprehensive consumer complaint with deficiency, unfair trade practice, and reliefs under CPA 2019.",
    body: `${metaBlock("district-court", 3, "Consumer Protection Act, 2019")}

# CONSUMER COMPLAINT
## BEFORE THE DISTRICT CONSUMER DISPUTES REDRESSAL COMMISSION AT ________

**Complaint No. ________ of 20____**

**Complainant:** ________  
**Opposite Party No. 1:** ________  
**Opposite Party No. 2:** ________  

### PART A — PARTIES & PECUNIARY / TERRITORIAL JURISDICTION
________

### PART B — TRANSACTION & CONSIDERATION
Goods / services: ________ · Paid ₹________ on ________ *(Annexures)*

### PART C — DEFICIENCY / UNFAIR TRADE PRACTICE / RESTRICTIVE TRADE PRACTICE
________

### PART D — CAUSE OF ACTION & LIMITATION
________

### PART E — PRAYER (CPA 2019)
(a) Direct OP to ________ / refund ₹________;  
(b) Compensation ₹________ for mental agony / harassment;  
(c) Interest @ ____% p.a.;  
(d) Litigation costs;  
(e) Punitive damages (if claimed);  
(f) Any other relief.

### PART F — ANNEXURES INDEX
Invoice · Warranty · Correspondence · Expert report · Photographs

${verificationBlock()}`,
  }),
];

// ─── TIER-3 COMPREHENSIVE CONTRACTUAL (final contract level) ─────────────────

const CONTRACTUAL = [
  tpl({
    slug: "in-ctr-t3-shareholders-agreement",
    title: "Contractual Tier-3 — Shareholders' Agreement · Comprehensive Final Instrument",
    category: "corporate",
    court: "contractual",
    tier: 3,
    authorityKey: "companies-act-2013-contract",
    authorityLabel: "Companies Act, 2013 · Indian Contract Act, 1872 · SEBI (if listed context)",
    extraTags: ["sha", "corporate", "final-contract"],
    description: "Final-form SHA with definitions, governance, transfer restrictions, exit, and schedules.",
    body: `${metaBlock("contractual", 3, "Companies Act 2013 · Contract Act")}

# SHAREHOLDERS' AGREEMENT

**This Shareholders' Agreement** is made at ________ on this ____ day of ________, 20____

**AMONG**  
1. ________, a company incorporated under the Companies Act, ________, with CIN ________ *(“Company”)*  
2. ________ *(“Promoter”)*  
3. ________ *(“Investor”)*  

*(Collectively, the “Parties”)*

---

## 1. DEFINITIONS AND INTERPRETATION
1.1 **Affiliate**, **Board**, **Business Day**, **Encumbrance**, **Equity Shares**, **Fully Diluted Basis**, **Law**, **Person**, **Transfer** — as set out in Schedule 1.

## 2. SHARE CAPITAL AND SUBSCRIPTION
2.1 Authorized / issued capital as on Closing: Schedule 2.  
2.2 Investor subscribes ________ Equity Shares at ₹________ per share; aggregate consideration ₹________.

## 3. GOVERNANCE
3.1 Board composition: ________  
3.2 Quorum · reserved matters (Schedule 3) · information rights · observer.

## 4. TRANSFER RESTRICTIONS
ROFR · tag · drag · lock-in · permitted transfers — Schedule 4.

## 5. EXIT
IPO · strategic sale · buyback / put-call — mechanics and timelines.

## 6. REPRESENTATIONS AND WARRANTIES
Company / Promoter / Investor — Schedule 5 disclosure letter.

## 7. INDEMNITY · LIMITATION · CONDUCT OF CLAIMS
________

## 8. NON-COMPETE · NON-SOLICIT · CONFIDENTIALITY
Duration ________ · geography ________ · carve-outs ________.

## 9. TERM · TERMINATION · CONSEQUENCES
________

## 10. GOVERNING LAW · DISPUTE RESOLUTION
Laws of India · exclusive courts at ________ / arbitration under Arbitration & Conciliation Act, 1996 seat ________.

## 11. MISCELLANEOUS
Notices · entire agreement · amendment · severability · counterparts · stamp duty.

**IN WITNESS WHEREOF** the Parties have executed this Agreement as a final binding instrument.

| Party | Signature | Name / Title | Date |
|-------|-----------|--------------|------|
| Company | | | |
| Promoter | | | |
| Investor | | | |

### SCHEDULES
1 Definitions · 2 Capitalization · 3 Reserved Matters · 4 Transfer · 5 Disclosure Letter · 6 Business Plan`,
  }),

  tpl({
    slug: "in-ctr-t3-msa-services",
    title: "Contractual Tier-3 — Master Services Agreement · Comprehensive Final Instrument",
    category: "commercial",
    court: "contractual",
    tier: 3,
    authorityKey: "indian-contract-act-msa",
    authorityLabel: "Indian Contract Act, 1872 · IT Act, 2000 (if digital) · DPDPA (if personal data)",
    extraTags: ["msa", "services", "final-contract"],
    description: "Final-form MSA with SOW mechanics, SLAs, IP, data protection, liability, and termination.",
    body: `${metaBlock("contractual", 3, "Contract Act · IT Act · DPDPA")}

# MASTER SERVICES AGREEMENT

**Date:** ________ · **Place:** ________

**Customer:** ________  
**Service Provider:** ________  

## 1. STRUCTURE
This MSA governs Statements of Work (each an “SOW”). In conflict, SOW controls for commercials; MSA controls for legal terms unless SOW expressly overrides a named clause.

## 2. SERVICES · ACCEPTANCE · CHANGE CONTROL
________

## 3. FEES · INVOICING · TAXES
________

## 4. SERVICE LEVELS · CREDITS
Schedule A.

## 5. INTELLECTUAL PROPERTY
Pre-existing IP · Work Product ownership · licence grants · open source.

## 6. CONFIDENTIALITY · DATA PROTECTION
DPDPA roles (Fiduciary / Processor) · security · breach notice · cross-border.

## 7. REPRESENTATIONS · COMPLIANCE · ANTI-BRIBERY
________

## 8. INDEMNITIES · LIABILITY CAP · EXCLUSIONS
Cap: ________ · Exclusions: ________ · Carve-outs: IP / confidentiality / wilful misconduct.

## 9. TERM · SUSPENSION · TERMINATION · EXIT ASSISTANCE
________

## 10. GOVERNING LAW · DISPUTE RESOLUTION
India · ________ courts / arbitration seat ________.

**SIGNATURE BLOCK** (authorized signatories) · **SCHEDULES:** SOW template · SLA · Security · Processing terms.`,
  }),

  tpl({
    slug: "in-ctr-t3-lease-deed",
    title: "Contractual Tier-3 — Lease Deed (Immovable) · Comprehensive Final Instrument",
    category: "property",
    court: "contractual",
    tier: 3,
    authorityKey: "transfer-of-property-lease",
    authorityLabel: "Transfer of Property Act, 1882 · Registration Act, 1908 · state stamp laws",
    extraTags: ["lease", "property", "final-contract", "registration"],
    description: "Final-form lease deed with schedules, covenants, and registration-ready execution block.",
    body: `${metaBlock("contractual", 3, "TPA · Registration Act")}

# LEASE DEED

**This Lease Deed** made at ________ on ________

**BETWEEN** ________ *(“Lessor”)* **AND** ________ *(“Lessee”)*.

## 1. DEMISE
Lessor hereby demises unto Lessee the Premises described in **Schedule A** for term ________ commencing ________ ending ________.

## 2. RENT · DEPOSIT · ESCALATION
Monthly rent ₹________ · Security deposit ₹________ · Escalation ________.

## 3. USE · QUIET ENJOYMENT · MAINTENANCE
________

## 4. LESSOR / LESSEE COVENANTS
________

## 5. LOCK-IN · TERMINATION · CONSEQUENCES
________

## 6. STAMP DUTY · REGISTRATION
Parties shall present for registration as required by Law; stamp duty borne as: ________.

## 7. GOVERNING LAW · DISPUTES
Laws of India · courts at ________.

**IN WITNESS WHEREOF** executed as a final deed.

Lessor ________ · Lessee ________ · Witnesses ________  

**Schedule A** — Property description & plan · **Schedule B** — Inventory`,
  }),

  tpl({
    slug: "in-ctr-t2-nda",
    title: "Contractual Tier-2 — Mutual NDA · Court/Contract Aligned Final Form",
    category: "commercial",
    court: "contractual",
    tier: 2,
    authorityKey: "indian-contract-act-nda",
    authorityLabel: "Indian Contract Act, 1872 · equitable confidentiality principles",
    extraTags: ["nda", "confidentiality", "final-contract"],
    description: "Mutual NDA as a final executable instrument with term, residuals, and remedies.",
    body: `${metaBlock("contractual", 2, "Contract Act NDA")}

# MUTUAL NON-DISCLOSURE AGREEMENT

**Date:** ________  

**Party A:** ________  
**Party B:** ________  

1. Purpose ________  
2. Confidential Information (incl. exclusions)  
3. Non-use / non-disclosure / standard of care  
4. Compelled disclosure  
5. Term ________ years · return/destruction  
6. No licence · no warranty  
7. Remedies incl. injunction  
8. Governing law: India · courts ________  

**Signed** as a final binding agreement by authorized signatories.`,
  }),

  tpl({
    slug: "in-ctr-t3-employment-agreement",
    title: "Contractual Tier-3 — Employment Agreement · Comprehensive Final Instrument",
    category: "employment",
    court: "contractual",
    tier: 3,
    authorityKey: "employment-india-contract",
    authorityLabel: "Industrial Relations / Shops & Establishments (state) · Contract Act · POSH · DPDPA",
    extraTags: ["employment", "final-contract"],
    description: "Final-form employment agreement with IP, confidentiality, termination, and statutory compliance.",
    body: `${metaBlock("contractual", 3, "Employment · POSH · DPDPA")}

# EMPLOYMENT AGREEMENT

**Employer:** ________  
**Employee:** ________  
**Effective Date:** ________ · **Place of work:** ________  

## 1. DESIGNATION · DUTIES · PROBATION
________

## 2. COMPENSATION · BENEFITS · DEDUCTIONS
CTC Schedule A · statutory contributions.

## 3. HOURS · LEAVE · POLICIES
________

## 4. CONFIDENTIALITY · IP ASSIGNMENT · MORAL RIGHTS WAIVER (to extent permitted)
________

## 5. NON-SOLICIT · NON-COMPETE *(to the extent enforceable)*
________

## 6. POSH · CODE OF CONDUCT · DATA PROTECTION
________

## 7. TERMINATION · NOTICE · GARDEN LEAVE · SEVERANCE
________

## 8. GOVERNING LAW · DISPUTES
________

**SIGNATURES** · **Schedule A** Compensation · **Schedule B** Job description`,
  }),

  tpl({
    slug: "in-ctr-t1-board-resolution",
    title: "Contractual Tier-1 — Board Resolution · Simple Final Form",
    category: "corporate",
    court: "contractual",
    tier: 1,
    authorityKey: "companies-act-board-resolution",
    authorityLabel: "Companies Act, 2013 — Board resolutions practice",
    extraTags: ["board-resolution", "corporate"],
    description: "Simple final board resolution format for authorization.",
    body: `${metaBlock("contractual", 1, "Companies Act Board Resolution")}

# CERTIFIED TRUE COPY OF RESOLUTION
## PASSED AT THE MEETING OF THE BOARD OF DIRECTORS OF ________
### HELD ON ________ AT ________

**RESOLVED THAT** ________.

**RESOLVED FURTHER THAT** ________ be and is hereby authorized to ________.

Certified true copy  
**Company Secretary / Director** ________  
DIN / Membership No. ________`,
  }),
];

const all = [...SC, ...HC, ...DC, ...CONTRACTUAL];

writeFileSync(
  path.join(dataDir, "seed-templates-in-court-tiers-2026-07.json"),
  `${JSON.stringify(all, null, 2)}\n`,
);

const byCourt = {};
const byTier = {};
for (const t of all) {
  const c = (t.tags.find((x) => x.startsWith("court:")) || "court:?").slice(6);
  const tier = (t.tags.find((x) => x.startsWith("tier:")) || "tier:?").slice(5);
  byCourt[c] = (byCourt[c] || 0) + 1;
  byTier[tier] = (byTier[tier] || 0) + 1;
}

console.log(
  JSON.stringify(
    {
      total: all.length,
      byCourt,
      byTier,
      note: "Merge via merge-nys-seed-expansions.mjs; EC2 reseed requires GO. Not government-sealed PDFs — rules/forms-aligned final instruments.",
    },
    null,
    2,
  ),
);
