/**
 * Document-type registry.
 *
 * 52 profiles covering the document families that actually arrive in an Indian
 * advocate's intake tray. Each profile is weighted cues plus anti-cues, because
 * the hard classification problems here are all near-neighbour separations:
 *
 *   plaint vs written statement       — same court, same parties, opposite side
 *   FIR vs charge sheet               — same offence, same sections, different stage
 *   order vs judgement                — both from a court, different finality
 *   sale deed vs agreement to sell    — both convey, only one transfers title
 *   legal notice vs complaint         — s.138 chain, before and after
 *   bail application vs bail bond     — the request and the security
 *
 * Getting these wrong is not cosmetic. A written statement classified as a plaint
 * puts the defendant in the plaintiff's field, which inverts the entire case
 * record. So the anti-cues carry real weight and the classifier keeps runners-up.
 */

import type { DocTypeProfile } from "../types.js";

const ci = (s: string) => new RegExp(s, "i");

export const DOC_TYPES: DocTypeProfile[] = [
  // ---------------------------------------------------------------- POLICE
  {
    code: "FIR", label: "First Information Report", family: "POLICE",
    statutoryForm: "CrPC s.154 / BNSS s.173",
    anchorProfile: "FIR",
    cues: [
      { re: ci("first\\s+information\\s+report"), w: 10 },
      { re: ci("\\bF\\.?\\s?I\\.?\\s?R\\.?\\s*(?:No|संख्या)"), w: 8 },
      { re: ci("प्रथम\\s*सूचना\\s*रिपोर्ट"), w: 10 },
      { re: ci("under\\s+section\\s+154\\s+Cr\\.?P\\.?C"), w: 7 },
      { re: ci("section\\s+173\\s+BNSS"), w: 7 },
      { re: ci("occurrence\\s+of\\s+offence"), w: 5 },
      { re: ci("information\\s+received\\s+at\\s+P\\.?S"), w: 5 },
      { re: ci("complainant\\s*\\/\\s*informant"), w: 5 },
      { re: ci("distance\\s+from\\s+P\\.?S"), w: 4 },
      { re: ci("officer\\s+in\\s+charge"), w: 3 },
    ],
    antiCues: [
      { re: ci("charge\\s*-?\\s*sheet|final\\s+report"), w: 8 },
      { re: ci("in\\s+the\\s+(?:high\\s+)?court\\s+of"), w: 4 },
    ],
    expectedFields: [
      "fir.number", "fir.year", "fir.date", "fir.policeStation", "fir.district",
      "sections", "parties", "witnesses", "fir.placeOfOccurrence", "fir.gdEntry",
    ],
  },
  {
    code: "CHARGESHEET", label: "Charge Sheet / Final Report", family: "POLICE",
    statutoryForm: "CrPC s.173 / BNSS s.193",
    anchorProfile: "CHARGESHEET",
    cues: [
      { re: ci("charge\\s*-?\\s*sheet"), w: 10 },
      { re: ci("final\\s+report\\s+(?:under|u\\/s)"), w: 9 },
      { re: ci("report\\s+under\\s+section\\s+173"), w: 8 },
      { re: ci("section\\s+193\\s+BNSS"), w: 8 },
      { re: ci("list\\s+of\\s+witnesses"), w: 5 },
      { re: ci("list\\s+of\\s+documents"), w: 4 },
      { re: ci("investigating\\s+officer"), w: 3 },
      { re: ci("accused\\s+(?:is|are)\\s+(?:in\\s+)?custody"), w: 4 },
    ],
    expectedFields: ["chargesheet.number", "fir.number", "sections", "parties", "witnesses", "chargesheet.date"],
  },
  {
    code: "CASE_DIARY", label: "Case Diary", family: "POLICE",
    statutoryForm: "CrPC s.172 / BNSS s.192",
    cues: [
      { re: ci("case\\s+diary"), w: 10 },
      { re: ci("\\bC\\.?D\\.?\\s*(?:No|Part)"), w: 5 },
      { re: ci("section\\s+172\\s+Cr\\.?P\\.?C"), w: 7 },
      { re: ci("proceedings\\s+of\\s+investigation"), w: 9 },
      { re: ci("further\\s+investigation\\s+is\\s+in\\s+progress"), w: 7 },
      { re: ci("\\d{2}:\\d{2}\\s*hrs\\b.{0,80}\\d{2}:\\d{2}\\s*hrs\\b"), w: 6 },
    ],
    expectedFields: ["fir.number", "dates"],
  },
  {
    code: "SEIZURE_MEMO", label: "Seizure / Recovery Memo", family: "POLICE",
    cues: [
      { re: ci("seizure\\s+memo"), w: 10 },
      { re: ci("recovery\\s+memo"), w: 9 },
      { re: ci("panchnama"), w: 8 },
      { re: ci("seized\\s+in\\s+the\\s+presence\\s+of"), w: 6 },
      { re: ci("independent\\s+witness"), w: 3 },
      { re: ci("articles\\s+seized"), w: 8 },
      { re: ci("sealed\\s+in\\s+the\\s+presence"), w: 7 },
      { re: ci("panch\\s+witness"), w: 8 },
    ],
    antiCues: [
      // A case diary narrates the seizures made during the day and cites the
      // seizure memo by reference ("vide seizure memo of even date"). Without
      // these, the diary scored 13 against its own 15 — a two-point margin.
      { re: ci("\\bcase\\s+diary\\b"), w: 10 },
      { re: ci("\\bvide\\s+seizure\\s+memo\\b"), w: 6 },
      { re: ci("proceedings\\s+of\\s+investigation"), w: 8 },
    ],
    expectedFields: ["fir.number", "seizure.items", "witnesses", "dates"],
  },
  {
    code: "ARREST_MEMO", label: "Arrest Memo", family: "POLICE",
    cues: [
      { re: ci("arrest\\s+memo"), w: 10 },
      { re: ci("grounds\\s+of\\s+arrest"), w: 8 },
      { re: ci("intimation\\s+(?:of\\s+arrest\\s+)?to\\s+(?:the\\s+)?(?:relative|friend)"), w: 6 },
      { re: ci("time\\s+of\\s+arrest"), w: 5 },
    ],
    expectedFields: ["fir.number", "parties", "arrest.dateTime", "sections"],
  },

  // -------------------------------------------------------------- PLEADINGS
  {
    code: "PLAINT", label: "Plaint (Civil Suit)", family: "PLEADING",
    statutoryForm: "CPC Order VII",
    anchorProfile: "PLEADING",
    cues: [
      { re: ci("\\bPLAINT\\b"), w: 10 },
      { re: ci("suit\\s+for\\s+(?:recovery|declaration|permanent\\s+injunction|specific\\s+performance|partition|possession)"), w: 8 },
      { re: ci("\\bplaintiff\\b"), w: 5 },
      { re: ci("valuation\\s+(?:of\\s+the\\s+suit|for\\s+(?:the\\s+)?purpose)"), w: 6 },
      { re: ci("court\\s+fee\\s+(?:of|paid|stamp)"), w: 5 },
      { re: ci("cause\\s+of\\s+action\\s+(?:arose|accrued)"), w: 6 },
      { re: ci("O\\.?\\s?S\\.?\\s*No"), w: 4 },
    ],
    antiCues: [
      { re: ci("written\\s+statement"), w: 10 },
      { re: ci("\\bcounter\\s*-?\\s*claim\\b"), w: 6 },
      { re: ci("preliminary\\s+objection"), w: 5 },
    ],
    expectedFields: ["court.raw", "caseNumber", "parties", "reliefsSought", "suit.valuation", "cause.date"],
  },
  {
    code: "WRITTEN_STATEMENT", label: "Written Statement", family: "PLEADING",
    statutoryForm: "CPC Order VIII",
    anchorProfile: "PLEADING",
    cues: [
      { re: ci("written\\s+statement"), w: 12 },
      { re: ci("\\bW\\.?S\\.?\\s+(?:on\\s+behalf|filed)"), w: 6 },
      { re: ci("on\\s+behalf\\s+of\\s+(?:the\\s+)?defendant"), w: 8 },
      { re: ci("preliminary\\s+objections?"), w: 6 },
      { re: ci("(?:para|paragraph)\\s+\\d+\\s+(?:of\\s+the\\s+plaint\\s+)?is\\s+(?:denied|false)"), w: 8 },
      { re: ci("the\\s+suit\\s+is\\s+(?:barred|not\\s+maintainable)"), w: 7 },
    ],
    antiCues: [{ re: ci("^\\s*PLAINT\\s*$"), w: 6 }],
    expectedFields: ["court.raw", "caseNumber", "parties", "defences"],
  },
  {
    code: "WRIT_PETITION", label: "Writ Petition", family: "PLEADING",
    statutoryForm: "Constitution Arts. 32 / 226",
    anchorProfile: "PLEADING",
    cues: [
      { re: ci("writ\\s+petition"), w: 12 },
      { re: ci("W\\.?\\s?P\\.?\\s*\\((?:C|Crl|MD|PIL)\\)"), w: 8 },
      { re: ci("under\\s+article\\s+226"), w: 9 },
      { re: ci("under\\s+article\\s+32"), w: 9 },
      { re: ci("(?:writ\\s+of\\s+)?(?:mandamus|certiorari|habeas\\s+corpus|prohibition|quo\\s+warranto)"), w: 8 },
      { re: ci("synopsis\\s+and\\s+list\\s+of\\s+dates"), w: 5 },
    ],
    expectedFields: ["court.raw", "caseNumber", "parties", "articles", "reliefsSought"],
  },
  {
    code: "PIL", label: "Public Interest Litigation", family: "PLEADING",
    cues: [
      { re: ci("public\\s+interest\\s+litigation"), w: 12 },
      { re: ci("W\\.?P\\.?\\s*\\(PIL\\)"), w: 10 },
      { re: ci("in\\s+public\\s+interest"), w: 6 },
      { re: ci("petitioner\\s+has\\s+no\\s+personal\\s+interest"), w: 8 },
      { re: ci("locus\\s+standi"), w: 4 },
    ],
    expectedFields: ["court.raw", "caseNumber", "parties", "articles", "reliefsSought", "pil.publicCause"],
  },
  {
    code: "CRIMINAL_APPEAL", label: "Criminal Appeal", family: "PLEADING",
    statutoryForm: "CrPC ss.374, 378 / BNSS ss.415, 419",
    cues: [
      { re: ci("criminal\\s+appeal"), w: 11 },
      { re: ci("CRL\\.?\\s?A\\.?\\s*No"), w: 9 },
      { re: ci("under\\s+section\\s+374"), w: 8 },
      { re: ci("appeal\\s+against\\s+(?:the\\s+)?(?:conviction|acquittal|judgment)"), w: 8 },
      { re: ci("grounds\\s+of\\s+appeal"), w: 5 },
    ],
    expectedFields: ["court.raw", "caseNumber", "parties", "impugnedOrder.date", "sections", "reliefsSought"],
  },
  {
    code: "CIVIL_APPEAL", label: "Civil Appeal / First Appeal", family: "PLEADING",
    statutoryForm: "CPC s.96 / Order XLI",
    cues: [
      { re: ci("(?:civil|first|second)\\s+appeal"), w: 10 },
      { re: ci("(?:R\\.?F\\.?A|R\\.?S\\.?A|F\\.?A)\\.?\\s*No"), w: 8 },
      { re: ci("under\\s+section\\s+96\\s+(?:of\\s+the\\s+)?C\\.?P\\.?C"), w: 8 },
      { re: ci("memorandum\\s+of\\s+appeal"), w: 7 },
      { re: ci("appeal\\s+against\\s+the\\s+(?:judgment\\s+and\\s+)?decree"), w: 8 },
    ],
    expectedFields: ["court.raw", "caseNumber", "parties", "impugnedOrder.date", "reliefsSought"],
  },
  {
    code: "SLP", label: "Special Leave Petition", family: "PLEADING",
    statutoryForm: "Constitution Art. 136",
    cues: [
      { re: ci("special\\s+leave\\s+petition"), w: 12 },
      { re: ci("S\\.?L\\.?P\\.?\\s*\\((?:C|Crl)\\)"), w: 10 },
      { re: ci("under\\s+article\\s+136"), w: 9 },
      { re: ci("supreme\\s+court\\s+of\\s+india"), w: 5 },
      { re: ci("diary\\s+no"), w: 4 },
    ],
    expectedFields: ["court.raw", "caseNumber", "diaryNumber", "parties", "impugnedOrder.date", "reliefsSought"],
  },
  {
    code: "BAIL_APPLICATION", label: "Bail Application", family: "PLEADING",
    statutoryForm: "CrPC ss.437-439 / BNSS ss.480-483",
    anchorProfile: "BAIL",
    cues: [
      { re: ci("bail\\s+application"), w: 11 },
      { re: ci("application\\s+for\\s+(?:grant\\s+of\\s+)?(?:regular\\s+|anticipatory\\s+|interim\\s+)?bail"), w: 10 },
      { re: ci("under\\s+section\\s+43[789]"), w: 8 },
      { re: ci("under\\s+section\\s+48[023]\\s+(?:of\\s+the\\s+)?BNSS"), w: 8 },
      { re: ci("anticipatory\\s+bail"), w: 7 },
      { re: ci("apprehends?\\s+arrest"), w: 6 },
      { re: ci("(?:solvent\\s+)?suret(?:y|ies)"), w: 4 },
      { re: ci("undertakes?\\s+to\\s+(?:co-?operate|abide)"), w: 4 },
    ],
    antiCues: [{ re: ci("bail\\s+bond|personal\\s+bond\\s+executed"), w: 7 }],
    expectedFields: ["court.raw", "caseNumber", "fir.number", "parties", "sections", "custody.status", "reliefsSought"],
  },
  {
    code: "QUASHING_PETITION", label: "Quashing Petition", family: "PLEADING",
    statutoryForm: "CrPC s.482 / BNSS s.528",
    cues: [
      { re: ci("under\\s+section\\s+482\\s+(?:of\\s+the\\s+)?Cr\\.?P\\.?C"), w: 11 },
      { re: ci("under\\s+section\\s+528\\s+(?:of\\s+the\\s+)?BNSS"), w: 11 },
      { re: ci("Crl\\.?\\s?M\\.?C\\.?\\s*No"), w: 7 },
      { re: ci("(?:quash|quashing)\\s+(?:of\\s+)?(?:the\\s+)?(?:F\\.?I\\.?R|proceedings|charge)"), w: 10 },
      { re: ci("inherent\\s+(?:powers?|jurisdiction)"), w: 6 },
    ],
    expectedFields: ["court.raw", "caseNumber", "fir.number", "parties", "sections", "reliefsSought"],
  },
  {
    code: "REVISION", label: "Criminal / Civil Revision", family: "PLEADING",
    cues: [
      { re: ci("(?:criminal|civil)\\s+revision"), w: 10 },
      { re: ci("(?:Crl|C)\\.?\\s?R\\.?\\s?(?:P|A)?\\.?\\s*No"), w: 6 },
      { re: ci("under\\s+section\\s+(?:397|401|115)"), w: 8 },
      { re: ci("revisional\\s+jurisdiction"), w: 6 },
    ],
    expectedFields: ["court.raw", "caseNumber", "parties", "impugnedOrder.date", "reliefsSought"],
  },
  {
    code: "COMPLAINT_138", label: "Complaint under s.138 NI Act", family: "PLEADING",
    statutoryForm: "NI Act ss.138, 142",
    anchorProfile: "NI138",
    cues: [
      { re: ci("under\\s+section\\s+138\\s+(?:read\\s+with\\s+section\\s+142\\s+)?of\\s+the\\s+negotiable"), w: 12 },
      { re: ci("section\\s+138\\s+(?:of\\s+the\\s+)?N\\.?I\\.?\\s*Act"), w: 10 },
      { re: ci("complaint\\s+(?:case|petition)?\\s*(?:under|u\\/s)"), w: 5 },
      { re: ci("cheque\\s+(?:bearing\\s+)?no"), w: 6 },
      { re: ci("(?:dishonour|dishonor|returned\\s+unpaid)"), w: 7 },
      { re: ci("legally\\s+enforceable\\s+(?:debt|liability)"), w: 8 },
      { re: ci("statutory\\s+notice"), w: 5 },
    ],
    antiCues: [{ re: ci("legal\\s+notice\\s+under\\s+section\\s+138"), w: 9 }],
    expectedFields: [
      "court.raw", "parties", "instrument.chequeNo", "instrument.chequeDate",
      "instrument.amount", "instrument.dishonourDate", "instrument.dishonourReason",
      "notice.date", "bank.ifsc",
    ],
  },
  {
    code: "MACT_CLAIM", label: "Motor Accident Claim Petition", family: "PLEADING",
    statutoryForm: "MV Act ss.166, 163A",
    cues: [
      { re: ci("motor\\s+accident\\s+claims?\\s+tribunal"), w: 11 },
      { re: ci("M\\.?A\\.?C\\.?T\\.?"), w: 7 },
      { re: ci("under\\s+section\\s+166\\s+(?:of\\s+the\\s+)?motor\\s+vehicles"), w: 10 },
      { re: ci("claim\\s+petition"), w: 6 },
      { re: ci("(?:offending|involved)\\s+vehicle"), w: 7 },
      { re: ci("insurance\\s+polic(?:y|ies)\\s+no"), w: 5 },
      { re: ci("permanent\\s+disability|loss\\s+of\\s+income"), w: 5 },
    ],
    expectedFields: ["court.raw", "parties", "vehicle.registrationNo", "accident.date", "insurance.policyNo", "amounts", "fir.number"],
  },
  {
    code: "CONSUMER_COMPLAINT", label: "Consumer Complaint", family: "PLEADING",
    statutoryForm: "Consumer Protection Act 2019 s.35",
    cues: [
      { re: ci("consumer\\s+(?:disputes?\\s+redressal\\s+)?(?:commission|forum)"), w: 11 },
      { re: ci("under\\s+section\\s+35\\s+of\\s+the\\s+consumer\\s+protection"), w: 10 },
      { re: ci("deficiency\\s+(?:in|of)\\s+service"), w: 9 },
      { re: ci("unfair\\s+trade\\s+practice"), w: 8 },
      { re: ci("\\bcomplainant\\b.*\\bopposite\\s+part(?:y|ies)\\b"), w: 6 },
    ],
    expectedFields: ["court.raw", "parties", "amounts", "reliefsSought", "purchase.date"],
  },
  {
    code: "DIVORCE_PETITION", label: "Divorce / Matrimonial Petition", family: "FAMILY",
    statutoryForm: "HMA s.13 / SMA s.27 / other personal law",
    cues: [
      { re: ci("petition\\s+for\\s+(?:a\\s+)?(?:decree\\s+of\\s+)?divorce"), w: 11 },
      { re: ci("under\\s+section\\s+13\\s*(?:\\(1\\))?\\s*(?:of\\s+the\\s+)?hindu\\s+marriage"), w: 10 },
      { re: ci("mutual\\s+consent"), w: 6 },
      { re: ci("(?:cruelty|desertion|adultery)"), w: 5 },
      { re: ci("family\\s+court"), w: 6 },
      { re: ci("solemniz(?:ed|ation)\\s+(?:of\\s+marriage|on)"), w: 7 },
      { re: ci("dissolution\\s+of\\s+marriage"), w: 8 },
    ],
    expectedFields: ["court.raw", "parties", "marriage.date", "marriage.place", "reliefsSought", "children"],
  },
  {
    code: "MAINTENANCE_PETITION", label: "Maintenance Petition", family: "FAMILY",
    statutoryForm: "CrPC s.125 / BNSS s.144 / HMA s.24 / DV Act s.20",
    cues: [
      { re: ci("under\\s+section\\s+125\\s+(?:of\\s+the\\s+)?Cr\\.?P\\.?C"), w: 10 },
      { re: ci("under\\s+section\\s+144\\s+(?:of\\s+the\\s+)?BNSS"), w: 10 },
      { re: ci("maintenance\\s+(?:petition|application|pendente\\s+lite)"), w: 9 },
      { re: ci("unable\\s+to\\s+maintain\\s+herself"), w: 8 },
      { re: ci("interim\\s+maintenance"), w: 6 },
    ],
    expectedFields: ["court.raw", "parties", "marriage.date", "amounts", "reliefsSought"],
  },
  {
    code: "DV_APPLICATION", label: "Domestic Violence Application", family: "FAMILY",
    statutoryForm: "DV Act 2005 s.12",
    cues: [
      { re: ci("protection\\s+of\\s+women\\s+from\\s+domestic\\s+violence"), w: 11 },
      { re: ci("under\\s+section\\s+12\\s+of\\s+the\\s+(?:D\\.?V\\.?|domestic\\s+violence)"), w: 10 },
      { re: ci("domestic\\s+incident\\s+report"), w: 8 },
      { re: ci("protection\\s+officer"), w: 6 },
      { re: ci("shared\\s+household"), w: 6 },
      { re: ci("(?:residence|protection|monetary\\s+relief)\\s+order"), w: 5 },
    ],
    expectedFields: ["court.raw", "parties", "reliefsSought", "amounts", "dates"],
  },
  {
    code: "EXECUTION_PETITION", label: "Execution Petition", family: "PLEADING",
    statutoryForm: "CPC Order XXI",
    cues: [
      { re: ci("execution\\s+(?:petition|application)"), w: 11 },
      { re: ci("\\bE\\.?P\\.?\\s*No"), w: 6 },
      { re: ci("decree\\s*-?\\s*holder"), w: 9 },
      { re: ci("judgment\\s*-?\\s*debtor"), w: 9 },
      { re: ci("order\\s+(?:XXI|21)"), w: 7 },
      { re: ci("attachment\\s+(?:and\\s+sale\\s+)?of\\s+(?:movable|immovable)"), w: 6 },
    ],
    expectedFields: ["court.raw", "caseNumber", "parties", "decree.date", "amounts"],
  },
  {
    code: "INTERIM_APPLICATION", label: "Interim Application", family: "PLEADING",
    cues: [
      { re: ci("interim\\s+application"), w: 9 },
      { re: ci("\\bI\\.?A\\.?\\s*No"), w: 6 },
      { re: ci("(?:temporary|ad\\s*-?\\s*interim)\\s+injunction"), w: 8 },
      { re: ci("order\\s+(?:XXXIX|39)\\s+rules?\\s+1"), w: 8 },
      { re: ci("stay\\s+of\\s+(?:further\\s+)?proceedings"), w: 6 },
      { re: ci("condonation\\s+of\\s+delay"), w: 7 },
    ],
    expectedFields: ["court.raw", "caseNumber", "parties", "reliefsSought"],
  },
  {
    code: "CAVEAT", label: "Caveat", family: "PLEADING",
    statutoryForm: "CPC s.148A",
    cues: [
      { re: ci("\\bcaveat\\b"), w: 11 },
      { re: ci("section\\s+148\\s*A"), w: 9 },
      { re: ci("caveator"), w: 9 },
    ],
    expectedFields: ["court.raw", "parties", "dates"],
  },

  // ------------------------------------------------------------------ ORDERS
  {
    code: "JUDGEMENT", label: "Judgement", family: "ORDER",
    anchorProfile: "ORDER",
    cues: [
      { re: ci("^\\s*JUDG(?:E)?MENT\\s*$"), w: 12 },
      { re: ci("\\bJUDG(?:E)?MENT\\b"), w: 7 },
      { re: ci("pronounced\\s+on"), w: 8 },
      { re: ci("reserved\\s+on"), w: 7 },
      { re: ci("\\bCORAM\\b"), w: 6 },
      { re: ci("(?:appeal|petition|suit)\\s+is\\s+(?:allowed|dismissed|partly\\s+allowed)"), w: 8 },
      { re: ci("for\\s+the\\s+reasons\\s+(?:aforesaid|stated\\s+above)"), w: 5 },
      { re: ci("\\bratio\\b|\\bheld\\s+that\\b"), w: 3 },
    ],
    antiCues: [{ re: ci("MOST\\s+RESPECTFULLY\\s+SHOWETH|it\\s+is\\s+.{0,20}prayed"), w: 8 }],
    expectedFields: ["court.raw", "caseNumber", "parties", "coram", "disposition", "citations", "order.date"],
  },
  {
    code: "ORDER", label: "Order", family: "ORDER",
    anchorProfile: "ORDER",
    cues: [
      { re: ci("^\\s*ORDER\\s*$"), w: 11 },
      { re: ci("\\bORDER\\s+SHEET\\b"), w: 9 },
      { re: ci("(?:list|listed|adjourned)\\s+(?:on|to)"), w: 6 },
      { re: ci("issue\\s+notice"), w: 5 },
      { re: ci("next\\s+date\\s+of\\s+hearing"), w: 6 },
      { re: ci("\\bCORAM\\b"), w: 4 },
    ],
    antiCues: [
      { re: ci("pronounced\\s+on"), w: 5 },
      { re: ci("order\\s+(?:VII|XXI|XXXIX|\\d+)\\s+rule"), w: 6 },
    ],
    expectedFields: ["court.raw", "caseNumber", "parties", "order.date", "nextHearing.date"],
  },
  {
    code: "DECREE", label: "Decree", family: "ORDER",
    statutoryForm: "CPC s.2(2), Order XX Rule 6",
    cues: [
      { re: ci("\\bDECREE\\b"), w: 11 },
      { re: ci("(?:preliminary|final)\\s+decree"), w: 9 },
      { re: ci("decreed\\s+(?:in\\s+favour|with\\s+costs)"), w: 8 },
      { re: ci("suit\\s+is\\s+decreed"), w: 9 },
    ],
    expectedFields: ["court.raw", "caseNumber", "parties", "decree.date", "amounts"],
  },
  {
    code: "ARBITRAL_AWARD", label: "Arbitral Award", family: "ORDER",
    statutoryForm: "Arbitration and Conciliation Act 1996 s.31",
    cues: [
      { re: ci("arbitral\\s+award"), w: 12 },
      { re: ci("sole\\s+arbitrator|arbitral\\s+tribunal"), w: 8 },
      { re: ci("section\\s+31\\s+of\\s+the\\s+arbitration"), w: 9 },
      { re: ci("statement\\s+of\\s+claim"), w: 5 },
      { re: ci("claimant\\b.*\\brespondent\\b"), w: 3 },
    ],
    expectedFields: ["parties", "award.date", "amounts", "arbitrator.name", "reliefsSought"],
  },

  // ----------------------------------------------------------------- PROCESS
  {
    code: "SUMMONS", label: "Summons", family: "PROCESS",
    cues: [
      { re: ci("\\bSUMMONS\\b"), w: 11 },
      { re: ci("you\\s+are\\s+hereby\\s+summoned"), w: 10 },
      { re: ci("appear\\s+(?:before|in\\s+person)"), w: 6 },
      { re: ci("failing\\s+which\\s+.{0,40}ex\\s*-?\\s*parte"), w: 6 },
      { re: ci("file\\s+your\\s+written\\s+statement"), w: 8 },
      { re: ci("in\\s+person\\s+or\\s+by\\s+a\\s+pleader"), w: 9 },
    ],
    antiCues: [
      // A warrant necessarily recites the summons that preceded it ("despite
      // service of summons"), so the bare word cannot be allowed to carry a
      // warrant into this profile. Confusing the two is not cosmetic: one
      // commands attendance, the other commands arrest.
      { re: ci("(?:arrest|bailable|non\\s*-?\\s*bailable|search)\\s+warrant"), w: 11 },
      { re: ci("apprehend\\s+the\\s+said\\b"), w: 8 },
      { re: ci("\\bproclamation\\b"), w: 6 },
    ],
    expectedFields: ["court.raw", "caseNumber", "parties", "hearing.date"],
  },
  {
    code: "WARRANT", label: "Warrant", family: "PROCESS",
    cues: [
      { re: ci("(?:arrest|bailable|non\\s*-?\\s*bailable|search)\\s+warrant"), w: 11 },
      { re: ci("\\bN\\.?B\\.?W\\.?\\b"), w: 8 },
      // A warrant names the person, it does not usually call them "the accused"
      // in the operative direction: "apprehend the said Suresh Chandra Gupta".
      // Requiring the word cost the profile 8 points and left it 2 points clear
      // of SUMMONS — far too narrow a margin on a distinction that matters.
      { re: ci("apprehend\\s+the\\s+said\\b"), w: 8 },
      { re: ci("apprehend\\s+the\\s+(?:said\\s+)?accused"), w: 4 },
      { re: ci("produce\\s+(?:him|her|the\\s+accused)\\s+before"), w: 6 },
      { re: ci("you\\s+are\\s+hereby\\s+directed\\s+to\\s+apprehend"), w: 9 },
      { re: ci("warrant\\s+shall\\s+remain\\s+in\\s+force"), w: 8 },
      { re: ci("\\breturnable\\s+on\\b"), w: 4 },
    ],
    antiCues: [
      { re: ci("you\\s+are\\s+hereby\\s+summoned"), w: 6 },
    ],
    expectedFields: ["court.raw", "caseNumber", "parties", "sections", "warrant.date"],
  },
  {
    code: "LEGAL_NOTICE", label: "Legal Notice", family: "PROCESS",
    anchorProfile: "NOTICE",
    cues: [
      { re: ci("legal\\s+notice"), w: 11 },
      { re: ci("under\\s+instructions?\\s+from\\s+(?:and\\s+on\\s+behalf\\s+of\\s+)?my\\s+client"), w: 10 },
      { re: ci("registered\\s+A\\.?D\\.?|speed\\s+post"), w: 5 },
      { re: ci("you\\s+are\\s+hereby\\s+called\\s+upon"), w: 9 },
      { re: ci("failing\\s+which\\s+my\\s+client\\s+shall"), w: 8 },
      { re: ci("copy\\s+of\\s+this\\s+notice\\s+is\\s+retained"), w: 7 },
    ],
    antiCues: [{ re: ci("in\\s+the\\s+court\\s+of|before\\s+the\\s+(?:hon)"), w: 6 }],
    expectedFields: ["parties", "notice.date", "amounts", "sections", "notice.period", "advocates"],
  },
  {
    code: "PROCLAMATION", label: "Proclamation / Absconder Notice", family: "PROCESS",
    statutoryForm: "CrPC s.82 / BNSS s.84",
    cues: [
      { re: ci("proclamation"), w: 10 },
      { re: ci("section\\s+82\\s+(?:of\\s+the\\s+)?Cr\\.?P\\.?C"), w: 9 },
      { re: ci("proclaimed\\s+(?:offender|person)"), w: 9 },
      { re: ci("absconding"), w: 6 },
    ],
    expectedFields: ["court.raw", "caseNumber", "parties", "sections", "dates"],
  },

  // --------------------------------------------------------------- AFFIDAVIT
  {
    code: "AFFIDAVIT", label: "Affidavit", family: "AFFIDAVIT",
    cues: [
      { re: ci("\\bAFFIDAVIT\\b"), w: 11 },
      { re: ci("I,?\\s+.{3,60}\\s+do\\s+hereby\\s+(?:solemnly\\s+)?(?:affirm|state|declare)"), w: 10 },
      { re: ci("solemnly\\s+affirm(?:ed)?\\s+and\\s+state"), w: 9 },
      { re: ci("\\bDEPONENT\\b"), w: 8 },
      { re: ci("verified\\s+(?:on\\s+)?(?:this|at)"), w: 5 },
      { re: ci("(?:oath\\s+commissioner|notary\\s+public)"), w: 6 },
    ],
    expectedFields: ["parties", "affidavit.date", "affidavit.place", "deponent.name"],
  },

  // --------------------------------------------------------------- AUTHORITY
  {
    code: "VAKALATNAMA", label: "Vakalatnama", family: "AUTHORITY",
    cues: [
      { re: ci("vakalatnama|vakalath|vakalatnamah"), w: 12 },
      { re: ci("do\\s+hereby\\s+appoint\\s+and\\s+retain"), w: 10 },
      { re: ci("advocate\\s+to\\s+(?:appear|act|plead)"), w: 8 },
      { re: ci("accepted|memo\\s+of\\s+appearance"), w: 4 },
    ],
    expectedFields: ["court.raw", "caseNumber", "parties", "advocates", "advocates.enrolmentNo"],
  },
  {
    code: "POWER_OF_ATTORNEY", label: "Power of Attorney", family: "AUTHORITY",
    cues: [
      { re: ci("power\\s+of\\s+attorney"), w: 12 },
      { re: ci("\\bG\\.?P\\.?A\\.?\\b|\\bS\\.?P\\.?A\\.?\\b"), w: 6 },
      // "doth hereby" is the classic deed formula and is at least as common as
      // "do hereby". The first version required "do hereby" and therefore scored
      // nothing on a conventionally-drafted GPA.
      { re: ci("do(?:th|es)?\\s+hereby\\s+(?:nominate|constitute|appoint)"), w: 10 },
      // Likewise "his/her/its true and lawful attorney" — the original required
      // "my", which only fits a first-person deed. Between them these two
      // omissions cost the profile 19 of its 37 points and it lost to AGREEMENT.
      { re: ci("(?:my|his|her|its|their)\\s+(?:true\\s+and\\s+)?lawful\\s+attorney"), w: 9 },
      { re: ci("\\battorney\\s+shall\\s+(?:not\\s+)?have\\s+the\\s+power"), w: 6 },
      { re: ci("\\bthe\\s+(?:Principal|PRINCIPAL)\\b"), w: 5 },
    ],
    antiCues: [
      { re: ci("\\bthis\\s+agreement\\s+is\\s+made"), w: 5 },
    ],
    expectedFields: ["parties", "poa.date", "poa.powers", "property.surveyNo"],
  },
  {
    code: "BOARD_RESOLUTION", label: "Board Resolution", family: "CORPORATE",
    cues: [
      { re: ci("(?:certified\\s+(?:true\\s+)?copy\\s+of\\s+the\\s+)?resolution\\s+passed"), w: 10 },
      { re: ci("board\\s+of\\s+directors"), w: 8 },
      { re: ci("\\bRESOLVED\\s+THAT\\b"), w: 11 },
      { re: ci("meeting\\s+of\\s+the\\s+board\\s+held\\s+on"), w: 9 },
      { re: ci("authoris(?:ed|e)\\s+to\\s+(?:sign|represent|institute)"), w: 6 },
    ],
    expectedFields: ["parties", "ids.cin", "resolution.date", "authorisedSignatory"],
  },

  // ---------------------------------------------------------------- CONTRACT
  {
    code: "AGREEMENT", label: "Agreement / Contract", family: "CONTRACT",
    anchorProfile: "CONTRACT",
    cues: [
      { re: ci("this\\s+agreement\\s+is\\s+made"), w: 11 },
      { re: ci("\\bWHEREAS\\b"), w: 6 },
      { re: ci("NOW\\s+THEREFORE|NOW\\s+THIS\\s+.{0,30}WITNESSETH"), w: 8 },
      { re: ci("(?:party|parties)\\s+of\\s+the\\s+(?:first|second)\\s+part"), w: 8 },
      { re: ci("in\\s+witness\\s+whereof"), w: 7 },
      { re: ci("\\bshall\\b.{0,80}\\bshall\\b"), w: 2 },
      { re: ci("governing\\s+law|exclusive\\s+jurisdiction"), w: 5 },
    ],
    antiCues: [
      { re: ci("deed\\s+of\\s+(?:absolute\\s+)?sale|sale\\s+deed"), w: 8 },
      // A power of attorney carries WHEREAS / NOW THEREFORE / IN WITNESS WHEREOF
      // exactly like a commercial agreement, so those cues alone cannot separate
      // them. The deed's own name has to.
      { re: ci("power\\s+of\\s+attorney"), w: 12 },
      { re: ci("(?:my|his|her|its)\\s+(?:true\\s+and\\s+)?lawful\\s+attorney"), w: 8 },
      { re: ci("\\bvakalatnama\\b"), w: 10 },
      // A partnership deed, a lease and a sale deed are all agreements in the
      // general sense and share every structural cue — WHEREAS, NOW THIS DEED
      // WITNESSETH, arbitration, exclusive jurisdiction. Only the instrument's
      // own name separates them, so the name has to outweigh the structure.
      // PARTNERSHIP_DEED was winning by 0.01 before this.
      { re: ci("partnership\\s+deed"), w: 12 },
      { re: ci("deed\\s+of\\s+lease|rent\\s+agreement"), w: 10 },
      { re: ci("memorandum\\s+of\\s+association|articles\\s+of\\s+association"), w: 12 },
      { re: ci("agreement\\s+(?:to\\s+sell|for\\s+sale)"), w: 10 },
    ],
    expectedFields: ["parties", "agreement.date", "amounts", "obligations", "arbitration.clause", "jurisdiction.clause", "term"],
  },
  {
    code: "SALE_DEED", label: "Sale Deed", family: "PROPERTY",
    statutoryForm: "TPA s.54; Registration Act s.17",
    anchorProfile: "DEED",
    cues: [
      { re: ci("deed\\s+of\\s+(?:absolute\\s+)?sale|sale\\s+deed"), w: 12 },
      { re: ci("\\bVENDOR\\b.{0,200}\\bPURCHASER\\b"), w: 9 },
      { re: ci("grant,?\\s+convey\\s+and\\s+transfer"), w: 10 },
      { re: ci("schedule\\s+of\\s+(?:the\\s+)?property"), w: 8 },
      { re: ci("free\\s+from\\s+all\\s+encumbrances"), w: 7 },
      { re: ci("(?:survey|khasra|khata|C\\.?T\\.?S\\.?)\\s*no"), w: 6 },
      { re: ci("sub\\s*-?\\s*registrar"), w: 6 },
      { re: ci("stamp\\s+duty"), w: 4 },
    ],
    antiCues: [{ re: ci("agreement\\s+to\\s+sell|agreement\\s+for\\s+sale"), w: 10 }],
    expectedFields: [
      "parties", "deed.date", "amounts", "property.surveyNo", "property.extent",
      "property.boundaries", "property.registrationNo", "witnesses",
    ],
  },
  {
    code: "AGREEMENT_TO_SELL", label: "Agreement to Sell", family: "PROPERTY",
    cues: [
      { re: ci("agreement\\s+(?:to\\s+sell|for\\s+sale)"), w: 12 },
      { re: ci("agreed\\s+to\\s+(?:sell|purchase)"), w: 7 },
      { re: ci("(?:advance|earnest)\\s+(?:money|amount)"), w: 9 },
      { re: ci("balance\\s+(?:sale\\s+)?consideration"), w: 8 },
      { re: ci("time\\s+(?:is|being)\\s+(?:of\\s+)?the\\s+essence"), w: 6 },
    ],
    antiCues: [
      { re: ci("grant,?\\s+convey\\s+and\\s+transfer"), w: 9 },
      // A first appeal against dismissal of a specific-performance suit talks
      // about the agreement to sell throughout — earnest money, readiness and
      // willingness, the Specific Relief Act. It is a PLEADING about a contract,
      // not the contract. Without these it came within 0.11 of winning.
      { re: ci("memorandum\\s+of\\s+appeal"), w: 10 },
      { re: ci("grounds\\s+of\\s+appeal"), w: 9 },
      { re: ci("learned\\s+trial\\s+court"), w: 8 },
      { re: ci("judgment\\s+and\\s+decree\\s+dated"), w: 8 },
      { re: ci("\\bIN\\s+THE\\s+COURT\\s+OF\\b|\\bIN\\s+THE\\s+HIGH\\s+COURT\\b"), w: 6 },
    ],
    expectedFields: ["parties", "agreement.date", "amounts", "property.surveyNo", "completion.date"],
  },
  {
    code: "LEASE_DEED", label: "Lease / Rent Agreement", family: "PROPERTY",
    statutoryForm: "TPA s.105",
    cues: [
      // Anchored. Unanchored, `lease` matched inside "pleased" — and "be pleased
      // to" is the standard prayer formula in every Indian pleading, so this cue
      // fired at weight 11 on maintenance petitions, writs and plaints alike.
      // Surfaced only once all 58 types had fixtures.
      { re: ci("\\b(?:deed\\s+of\\s+)?lease\\b|\\brent\\s+agreement\\b|\\bleave\\s+and\\s+licen[cs]e\\b"), w: 11 },
      { re: ci("\\bLESSOR\\b.{0,200}\\bLESSEE\\b"), w: 9 },
      { re: ci("monthly\\s+rent"), w: 8 },
      { re: ci("security\\s+deposit"), w: 7 },
      { re: ci("(?:lock\\s*-?\\s*in|lease)\\s+period"), w: 6 },
    ],
    expectedFields: ["parties", "lease.date", "amounts", "property.surveyNo", "lease.term", "lease.rent"],
  },
  {
    code: "PARTNERSHIP_DEED", label: "Partnership Deed", family: "CORPORATE",
    cues: [
      { re: ci("partnership\\s+deed"), w: 12 },
      { re: ci("\\bpartners?\\b.{0,60}profit\\s+(?:and\\s+loss\\s+)?shar"), w: 9 },
      { re: ci("capital\\s+contribution"), w: 7 },
      { re: ci("indian\\s+partnership\\s+act"), w: 8 },
      { re: ci("partner\\s+of\\s+the\\s+(?:first|second|third)\\s+part"), w: 9 },
      { re: ci("carry\\s+on\\s+business\\s+in\\s+partnership"), w: 10 },
      { re: ci("partnership\\s+shall\\s+be\\s+at\\s+will"), w: 9 },
      { re: ci("name\\s+and\\s+style\\s+of"), w: 7 },
    ],
    expectedFields: ["parties", "deed.date", "amounts", "partnership.shares"],
  },
  {
    code: "MOA_AOA", label: "Memorandum / Articles of Association", family: "CORPORATE",
    cues: [
      { re: ci("memorandum\\s+of\\s+association"), w: 12 },
      { re: ci("articles\\s+of\\s+association"), w: 12 },
      { re: ci("(?:authoris|authoriz)ed\\s+(?:share\\s+)?capital"), w: 8 },
      { re: ci("(?:main\\s+)?objects?\\s+(?:to\\s+be\\s+pursued|clause)"), w: 7 },
      { re: ci("registrar\\s+of\\s+companies"), w: 6 },
    ],
    expectedFields: ["parties", "ids.cin", "company.name", "company.capital", "company.objects"],
  },

  // ---------------------------------------------------------------- FINANCIAL
  {
    code: "CHEQUE", label: "Cheque", family: "FINANCIAL",
    cues: [
      { re: ci("\\bPAY\\b.{0,40}\\bOR\\s+BEARER\\b"), w: 11 },
      { re: ci("\\bA\\/c\\s+Payee\\b"), w: 8 },
      { re: ci("\\bMICR\\b"), w: 7 },
      { re: ci("valid\\s+for\\s+three\\s+months"), w: 8 },
      { re: ci("\\bIFSC\\b"), w: 4 },
    ],
    expectedFields: ["instrument.chequeNo", "instrument.amount", "instrument.date", "bank.ifsc", "bank.micr", "parties"],
  },
  {
    code: "RETURN_MEMO", label: "Cheque Return Memo", family: "FINANCIAL",
    cues: [
      { re: ci("(?:cheque\\s+)?return(?:ing)?\\s+memo"), w: 12 },
      { re: ci("returned\\s+unpaid"), w: 10 },
      { re: ci("reason\\s+for\\s+return"), w: 9 },
      { re: ci("insufficient\\s+funds|exceeds\\s+arrangement|payment\\s+stopped"), w: 9 },
    ],
    expectedFields: ["instrument.chequeNo", "instrument.amount", "instrument.dishonourDate", "instrument.dishonourReason", "bank.ifsc"],
  },
  {
    code: "BANK_STATEMENT", label: "Bank Statement", family: "FINANCIAL",
    cues: [
      { re: ci("(?:account|bank)\\s+statement"), w: 11 },
      { re: ci("statement\\s+of\\s+account"), w: 11 },
      { re: ci("(?:opening|closing)\\s+balance"), w: 8 },
      { re: ci("\\bDR\\b.{0,10}\\bCR\\b|debit.{0,20}credit"), w: 5 },
      { re: ci("value\\s+date|narration|particulars"), w: 4 },
    ],
    expectedFields: ["bank.accountNo", "bank.ifsc", "parties", "statement.period", "amounts"],
  },
  {
    code: "DEMAND_NOTICE_SARFAESI", label: "SARFAESI Demand Notice", family: "FINANCIAL",
    statutoryForm: "SARFAESI Act s.13(2)",
    cues: [
      { re: ci("section\\s+13\\s*\\(\\s*2\\s*\\)"), w: 11 },
      { re: ci("SARFAESI|securitisation\\s+and\\s+reconstruction"), w: 10 },
      { re: ci("non\\s*-?\\s*performing\\s+asset|\\bNPA\\b"), w: 8 },
      { re: ci("secured\\s+(?:creditor|asset)"), w: 7 },
      { re: ci("60\\s+days"), w: 3 },
    ],
    expectedFields: ["parties", "notice.date", "amounts", "loan.accountNo", "property.surveyNo"],
  },
  {
    code: "INVOICE", label: "Invoice / Tax Invoice", family: "FINANCIAL",
    cues: [
      { re: ci("\\b(?:tax\\s+)?invoices?\\b"), w: 10 },
      { re: ci("\\bGSTIN\\b"), w: 8 },
      { re: ci("\\bHSN\\b|\\bSAC\\b"), w: 7 },
      { re: ci("(?:C|S|I)GST\\s*@?\\s*\\d"), w: 8 },
      { re: ci("total\\s+(?:invoice\\s+)?(?:value|amount)"), w: 5 },
    ],
    expectedFields: ["parties", "ids.gstin", "invoice.number", "invoice.date", "amounts"],
  },

  // ----------------------------------------------------------------- IDENTITY
  {
    code: "AADHAAR_CARD", label: "Aadhaar Card", family: "IDENTITY",
    cues: [
      { re: ci("आधार|aadhaar|unique\\s+identification\\s+authority"), w: 12 },
      { re: ci("\\bUIDAI\\b"), w: 10 },
      { re: ci("मेरा\\s*आधार|my\\s+aadhaar,?\\s+my\\s+identity"), w: 8 },
    ],
    expectedFields: ["parties", "ids.aadhaar", "address"],
  },
  {
    code: "PAN_CARD", label: "PAN Card", family: "IDENTITY",
    cues: [
      { re: ci("permanent\\s+account\\s+number"), w: 12 },
      { re: ci("income\\s+tax\\s+department"), w: 8 },
      { re: ci("आयकर\\s*विभाग"), w: 8 },
    ],
    expectedFields: ["parties", "ids.pan", "parties.dob"],
  },
  {
    code: "PASSPORT", label: "Passport", family: "IDENTITY",
    cues: [
      { re: ci("republic\\s+of\\s+india.{0,40}passport"), w: 12 },
      { re: ci("passport\\s+no"), w: 9 },
      { re: ci("place\\s+of\\s+issue|date\\s+of\\s+expiry"), w: 6 },
    ],
    expectedFields: ["parties", "ids.passport", "parties.dob", "address"],
  },

  // ------------------------------------------------------------------ STATUTE
  {
    code: "ACT", label: "Act / Statute", family: "STATUTE",
    cues: [
      { re: ci("\\bTHE\\s+.{5,70}\\s+ACT,?\\s+(?:19|20)\\d{2}"), w: 11 },
      { re: ci("BE\\s+it\\s+enacted\\s+by\\s+parliament"), w: 12 },
      { re: ci("an\\s+act\\s+to\\s+(?:provide|amend|consolidate)"), w: 10 },
      { re: ci("short\\s+title.{0,40}(?:extent|commencement)"), w: 9 },
      { re: ci("chapter\\s+[IVXL]+"), w: 4 },
    ],
    expectedFields: ["acts", "act.number", "act.year", "act.title"],
  },
  {
    code: "ORDINANCE", label: "Ordinance", family: "STATUTE",
    cues: [
      { re: ci("\\bordinance\\b"), w: 11 },
      { re: ci("promulgated\\s+by\\s+the\\s+president"), w: 12 },
      { re: ci("article\\s+123"), w: 9 },
      { re: ci("article\\s+213"), w: 9 },
    ],
    expectedFields: ["acts", "act.number", "act.year"],
  },
  {
    code: "NOTIFICATION", label: "Notification / Gazette", family: "STATUTE",
    cues: [
      { re: ci("\\bthe\\s+gazette\\s+of\\s+india\\b"), w: 12 },
      { re: ci("\\bS\\.?O\\.?\\s*\\d+\\s*\\(?E?\\)?"), w: 9 },
      { re: ci("\\bG\\.?S\\.?R\\.?\\s*\\d+"), w: 9 },
      { re: ci("in\\s+exercise\\s+of\\s+the\\s+powers\\s+conferred"), w: 11 },
      { re: ci("ministry\\s+of\\s+.{3,40}notification"), w: 7 },
    ],
    expectedFields: ["notifications", "acts", "dates"],
  },

  // -------------------------------------------------------------------- BOND
  {
    code: "BAIL_BOND", label: "Bail / Surety Bond", family: "BOND",
    cues: [
      { re: ci("(?:bail|surety|personal)\\s+bond"), w: 12 },
      { re: ci("bind\\s+myself"), w: 10 },
      { re: ci("\\bsurety\\b.{0,60}\\bsolvent\\b"), w: 8 },
      { re: ci("forfeited\\s+to\\s+(?:the\\s+)?(?:state|government)"), w: 8 },
    ],
    expectedFields: ["court.raw", "caseNumber", "parties", "amounts", "sections"],
  },

  // ------------------------------------------------------------- COURT ADMIN
  {
    code: "CAUSE_LIST", label: "Cause List", family: "COURT_ADMIN",
    cues: [
      { re: ci("cause\\s+list"), w: 12 },
      { re: ci("(?:daily|supplementary|advance)\\s+(?:cause\\s+)?list"), w: 10 },
      { re: ci("court\\s+no\\.?\\s*\\d+"), w: 6 },
      { re: ci("\\bs\\.?\\s?no\\b.{0,40}\\bcase\\s+no\\b"), w: 6 },
      { re: ci("for\\s+(?:admission|hearing|orders|judgment)"), w: 4 },
    ],
    expectedFields: ["court.raw", "causeList.date", "caseNumbers"],
  },
  {
    code: "FILING_RECEIPT", label: "Filing Receipt / Acknowledgement", family: "COURT_ADMIN",
    cues: [
      { re: ci("(?:filing|e-?filing)\\s+(?:receipt|acknowledg)"), w: 12 },
      { re: ci("acknowledgement\\s+(?:no|slip)"), w: 9 },
      { re: ci("court\\s+fee\\s+(?:paid|of\\s+Rs)"), w: 8 },
      { re: ci("\\bCNR\\b"), w: 6 },
    ],
    expectedFields: ["court.raw", "caseNumber", "cnr", "filing.date", "amounts"],
  },

  // ----------------------------------------------------------------- MEDICAL
  {
    code: "MLC", label: "Medico-Legal Case Report", family: "MEDICAL",
    cues: [
      { re: ci("medico\\s*-?\\s*legal"), w: 12 },
      { re: ci("\\bM\\.?L\\.?C\\.?\\s*(?:No|register)"), w: 9 },
      { re: ci("brought\\s+by\\s+.{0,30}(?:police|constable)"), w: 7 },
      { re: ci("nature\\s+of\\s+injur(?:y|ies)"), w: 9 },
      { re: ci("(?:simple|grievous)\\s+(?:in\\s+nature|injury)"), w: 8 },
    ],
    expectedFields: ["parties", "fir.number", "mlc.number", "injury.nature", "dates"],
  },
  {
    code: "POST_MORTEM", label: "Post-Mortem Report", family: "MEDICAL",
    cues: [
      { re: ci("post\\s*-?\\s*mortem"), w: 12 },
      { re: ci("autopsy"), w: 10 },
      { re: ci("cause\\s+of\\s+death"), w: 10 },
      { re: ci("\\bP\\.?M\\.?\\s*(?:No|report)"), w: 6 },
      { re: ci("inquest"), w: 6 },
    ],
    expectedFields: ["parties", "fir.number", "death.cause", "postMortem.date"],
  },
];

/** Index by code for fast lookup. */
export const DOC_TYPE_INDEX: Map<string, DocTypeProfile> =
  new Map(DOC_TYPES.map((d) => [d.code, d]));

export function profileFor(code: string): DocTypeProfile | null {
  return DOC_TYPE_INDEX.get(code) ?? null;
}
