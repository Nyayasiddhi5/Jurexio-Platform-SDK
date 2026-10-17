/**
 * Anchor profiles per document type.
 *
 * The labels are taken from the statutory forms and from how registries actually
 * print them, including the abbreviations. Where a form is bilingual the
 * Devanagari label is included alongside the English one, because in a Hindi-belt
 * FIR the English label is often the one that OCRs badly while the Devanagari
 * label survives, and vice versa — having both doubles the chance of an anchor hit.
 */

import type { AnchorProfile } from "./engine.js";

const ci = (s: string) => new RegExp(s, "i");

export const ANCHOR_PROFILES: AnchorProfile[] = [
  // ------------------------------------------------------------------- FIR
  {
    id: "FIR",
    docTypes: ["FIR"],
    anchors: [
      {
        fieldPath: "fir.district", label: "District",
        labels: [ci("\\bDistrict\\s*[:\\-]"), ci("\\bDistt\\.?\\s*[:\\-]"), ci("जिला\\s*[:\\-]")],
        layout: "ANY", baseConf: 0.9,
        clean: (s) => s.replace(/\s+P\.?\s?S\.?.*$/i, "").trim(),
      },
      {
        // "Police Station" first, then the "P.S." abbreviation. Order matters:
        // the abbreviation also appears mid-sentence in "Information received at
        // P.S.: Time 09:45 hrs", and matching that produced a police station
        // called "Time 09:45 hrs G.D. No. 0045" which then fought the correct
        // value and turned the whole field into a conflict.
        fieldPath: "fir.policeStation", label: "Police Station",
        labels: [ci("\\bPolice\\s+Station\\s*[:\\-]?"), ci("थाना\\s*[:\\-]"), ci("\\bP\\.?\\s?S\\.?\\s*[:\\-]")],
        layout: "ANY", baseConf: 0.9,
        // A station name is a place name. It never contains a clock time, a
        // "No." reference, or a leading digit.
        reject: /(?:\d{1,2}[:.]\d{2}|\bhrs?\b|\bNo\.|^\d)/i,
        clean: (s) => s.replace(/\s+(?:Year|District|Distt|G\.?D\.?).*$/i, "").trim(),
      },
      {
        fieldPath: "fir.year", label: "Year",
        labels: [ci("\\bYear\\s*[:\\-]"), ci("वर्ष\\s*[:\\-]")],
        layout: "INLINE", baseConf: 0.88,
        reject: /^(?!(?:19|20)\d{2}$)/,
      },
      {
        fieldPath: "fir.placeOfOccurrence", label: "Place of Occurrence",
        labels: [ci("Place\\s+of\\s+Occurrence\\s*[:\\-]?"), ci("घटना\\s*स्थल\\s*[:\\-]")],
        layout: "ANY", maxLines: 3, baseConf: 0.85,
      },
      {
        fieldPath: "fir.beatNo", label: "Beat No.",
        labels: [ci("Beat\\s*(?:No\\.?)?\\s*[:\\-]")],
        layout: "INLINE", baseConf: 0.8,
      },
      {
        fieldPath: "fir.typeOfInformation", label: "Type of Information",
        labels: [ci("Type\\s+of\\s+Information\\s*[:\\-]?")],
        layout: "ANY", baseConf: 0.85,
      },
      {
        fieldPath: "complainant.name", label: "Complainant name",
        labels: [ci("(?:Complainant|Informant)[^:\\n]{0,20}[:\\-]\\s*(?=\\S)"), ci("\\bName\\s*[:\\-]")],
        layout: "ANY", baseConf: 0.86,
        reject: /^\d+$/,
      },
      {
        fieldPath: "complainant.occupation", label: "Occupation",
        labels: [ci("Occupation\\s*[:\\-]"), ci("व्यवसाय\\s*[:\\-]")],
        layout: "ANY", baseConf: 0.82,
      },
      {
        fieldPath: "complainant.address", label: "Address",
        labels: [ci("Address\\s*[:\\-]"), ci("\\bR\\/o\\s*[:\\-]?"), ci("पता\\s*[:\\-]")],
        layout: "ANY", maxLines: 3, baseConf: 0.84,
      },
      {
        fieldPath: "complainant.nationality", label: "Nationality",
        labels: [ci("Nationality\\s*[:\\-]")],
        layout: "ANY", baseConf: 0.85,
      },
      {
        fieldPath: "fir.investigatingOfficer", label: "Investigating Officer",
        labels: [ci("(?:Investigating\\s+Officer|I\\.?O\\.?)\\s*[:\\-]"), ci("investigation\\s+taken\\s+up\\s+by")],
        layout: "ANY", baseConf: 0.8,
      },
      {
        fieldPath: "fir.officerInCharge", label: "Officer in charge",
        labels: [ci("Officer\\s+in\\s+[Cc]harge[^:\\n]{0,30}[:\\-]"), ci("\\bS\\.?H\\.?O\\.?\\s*[:\\-]")],
        layout: "ANY", baseConf: 0.78,
      },
    ],
  },

  // ----------------------------------------------------------- CHARGE SHEET
  {
    id: "CHARGESHEET",
    docTypes: ["CHARGESHEET"],
    anchors: [
      {
        fieldPath: "chargesheet.number", label: "Charge sheet no.",
        labels: [ci("Charge\\s*-?\\s*sheet\\s*(?:No\\.?)?\\s*[:\\-]"), ci("Final\\s+Report\\s*(?:No\\.?)?\\s*[:\\-]")],
        layout: "INLINE", baseConf: 0.9,
      },
      {
        fieldPath: "chargesheet.court", label: "Court",
        labels: [ci("(?:Name\\s+of\\s+the\\s+)?Court\\s*[:\\-]")],
        layout: "ANY", baseConf: 0.85,
      },
      {
        fieldPath: "chargesheet.accusedInCustody", label: "Accused in custody",
        labels: [ci("(?:Accused|Whether)\\s+in\\s+custody\\s*[:\\-]?")],
        layout: "ANY", baseConf: 0.82,
      },
      {
        fieldPath: "chargesheet.investigationPeriod", label: "Investigation period",
        labels: [ci("(?:Period|Duration)\\s+of\\s+[Ii]nvestigation\\s*[:\\-]?")],
        layout: "ANY", baseConf: 0.78,
      },
    ],
  },

  // -------------------------------------------------------------- PLEADINGS
  {
    id: "PLEADING",
    docTypes: ["PLAINT", "WRITTEN_STATEMENT", "WRIT_PETITION", "PIL", "CRIMINAL_APPEAL",
               "CIVIL_APPEAL", "SLP", "REVISION", "EXECUTION_PETITION", "INTERIM_APPLICATION"],
    anchors: [
      {
        fieldPath: "suit.valuation", label: "Valuation",
        labels: [ci("[Vv]aluation\\s+(?:of\\s+the\\s+suit\\s+)?(?:for[^:]{0,40})?[:\\-]"),
                 ci("[Vv]alued\\s+at\\s*[:\\-]?")],
        layout: "ANY", baseConf: 0.85,
      },
      {
        fieldPath: "courtFee.paid", label: "Court fee",
        labels: [ci("[Cc]ourt\\s+[Ff]ee(?:s)?\\s*(?:paid|of)?\\s*[:\\-]")],
        layout: "ANY", baseConf: 0.84,
      },
      {
        fieldPath: "cause.date", label: "Cause of action date",
        labels: [ci("[Cc]ause\\s+of\\s+action\\s+(?:arose|accrued)\\s*(?:on)?\\s*[:\\-]?")],
        layout: "ANY", baseConf: 0.8,
      },
      {
        fieldPath: "impugnedOrder.date", label: "Impugned order date",
        labels: [ci("(?:impugned|judgment|order)\\s+dated\\s*[:\\-]?"),
                 ci("(?:against\\s+the\\s+)?(?:judgment\\s+and\\s+)?order\\s+dated")],
        layout: "INLINE", baseConf: 0.85,
      },
      {
        fieldPath: "limitation.statement", label: "Limitation",
        labels: [ci("[Ll]imitation\\s*[:\\-]"), ci("the\\s+(?:appeal|petition)\\s+is\\s+within\\s+time")],
        layout: "ANY", baseConf: 0.72,
      },
    ],
  },

  // --------------------------------------------------------------------- BAIL
  {
    id: "BAIL",
    docTypes: ["BAIL_APPLICATION"],
    anchors: [
      {
        fieldPath: "custody.status", label: "Custody status",
        labels: [ci("(?:in\\s+)?(?:judicial|police)\\s+custody\\s+(?:since|from)\\s*[:\\-]?"),
                 ci("[Cc]ustody\\s*[:\\-]"), ci("arrested\\s+on\\s*[:\\-]?")],
        layout: "ANY", baseConf: 0.82,
      },
      {
        // "surety of the like amount" is a cross-reference, not a figure, so the
        // bond amount must be found by looking for money rather than by taking
        // whatever follows the word "surety".
        fieldPath: "bail.suretyOffered", label: "Surety offered",
        labels: [
          ci("(?:personal\\s+)?bond\\s+(?:of|in\\s+the\\s+sum\\s+of)\\s*[:\\-]?"),
          ci("suret(?:y|ies)\\s+(?:of|in\\s+the\\s+sum\\s+of)\\s*[:\\-]?"),
        ],
        layout: "ANY", maxLines: 2, baseConf: 0.82,
        reject: /^(?:the\s+like\s+amount|like\s+amount)$/i,
      },
      {
        fieldPath: "bail.previousApplications", label: "Previous bail applications",
        labels: [ci("(?:previous|earlier)\\s+bail\\s+application"), ci("no\\s+(?:previous|earlier)\\s+application")],
        layout: "ANY", baseConf: 0.75,
      },
    ],
  },

  // ------------------------------------------------------------------ NOTICE
  {
    id: "NOTICE",
    docTypes: ["LEGAL_NOTICE", "DEMAND_NOTICE_SARFAESI"],
    anchors: [
      {
        fieldPath: "notice.date", label: "Notice date",
        labels: [ci("^\\s*Dated?\\s*[:\\-]"), ci("\\bDate\\s*[:\\-]")],
        layout: "INLINE", baseConf: 0.88,
      },
      {
        fieldPath: "notice.addressee", label: "Addressee",
        labels: [ci("^\\s*To,?\\s*$"), ci("^\\s*To\\s*[:\\-]")],
        layout: "COLON_WRAP", maxLines: 5, baseConf: 0.85,
      },
      {
        fieldPath: "notice.onBehalfOf", label: "Client",
        labels: [ci("on\\s+behalf\\s+of\\s+my\\s+client\\s*[:\\-]?"),
                 ci("[Uu]nder\\s+instructions?\\s+from\\s+(?:and\\s+on\\s+behalf\\s+of\\s+)?my\\s+client")],
        layout: "ANY", maxLines: 3, baseConf: 0.84,
      },
      {
        // The captured value must be the PERIOD, not the rest of the sentence.
        // Unconstrained, this anchor returned "15 days of receipt of this notice,
        // failing which my client" — which contains the answer but is not the
        // answer, and cannot be compared against another document's reading of
        // the same period.
        fieldPath: "notice.period", label: "Compliance period",
        labels: [ci("within\\s*(?=\\d|\\w+\\s+(?:days?|months?|weeks?|years?))")],
        layout: "INLINE", baseConf: 0.85,
        clean: (s) => {
          const m = /^(\d{1,3}|[A-Za-z]+)\s+(days?|months?|weeks?|years?)/i.exec(s.trim());
          return m ? `${m[1]} ${m[2]!.toLowerCase()}` : s;
        },
      },
      {
        fieldPath: "notice.mode", label: "Mode of service",
        labels: [ci("^\\s*(?:REGISTERED|Registered)\\s+A\\.?D\\.?"), ci("[Ss]peed\\s+[Pp]ost")],
        layout: "ANY", baseConf: 0.75,
      },
    ],
  },

  // ------------------------------------------------------------------- NI138
  {
    id: "NI138",
    docTypes: ["COMPLAINT_138", "RETURN_MEMO", "CHEQUE"],
    anchors: [
      {
        fieldPath: "instrument.chequeNo", label: "Cheque no.",
        labels: [ci("[Cc]heque\\s*(?:bearing\\s*)?(?:No\\.?|Number)\\s*[:\\-]?"),
                 ci("\\bChq\\.?\\s*No\\.?\\s*[:\\-]?")],
        layout: "INLINE", baseConf: 0.92,
      },
      {
        fieldPath: "instrument.drawerBank", label: "Drawee bank",
        labels: [ci("drawn\\s+on\\s*[:\\-]?"), ci("[Bb]ank\\s*(?:Name)?\\s*[:\\-]")],
        layout: "ANY", maxLines: 2, baseConf: 0.86,
      },
      {
        fieldPath: "instrument.dishonourReason", label: "Reason for return",
        labels: [ci("[Rr]eason\\s+for\\s+[Rr]eturn\\s*[:\\-]?"), ci("with\\s+the\\s+remark\\s*[:\\-]?")],
        layout: "ANY", baseConf: 0.9,
      },
      {
        fieldPath: "instrument.dishonourDate", label: "Return memo date",
        labels: [ci("[Rr]eturn\\s+[Mm]emo\\s+dated\\s*[:\\-]?"), ci("returned\\s+unpaid.{0,40}dated")],
        layout: "INLINE", baseConf: 0.88,
      },
    ],
  },

  // -------------------------------------------------------------------- DEED
  {
    id: "DEED",
    docTypes: ["SALE_DEED", "AGREEMENT_TO_SELL", "LEASE_DEED", "POWER_OF_ATTORNEY"],
    anchors: [
      {
        fieldPath: "property.extent", label: "Extent",
        labels: [ci("(?:measuring|admeasuring|extent\\s+of)\\s*[:\\-]?")],
        layout: "INLINE", baseConf: 0.85,
      },
      {
        fieldPath: "property.boundaries", label: "Boundaries",
        labels: [ci("bounded\\s+(?:as\\s+follows|on)\\s*[:\\-]?"), ci("^\\s*Schedule\\s+of\\s+(?:the\\s+)?Property")],
        layout: "COLON_WRAP", maxLines: 6, baseConf: 0.8,
      },
      {
        fieldPath: "property.subRegistrar", label: "Sub-Registrar",
        labels: [ci("[Ss]ub\\s*-?\\s*[Rr]egistrar\\s*(?:of|at)?\\s*[:\\-,]?")],
        layout: "INLINE", baseConf: 0.85,
      },
      {
        fieldPath: "deed.stampDuty", label: "Stamp duty",
        labels: [ci("[Ss]tamp\\s+[Dd]uty\\s*(?:of|paid)?\\s*[:\\-]?")],
        layout: "ANY", baseConf: 0.82,
      },
      {
        fieldPath: "deed.consideration", label: "Consideration",
        labels: [ci("(?:total\\s+)?consideration\\s+(?:of|amount)?\\s*[:\\-]?"),
                 ci("sale\\s+consideration\\s*[:\\-]?")],
        layout: "ANY", baseConf: 0.88,
      },
      {
        fieldPath: "lease.rent", label: "Monthly rent",
        labels: [ci("[Mm]onthly\\s+[Rr]ent\\s*(?:of)?\\s*[:\\-]?")],
        layout: "ANY", baseConf: 0.88,
      },
      {
        fieldPath: "lease.securityDeposit", label: "Security deposit",
        labels: [ci("[Ss]ecurity\\s+[Dd]eposit\\s*(?:of)?\\s*[:\\-]?")],
        layout: "ANY", baseConf: 0.88,
      },
      {
        fieldPath: "lease.term", label: "Lease term",
        labels: [ci("(?:lease|licen[cs]e)\\s+period\\s*(?:of)?\\s*[:\\-]?"), ci("lock\\s*-?\\s*in\\s+period\\s*[:\\-]?")],
        layout: "ANY", baseConf: 0.84,
      },
    ],
  },

  // ------------------------------------------------------------------- ORDER
  {
    id: "ORDER",
    docTypes: ["JUDGEMENT", "ORDER", "DECREE"],
    anchors: [
      {
        fieldPath: "coram", label: "Coram",
        labels: [ci("\\bCORAM\\s*[:\\-]?"), ci("^\\s*Before\\s*[:\\-]")],
        layout: "ANY", maxLines: 3, baseConf: 0.88,
      },
      {
        fieldPath: "order.reservedOn", label: "Reserved on",
        labels: [ci("[Rr]eserved\\s+on\\s*[:\\-]?")],
        layout: "INLINE", baseConf: 0.9,
      },
      {
        fieldPath: "order.pronouncedOn", label: "Pronounced on",
        labels: [ci("[Pp]ronounced\\s+on\\s*[:\\-]?"), ci("[Dd]elivered\\s+on\\s*[:\\-]?")],
        layout: "INLINE", baseConf: 0.9,
      },
      {
        fieldPath: "nextHearing.date", label: "Next hearing",
        labels: [ci("[Nn]ext\\s+(?:date\\s+(?:of\\s+hearing)?|hearing)\\s*[:\\-]?"),
                 ci("(?:list|listed|adjourned)\\s+(?:on|to)\\s*[:\\-]?")],
        layout: "INLINE", baseConf: 0.85,
      },
      {
        fieldPath: "advocates.forAppellant", label: "Counsel for appellant",
        labels: [ci("(?:Through|For\\s+the\\s+(?:Appellant|Petitioner|Plaintiff))\\s*[:\\-]")],
        layout: "ANY", maxLines: 3, baseConf: 0.8,
      },
      {
        fieldPath: "advocates.forRespondent", label: "Counsel for respondent",
        labels: [ci("For\\s+the\\s+(?:Respondent|Defendant|State)\\s*[:\\-]")],
        layout: "ANY", maxLines: 3, baseConf: 0.8,
      },
    ],
  },

  // ---------------------------------------------------------------- CONTRACT
  {
    id: "CONTRACT",
    // Deeds carry jurisdiction, arbitration and governing-law clauses just as
    // commercial agreements do — the original list omitted them, so a sale deed's
    // exclusive-jurisdiction clause was never extracted.
    docTypes: ["AGREEMENT", "PARTNERSHIP_DEED", "SALE_DEED", "AGREEMENT_TO_SELL",
               "LEASE_DEED", "POWER_OF_ATTORNEY"],
    anchors: [
      {
        fieldPath: "agreement.effectiveDate", label: "Effective date",
        labels: [ci("[Ee]ffective\\s+(?:from|date)\\s*[:\\-]?"),
                 ci("this\\s+[Aa]greement\\s+is\\s+made\\s+(?:and\\s+executed\\s+)?on\\s*(?:this)?\\s*[:\\-]?")],
        layout: "INLINE", baseConf: 0.86,
      },
      {
        fieldPath: "term", label: "Term",
        labels: [ci("[Tt]erm\\s+of\\s+(?:this\\s+)?[Aa]greement\\s*[:\\-]?"), ci("shall\\s+(?:remain\\s+in\\s+force|be\\s+valid)\\s+for")],
        layout: "ANY", baseConf: 0.8,
      },
      {
        fieldPath: "governingLaw", label: "Governing law",
        labels: [ci("[Gg]overning\\s+[Ll]aw\\s*[:\\-]?"), ci("shall\\s+be\\s+governed\\s+by\\s+(?:and\\s+construed\\s+)?(?:in\\s+accordance\\s+with\\s+)?the\\s+laws\\s+of")],
        layout: "ANY", baseConf: 0.84,
      },
      {
        fieldPath: "jurisdiction.clause", label: "Jurisdiction",
        labels: [ci("[Ee]xclusive\\s+[Jj]urisdiction\\s*[:\\-]?"), ci("courts?\\s+at\\s+(?=[A-Z])")],
        layout: "ANY", baseConf: 0.84,
      },
    ],
  },

  // ----------------------------------------------------------- FILING RECEIPT
  {
    id: "FILING",
    docTypes: ["FILING_RECEIPT", "CAUSE_LIST"],
    anchors: [
      {
        fieldPath: "cnr", label: "CNR",
        labels: [ci("\\bCNR\\s*(?:No\\.?|Number)?\\s*[:\\-]?")],
        layout: "INLINE", baseConf: 0.95,
      },
      {
        fieldPath: "filing.date", label: "Filing date",
        labels: [ci("(?:Filing|Filed\\s+on|Date\\s+of\\s+[Ff]iling)\\s*[:\\-]?")],
        layout: "INLINE", baseConf: 0.9,
      },
      {
        fieldPath: "filing.receiptNo", label: "Receipt no.",
        labels: [ci("(?:Receipt|Acknowledg(?:e)?ment)\\s*(?:No\\.?|ID)\\s*[:\\-]?")],
        layout: "INLINE", baseConf: 0.9,
      },
    ],
  },

  // ----------------------------------------------------------------- MEDICAL
  {
    id: "MEDICAL",
    docTypes: ["MLC", "POST_MORTEM"],
    anchors: [
      {
        fieldPath: "mlc.number", label: "MLC no.",
        labels: [ci("\\bM\\.?L\\.?C\\.?\\s*(?:No\\.?|Reg(?:ister)?\\.?\\s*No\\.?)\\s*[:\\-]?")],
        layout: "INLINE", baseConf: 0.9,
      },
      {
        fieldPath: "injury.nature", label: "Nature of injury",
        labels: [ci("[Nn]ature\\s+of\\s+[Ii]njur(?:y|ies)\\s*[:\\-]?")],
        layout: "ANY", maxLines: 4, baseConf: 0.85,
      },
      {
        fieldPath: "death.cause", label: "Cause of death",
        labels: [ci("[Cc]ause\\s+of\\s+[Dd]eath\\s*[:\\-]?")],
        layout: "ANY", maxLines: 4, baseConf: 0.88,
      },
      {
        fieldPath: "medical.broughtBy", label: "Brought by",
        labels: [ci("[Bb]rought\\s+(?:in\\s+)?by\\s*[:\\-]?")],
        layout: "ANY", baseConf: 0.8,
      },
    ],
  },
];

export const PROFILE_INDEX = new Map(ANCHOR_PROFILES.map((p) => [p.id, p]));

/** Every anchor profile that applies to a document type code. */
export function profilesForDocType(code: string): AnchorProfile[] {
  return ANCHOR_PROFILES.filter((p) => p.docTypes.includes(code));
}

/**
 * Authority weight per document type for a given field family.
 *
 * This is the heart of multi-document conflict resolution. When a bundle contains
 * an FIR, a charge sheet and a bail application that each state the FIR number
 * slightly differently, the FIR itself wins — it is the source of that fact. When
 * they disagree about the cause title, the court's own order wins.
 *
 * Weights are 0..1 and multiply into confidence during resolution.
 */
export const AUTHORITY: Record<string, Partial<Record<string, number>>> = {
  // fieldPath prefix → { docTypeCode: weight }
  "fir.":         { FIR: 1.0, CHARGESHEET: 0.85, BAIL_APPLICATION: 0.6, QUASHING_PETITION: 0.6, JUDGEMENT: 0.7, ORDER: 0.65, MLC: 0.5 },
  "sections":     { CHARGESHEET: 1.0, FIR: 0.9, JUDGEMENT: 0.95, ORDER: 0.8, BAIL_APPLICATION: 0.6, COMPLAINT_138: 0.9 },
  "court.":       { ORDER: 1.0, JUDGEMENT: 1.0, DECREE: 1.0, FILING_RECEIPT: 0.95, CAUSE_LIST: 0.9, PLAINT: 0.7, WRIT_PETITION: 0.7 },
  "caseNumber":   { FILING_RECEIPT: 1.0, ORDER: 0.98, JUDGEMENT: 0.98, CAUSE_LIST: 0.95, PLAINT: 0.7 },
  "cnr":          { FILING_RECEIPT: 1.0, CAUSE_LIST: 0.98, ORDER: 0.95, JUDGEMENT: 0.95 },
  "parties":      { JUDGEMENT: 1.0, ORDER: 0.95, DECREE: 0.95, PLAINT: 0.9, FIR: 0.85, VAKALATNAMA: 0.8, SALE_DEED: 0.95 },
  "instrument.":  { CHEQUE: 1.0, RETURN_MEMO: 1.0, LEGAL_NOTICE: 0.9, COMPLAINT_138: 0.85,
                    // An FIR recording a dishonoured cheque is a contemporaneous
                    // police record of it — a good source, if not the instrument itself.
                    FIR: 0.8, CHARGESHEET: 0.8 },
  "bank.":        { BANK_STATEMENT: 1.0, CHEQUE: 0.95, RETURN_MEMO: 0.95, LEGAL_NOTICE: 0.8,
                    FIR: 0.8, CHARGESHEET: 0.8, SALE_DEED: 0.85 },
  "property.":    { SALE_DEED: 1.0, LEASE_DEED: 0.95, AGREEMENT_TO_SELL: 0.85, POWER_OF_ATTORNEY: 0.7 },
  "amounts":      { DECREE: 1.0, ARBITRAL_AWARD: 1.0, SALE_DEED: 0.95, RETURN_MEMO: 0.95, INVOICE: 0.9, LEGAL_NOTICE: 0.85, PLAINT: 0.8 },
  "advocates":    { VAKALATNAMA: 1.0, ORDER: 0.9, JUDGEMENT: 0.9, LEGAL_NOTICE: 0.85 },
  "ids.":         { AADHAAR_CARD: 1.0, PAN_CARD: 1.0, PASSPORT: 1.0, SALE_DEED: 0.85, FIR: 0.8, MOA_AOA: 0.9 },
  "marriage.":    { DIVORCE_PETITION: 1.0, MAINTENANCE_PETITION: 0.85, DV_APPLICATION: 0.8 },
  "vehicle.":     { MACT_CLAIM: 1.0, FIR: 0.9 },
  "disposition":  { JUDGEMENT: 1.0, ORDER: 0.9, DECREE: 0.95 },

  // These families were missing, so every field in them fell back to the
  // default 0.6 authority. That is not neutral: combineConfidence multiplies by
  // (0.55 + 0.45 x authority), so a correctly extracted value with a perfect
  // anchor match landed at 0.70 — just under the 0.72 autofill threshold — and
  // was shown for confirmation instead of pre-filled. A legal notice IS the
  // authority for its own compliance period.
  "notice.":      { LEGAL_NOTICE: 1.0, DEMAND_NOTICE_SARFAESI: 1.0, COMPLAINT_138: 0.7 },
  "bail.":        { BAIL_APPLICATION: 1.0, BAIL_BOND: 1.0, ORDER: 0.8 },
  "custody.":     { BAIL_APPLICATION: 0.9, ARREST_MEMO: 1.0, CHARGESHEET: 0.9, ORDER: 0.85 },
  "jurisdiction.": { AGREEMENT: 1.0, SALE_DEED: 0.95, LEASE_DEED: 0.95, AGREEMENT_TO_SELL: 0.95, PARTNERSHIP_DEED: 0.95 },
  "governingLaw": { AGREEMENT: 1.0, SALE_DEED: 0.9, LEASE_DEED: 0.9 },
  "term":         { AGREEMENT: 1.0, LEASE_DEED: 0.95 },
  "agreement.":   { AGREEMENT: 1.0, AGREEMENT_TO_SELL: 0.95, PARTNERSHIP_DEED: 0.95 },
  "deed.":        { SALE_DEED: 1.0, LEASE_DEED: 0.95, AGREEMENT_TO_SELL: 0.9, POWER_OF_ATTORNEY: 0.9 },
  "lease.":       { LEASE_DEED: 1.0 },
  "suit.":        { PLAINT: 1.0, WRITTEN_STATEMENT: 0.7, CIVIL_APPEAL: 0.8 },
  "courtFee.":    { FILING_RECEIPT: 1.0, PLAINT: 0.9, WRIT_PETITION: 0.9 },
  "complainant.": { FIR: 1.0, COMPLAINT_138: 0.95, CHARGESHEET: 0.85, CONSUMER_COMPLAINT: 0.95 },
  "chargesheet.": { CHARGESHEET: 1.0 },
  "order.":       { JUDGEMENT: 1.0, ORDER: 1.0, DECREE: 0.95 },
  "nextHearing.": { ORDER: 1.0, CAUSE_LIST: 1.0, JUDGEMENT: 0.7 },
  "impugnedOrder.": { CRIMINAL_APPEAL: 1.0, CIVIL_APPEAL: 1.0, SLP: 1.0, REVISION: 1.0, JUDGEMENT: 0.9 },
  "cause.":       { PLAINT: 1.0, WRIT_PETITION: 0.9, COMPLAINT_138: 0.9 },
  "relatedCase":  { JUDGEMENT: 1.0, ORDER: 0.95, BAIL_APPLICATION: 0.8, QUASHING_PETITION: 0.8 },
  "mlc.":         { MLC: 1.0, POST_MORTEM: 0.9 },
  "injury.":      { MLC: 1.0, POST_MORTEM: 0.95 },
  "death.":       { POST_MORTEM: 1.0, MLC: 0.8 },
  "filing.":      { FILING_RECEIPT: 1.0, CAUSE_LIST: 0.8 },
  "coram":        { JUDGEMENT: 1.0, ORDER: 1.0, CAUSE_LIST: 0.85 },
  "reliefsSought": { PLAINT: 1.0, WRIT_PETITION: 1.0, BAIL_APPLICATION: 1.0, CRIMINAL_APPEAL: 0.95, CONSUMER_COMPLAINT: 1.0 },
};

/** Resolve the authority weight for a field on a document type. */
export function authorityWeight(fieldPath: string, docTypeCode: string): number {
  // Longest matching prefix wins, so "fir.number" prefers the "fir." table over
  // a hypothetical shorter one.
  let best = 0;
  let bestLen = -1;
  for (const [prefix, table] of Object.entries(AUTHORITY)) {
    if (!fieldPath.startsWith(prefix)) continue;
    if (prefix.length <= bestLen) continue;
    const w = table[docTypeCode];
    if (w !== undefined) { best = w; bestLen = prefix.length; }
  }
  // An unlisted pairing is not worthless — it is just unremarkable.
  return bestLen >= 0 ? best : 0.6;
}
