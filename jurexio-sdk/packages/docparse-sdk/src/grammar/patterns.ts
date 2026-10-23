/**
 * The Indian legal identifier grammar pack.
 *
 * This is the deterministic backbone of extraction. Every pattern here was
 * written against real document shapes and is covered by an assertion in
 * test/patterns.test.ts. Two rules govern additions:
 *
 *  1. A pattern that can produce a false positive on ordinary prose does not
 *     belong here without a required context word. "1234/2024" is not a case
 *     number on its own; "C.C. No. 1234/2024" is.
 *  2. Every pattern is anchored with \b or an explicit boundary class. An
 *     unanchored numeric pattern will happily match the middle of an Aadhaar
 *     number and corrupt a field.
 *
 * All patterns assume the input has already been through grammar/script.ts
 * `prepare()` — NFC-normalised, zero-width stripped, Indic digits folded to
 * ASCII. They will silently under-match on raw OCR output.
 */

// ---------------------------------------------------------------------------
// Court identifiers
// ---------------------------------------------------------------------------

/**
 * CNR — Case Number Record, the national unique case id.
 * 16 characters: 2 alpha state + 2 alpha district/complex + 2 digit
 * establishment + 6 digit serial + 4 digit year.  e.g. DLST010012342024
 *
 * Captured in parts because the parts are independently useful: the state code
 * resolves the jurisdiction even when the rest of the document is silent.
 */
export const CNR = /\b([A-Z]{2})([A-Z]{2})(\d{2})(\d{6})((?:19|20)\d{2})\b/g;

/**
 * Supreme Court neutral citation, in force since 2023: `2024 INSC 456`.
 * Also matches the hyphenated variant some reporters use.
 */
export const NEUTRAL_SC = /\b((?:19|20)\d{2})\s*[:\- ]\s*INSC\s*[:\- ]?\s*(\d{1,5})\b/gi;

/**
 * High Court neutral citation: `2024:DHC:1234`, `2024:BHC-AS:5678:DB`,
 * `2024:KER:9012`. The hyphenated bench suffix is mandatory to support — every
 * Bombay-family citation carries one (BHC-AS Aurangabad, BHC-NAG Nagpur,
 * BHC-GOA Goa, BHC-OS original side), and dropping it discards them all.
 */
export const NEUTRAL_HC =
  /\b((?:19|20)\d{2}):([A-Z]{2,6}(?:-[A-Z]{2,4})?):(\d{1,6})(?:[:\-](DB|FB|SB|\d{1,4}))?\b/g;

/**
 * Reported citations.
 *
 * Deliberately a closed union of the reporters that actually appear in Indian
 * pleadings, not an open `YYYY XX 123` pattern — an open pattern matches any
 * year-token-number triple and floods the candidate list with case numbers,
 * paragraph references and table rows.
 *
 * There are two structurally different shapes and one pattern cannot cover both:
 *
 *   SCC style:  (2024) 3 SCC 456      — year, VOLUME, reporter, page
 *   AIR style:  AIR 2019 SC 1234      — reporter, year, court, page
 *
 * The first version only handled `year reporter page` and therefore missed
 * "(2024) 3 SCC 456" — the single most cited format in Indian practice. Both
 * shapes now have their own pattern.
 */
const REPORTERS =
  String.raw`SCC\s*\(Cri\)|SCC\s*\(L&S\)|SCC|SCR|SCJ|JT|SCALE|` +
  String.raw`Cri\.?\s*L\.?J\.?|CriLJ|ILR|BomLR|Bom\.?\s*L\.?R\.?|` +
  String.raw`CalWN|MLJ|AWC|DLT|DRJ|RLW|PLR|GLR|KLT|KLJ|MPLJ|CTC|LW|` +
  String.raw`ITR|GSTR|VST|STC|CTR|Comp\s*Cas|CLA|SEBI|NCLT|` +
  String.raw`LabIC|FLR|LLJ|LLR|ACJ|ACC|RCR|ADJ`;

/** `(2024) 3 SCC 456`, `2021 Cri LJ 998` — volume optional. */
export const CITATION_REPORTED = new RegExp(
  String.raw`\(?\b((?:19|20)\d{2})\)?\s+(?:(\d{1,3})\s+)?(${REPORTERS})\s+(\d{1,4})\b`,
  "gi",
);

/** `AIR 2019 SC 1234`, `AIR 1973 SC 1461` — reporter first, court token in the middle. */
export const CITATION_AIR = new RegExp(
  String.raw`\bAIR\s+((?:19|20)\d{2})\s+([A-Z][A-Za-z]{1,6})\s+(\d{1,4})\b`,
  "g",
);

/**
 * Case number as printed on a cause title or filing receipt.
 *
 * The type token is the hard part: Indian courts use several hundred, with dots,
 * parentheses and ampersands — `W.P.(C)`, `CRL.A.`, `O.S.`, `Crl.M.C.`,
 * `T.R.P.(C)`, `SLP(Crl)`, `M.A.C.T.`, `E.P.`, `R.S.A.`. We accept a bounded
 * token shape and require an explicit number marker, which is what keeps this
 * from matching ordinary text.
 *
 * Case-type codes are court-scoped, never national. Resolution of the token to a
 * `nyv_ref` case-type code must be done with a court id in hand.
 */
export const CASE_NUMBER = new RegExp(
  // A negative lookahead for police and registry references. Without it, "FIR
  // No. 0123/2024" parsed as a case number with type token "FIR" and then
  // competed with the real case number in the cause title, turning the field
  // into a conflict on every criminal document that cites its own FIR.
  String.raw`\b(?!(?:FIR|F\.I\.R|Crime|Cr|Diary|GD|G\.D|Receipt|Challan|Acknowledgement)\b)` +
  String.raw`([A-Z][A-Za-z]{0,6}(?:\.\s?[A-Za-z]{1,6}){0,4}\.?` +
  String.raw`(?:\s?\((?:C|Crl|Cri|Civil|Criminal|MD|PIL|S|L|T|A|R|MB|HC|CAA|CT|CA)\))?)` +
  String.raw`\s*(?:No\.?|Number|NO\.?|no\.?)\s*[:\-]?\s*` +
  String.raw`(\d{1,7})\s*(?:\/|\s+of\s+|\s+OF\s+|-)\s*((?:19|20)\d{2})\b`,
  "g",
);

/** Supreme Court diary number: `Diary No. 12345/2024`. */
export const DIARY_NO =
  /\bDiary\s*(?:No\.?|Number)?\s*[:\-]?\s*(\d{1,7})\s*[\/\-]\s*((?:19|20)\d{2})\b/gi;

/** Court-fee / filing receipt reference. */
export const FILING_RECEIPT =
  /\b(?:Filing|Receipt|Acknowledg(?:e)?ment)\s*(?:No\.?|Number|ID)\s*[:\-]?\s*([A-Z0-9\/\-]{5,25})\b/gi;

// ---------------------------------------------------------------------------
// Police / criminal identifiers
// ---------------------------------------------------------------------------

/**
 * FIR number. Real documents write this at least six ways:
 *   "FIR No. 123/2024", "F.I.R. No: 0123/24", "FIR No 123 of 2024",
 *   "Crime No. 45/2024", "Cr. No. 45/2024", "First Information Report No. 123/2024"
 * Two-digit years are accepted and expanded downstream — a 1990s FIR in a
 * long-running matter is common and must not be dropped.
 */
export const FIR_NO = new RegExp(
  String.raw`\b(?:F\.?\s?I\.?\s?R\.?|First\s+Information\s+Report|Crime|Cr\.?|Crl\.?)\s*` +
  String.raw`(?:No\.?|Number|NO\.?)?\s*[:\-]?\s*` +
  String.raw`(\d{1,6})\s*(?:\/|\s+of\s+|\s+OF\s+|-)\s*((?:19|20)?\d{2})\b`,
  "gi",
);

/** Police station, with the name captured. Stops at a line end or a comma. */
export const POLICE_STATION = new RegExp(
  String.raw`\b(?:P\.?\s?S\.?|Police\s+Station|Thana|PS)\s*[:\-.]?\s*` +
  String.raw`([A-Z][A-Za-z.ऀ-෿\s\-]{2,40}?)` +
  String.raw`(?=\s*(?:,|;|\.|\n|$|District|Distt|Dist\b))`,
  "g",
);

/** General Diary entry: `GD No. 45 dated 12.03.2024`. */
export const GD_ENTRY =
  /\b(?:G\.?\s?D\.?|General\s+Diary)\s*(?:Entry\s*)?(?:No\.?|Number)?\s*[:\-]?\s*(\d{1,6})\b/gi;

/** Charge sheet / final report number. */
export const CHARGESHEET_NO = new RegExp(
  String.raw`\b(?:Charge\s*-?\s*sheet|Final\s+Report|Challan)\s*(?:No\.?|Number)?\s*[:\-]?\s*` +
  String.raw`(\d{1,6})\s*(?:\/|\s+of\s+)\s*((?:19|20)?\d{2})\b`,
  "gi",
);

/** Arrest / custody: `arrested on 12.03.2024`, `in judicial custody since ...`. */
export const CUSTODY_CUE =
  /\b(arrested|remanded|judicial\s+custody|police\s+custody|released\s+on\s+bail|absconding|proclaimed\s+offender)\b/gi;

// ---------------------------------------------------------------------------
// Statutory sections
// ---------------------------------------------------------------------------

/**
 * A run of section numbers followed by the statute.
 *
 * Handles the shapes that actually occur:
 *   "u/s 302, 307 r/w 34 IPC"
 *   "under Sections 138 of the NI Act"
 *   "Sec. 420/34 IPC"
 *   "S. 376AB IPC"
 *   "under section 66A of the Information Technology Act"
 *   "Sections 4(1)(a) and 5 of the POCSO Act"
 *
 * The section run is captured whole and split by parseSections(), because the
 * separators are heterogeneous (comma, "and", "&", "/", "r/w", "read with").
 *
 * ON BACKTRACKING — this pattern was rewritten after it hung the test runner.
 *
 * The first version made the separator OPTIONAL inside a `{1,25}` repetition:
 *   ((?:\d{1,4}[A-Z]{0,3}(...)*\s*(?:,|and|...)?\s*){1,25})
 * Against a long digit run with no statute following ("u/s 111…1 IPCxxx…"), a
 * 200-digit string can be partitioned among 25 repetitions in exponentially many
 * ways, and the engine tries all of them before failing. Measured: no result in
 * 90 seconds on 200 digits. In production that is a wedged ingest worker holding
 * a page lock, triggered by one bad OCR read of a table of figures.
 *
 * The fix is to make the separator MANDATORY between tokens. Each repetition then
 * has to consume a separator character, so there is exactly one way to partition
 * a digit run and the match either succeeds or fails in linear time. Longer
 * separator alternatives come first so "r/w" is not shadowed by "/".
 */
const SEC_TOKEN = String.raw`\d{1,4}[A-Z]{0,3}(?:\(\s*[0-9a-zA-Z]{1,4}\s*\))*`;
/**
 * Separator between section tokens.
 *
 * The trailing `(?:[Ss]ections?|[Ss]ec\.?|S\.)\s*` is load-bearing. Indian
 * drafting repeats the keyword: "under Section 138 read with Section 142 of the
 * Negotiable Instruments Act". Without allowing the keyword after the separator,
 * the run terminated at 138, the statute lookahead then failed, the whole match
 * was abandoned, and the regex re-entered at "Section 142" — so s.138 itself,
 * the section the entire complaint is about, was silently dropped.
 */
const SEC_SEP = String.raw`\s*(?:read\s+with|r\/w|R\/W|and|,|&|\/)\s*(?:[Ss]ections?|SECTIONS?|[Ss]ec\.?|S\.)?\s*`;

export const SECTION_BLOCK = new RegExp(
  String.raw`\b(?:u\/s|U\/S|u\/sec|under\s+[Ss]ections?|UNDER\s+SECTIONS?|[Ss]ections?|SECTIONS?|[Ss]ec\.?|SEC\.?|S\.)\s*[:\-]?\s*` +
  String.raw`(${SEC_TOKEN}(?:${SEC_SEP}${SEC_TOKEN}){0,24})` +
  String.raw`\s*(?:of\s+(?:the\s+)?)?` +
  String.raw`(IPC|I\.P\.C\.?|Indian\s+Penal\s+Code|BNS|Bharatiya\s+Nyaya\s+Sanhita|` +
  String.raw`CrPC|Cr\.?P\.?C\.?|Code\s+of\s+Criminal\s+Procedure|BNSS|Bharatiya\s+Nagarik\s+Suraksha\s+Sanhita|` +
  String.raw`IEA|Indian\s+Evidence\s+Act|BSA|Bharatiya\s+Sakshya\s+Adhiniyam|` +
  String.raw`CPC|C\.?P\.?C\.?|Code\s+of\s+Civil\s+Procedure|` +
  String.raw`NDPS|POCSO|JJ\s*Act|NI\s*Act|N\.?I\.?\s*Act|[Nn]egotiable\s+[Ii]nstruments\s+[Aa]ct|NEGOTIABLE\s+INSTRUMENTS\s+ACT|` +
  String.raw`MV\s*Act|Motor\s+Vehicles\s+Act|IBC|Insolvency\s+and\s+Bankruptcy\s+Code|` +
  String.raw`Companies\s+Act|IT\s*Act|Information\s+Technology\s+Act|Income\s+Tax\s+Act|` +
  String.raw`GST\s*Act|CGST\s*Act|SGST\s*Act|Customs\s+Act|` +
  String.raw`PMLA|UAPA|SC\/ST\s*Act|Domestic\s+Violence\s+Act|DV\s*Act|` +
  String.raw`Hindu\s+Marriage\s+Act|HMA|Special\s+Marriage\s+Act|` +
  String.raw`RERA|Consumer\s+Protection\s+Act|CPA|Arbitration\s+and\s+Conciliation\s+Act|` +
  String.raw`Transfer\s+of\s+Property\s+Act|TPA|Specific\s+Relief\s+Act|` +
  String.raw`Limitation\s+Act|Contract\s+Act|SARFAESI|RDDBFI|` +
  String.raw`Constitution(?:\s+of\s+India)?|Prevention\s+of\s+Corruption\s+Act|PC\s*Act)\b`,
  // Case-INSENSITIVE. Headings are routinely set in full caps — "LEGAL NOTICE
  // UNDER SECTION 138 OF THE NEGOTIABLE INSTRUMENTS ACT, 1881" — and a
  // case-sensitive pattern matched the label but then failed on " OF THE ",
  // dropping the section the whole document is about. The trailing statute
  // requirement is what keeps this from firing on ordinary prose.
  "gi",
);

/**
 * Constitutional articles: `Article 226`, `Arts. 14 and 21`.
 * Same mandatory-separator construction as SECTION_BLOCK, for the same reason.
 */
const ART_TOKEN = String.raw`\d{1,3}[A-Z]{0,2}(?:\(\s*[0-9a-z]{1,3}\s*\))*`;
const ART_SEP = String.raw`\s*(?:and|,|&|\/)\s*`;

export const ARTICLE = new RegExp(
  String.raw`\b(?:Articles|Article|Arts\.?|Art\.?)\s*[:\-]?\s*` +
  String.raw`(${ART_TOKEN}(?:${ART_SEP}${ART_TOKEN}){0,9})` +
  String.raw`(?:\s*of\s+the\s+Constitution)?`,
  // Case-insensitive. Mid-sentence, statutes and pleadings write it in lower
  // case — "in exercise of the powers conferred by clause (1) of article 123 of
  // the Constitution" — and the case-sensitive version found nothing in an
  // entire Presidential Ordinance, which is the one document whose whole
  // authority rests on that article.
  "gi",
);

/** Order/Rule of the CPC: `Order VII Rule 11`, `O. 39 R. 1 & 2 CPC`. */
const RULE_TOKEN = String.raw`\d{1,3}[A-Z]?`;
const RULE_SEP = String.raw`\s*(?:and|,|&|to)\s*`;

export const ORDER_RULE = new RegExp(
  String.raw`\b(?:Order|O\.)\s*([IVXLC]{1,6}|\d{1,2})\s*,?\s*(?:Rule|R\.)\s*` +
  String.raw`(${RULE_TOKEN}(?:${RULE_SEP}${RULE_TOKEN}){0,5})`,
  "gi",
);

/** Act citation by number: `Act No. 45 of 1860`, `Central Act 13 of 2023`. */
export const ACT_NUMBER = new RegExp(
  String.raw`\b(?:Act\s*(?:No\.?|Number)?|Central\s+Act|State\s+Act)\s*[:\-]?\s*` +
  String.raw`(\d{1,3})\s+of\s+((?:1[6-9]|20)\d{2})\b`,
  "gi",
);

/**
 * The parenthetical citation form: `(18 of 2024)`, `(12 of 2017)`.
 *
 * This is how every amending instrument and every statutory cross-reference
 * cites the parent Act — "the Commercial Disputes Facilitation Act, 2024
 * (18 of 2024)". The parentheses make it distinctive enough to match without a
 * preceding keyword, which the keyword-led form above cannot do.
 */
export const ACT_NUMBER_PAREN = new RegExp(
  String.raw`\((\d{1,3})\s+of\s+((?:1[6-9]|20)\d{2})\)`,
  "g",
);

/** Gazette / notification reference. */
export const NOTIFICATION = new RegExp(
  String.raw`\b(?:S\.?O\.?|G\.?S\.?R\.?|Notification)\s*(?:No\.?)?\s*[:\-]?\s*` +
  String.raw`([0-9]{1,5}\s*\(?[EeA-Z]?\)?)\s*(?:,|\s)*(?:dated|dt\.?)?`,
  "g",
);

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** Numeric date: 12/03/2024, 12-3-24, 12.03.2024. India is DD/MM. */
export const DATE_NUMERIC =
  /\b(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{4}|\d{2})\b/g;

/** ISO date, which appears in system-generated court documents. */
export const DATE_ISO = /\b((?:19|20)\d{2})-(\d{2})-(\d{2})\b/g;

/**
 * Verbal date: `15th August, 2024`, `August 15, 2024`, `15 Aug 2024`,
 * `15th day of August, 2024` (the deed formula).
 */
export const DATE_VERBAL_DMY = new RegExp(
  String.raw`\b(\d{1,2})\s*(?:st|nd|rd|th)?\s*(?:day\s+of\s+)?` +
  String.raw`(January|February|March|April|May|June|July|August|September|October|November|December|` +
  String.raw`Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\.?,?\s*` +
  String.raw`((?:19|20)\d{2})\b`,
  "gi",
);

export const DATE_VERBAL_MDY = new RegExp(
  String.raw`\b(January|February|March|April|May|June|July|August|September|October|November|December|` +
  String.raw`Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\.?\s+` +
  String.raw`(\d{1,2})\s*(?:st|nd|rd|th)?\s*,?\s*((?:19|20)\d{2})\b`,
  "gi",
);

/** Date with an explicit legal marker — much higher confidence than a bare date. */
export const DATED_MARKER = new RegExp(
  String.raw`\b(?:dated|dt\.?|on|w\.?e\.?f\.?|with\s+effect\s+from|executed\s+on|` +
  String.raw`pronounced\s+on|reserved\s+on|delivered\s+on|filed\s+on|` +
  String.raw`registered\s+on|next\s+date|next\s+hearing|adjourned\s+to|` +
  String.raw`returnable\s+on|listed\s+on)\s*[:\-]?\s*` +
  String.raw`(\d{1,2}\s*[\/\-.]\s*\d{1,2}\s*[\/\-.]\s*(?:\d{4}|\d{2})|` +
  String.raw`\d{1,2}\s*(?:st|nd|rd|th)?\s*(?:day\s+of\s+)?[A-Z][a-z]{2,9}\.?,?\s*(?:19|20)\d{2})`,
  "gi",
);

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * Monetary amount with Indian grouping.
 *
 * The grouping is the trap. Indian numerals group as 1,50,000 — two digits at a
 * time above the last three — so a Western `\d{1,3}(?:,\d{3})*` pattern matches
 * "1,50,000" as "1,50" and silently loses two digits on every claim above one
 * lakh.
 *
 * The alternation is ordered: valid Indian grouping, then valid Western grouping,
 * then ANY comma-grouped run, then plain digits. The third branch exists so a
 * garbled OCR read like "1,50,00" is captured WHOLE and can be flagged
 * MALFORMED by money.ts. Without it the pattern fell through to `\d+`, captured
 * just "1", and reported a clean ₹1 — a wrong number that looks right, which is
 * the worst possible outcome for a suit valuation.
 */
export const MONEY = new RegExp(
  String.raw`(?:₹|Rs\.?|INR|Rupees|रु\.?|₨)\s*` +
  String.raw`((?:\d{1,2}(?:,\d{2})+,\d{3}|\d{1,3}(?:,\d{3})+|\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d{1,2})?)` +
  String.raw`\s*(crores?|lakhs?|lacs?|thousand|million|billion)?\s*(\/-|only)?`,
  "gi",
);

/** Amount written in words, used to cross-check the figure. */
export const MONEY_WORDS = new RegExp(
  String.raw`\b(?:Rupees|rupees)\s+` +
  String.raw`((?:[A-Za-z]+[\s\-]+){1,14}?(?:only|Only|ONLY))`,
  "g",
);

// ---------------------------------------------------------------------------
// Identity and statutory numbers
// ---------------------------------------------------------------------------

/**
 * Aadhaar — 12 digits, usually spaced 4-4-4, never starting 0 or 1.
 * This value must be masked before persistence. The pattern exists so we can
 * FIND and MASK it, not so we can store it.
 */
export const AADHAAR = /(?<!\d)([2-9]\d{3})\s?(\d{4})\s?(\d{4})(?!\d)/g;

/**
 * Note on the boundaries above.
 *
 * `\b` was not sufficient. A 15-digit IMEI such as 351234567890123 contains a
 * 12-digit Aadhaar-shaped substring starting at its fourth character, and while
 * `\b` happened to prevent that particular match, it does so only by accident of
 * where the word boundaries fall. The explicit `(?<!\d)` / `(?!\d)` lookarounds
 * state the actual rule: an Aadhaar is a standalone 12-digit run, never a window
 * into a longer number. Masking a chunk of someone's IMEI would be a visible bug;
 * asserting it as their Aadhaar would be a worse one.
 */

/** PAN: five letters, four digits, one letter. The 4th letter encodes holder type. */
export const PAN = /\b([A-Z]{3}[ABCFGHLJPTKE][A-Z]\d{4}[A-Z])\b/g;

/** GSTIN: 2 digit state + 10 char PAN + entity + Z + checksum. */
export const GSTIN = /\b(\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b/g;

/** CIN — company identification number, 21 chars. */
export const CIN = /\b([LUu]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})\b/g;

/** LLP identification number. */
export const LLPIN = /\b([A-Z]{3}-\d{4})\b/g;

/** DIN — director identification number, 8 digits, requires context. */
export const DIN = /\b(?:DIN|D\.?I\.?N\.?)\s*[:\-]?\s*(\d{8})\b/gi;

/** TAN — tax deduction account number. */
export const TAN = /\b([A-Z]{4}\d{5}[A-Z])\b/g;

/** Voter EPIC number. */
export const EPIC = /\b([A-Z]{3}\d{7})\b/g;

/** Indian passport: one letter (not Q,X,Z) + 7 digits. */
export const PASSPORT = /\b([A-PR-WY][0-9]{7})\b/g;

/** Driving licence: state code + RTO + year + serial. */
export const DRIVING_LICENCE = /\b([A-Z]{2}[-\s]?\d{2}[-\s]?(?:19|20)\d{2}[-\s]?\d{7})\b/g;

/** Bar Council enrolment: `D/1234/2015`, `MAH/5678/2010`, `Enrl. No. UP/321/2001`. */
export const BAR_ENROLMENT = new RegExp(
  String.raw`\b(?:Enrol(?:l)?ment|Enrl\.?|Bar\s*Council|Advocate\s*Code|Sr\.?\s*No\.?)?\s*` +
  String.raw`(?:No\.?)?\s*[:\-]?\s*` +
  String.raw`([A-Z]{1,4}\s?\/\s?\d{1,6}\s?\/\s?(?:19|20)\d{2})\b`,
  "g",
);

// ---------------------------------------------------------------------------
// Banking and instruments
// ---------------------------------------------------------------------------

/** IFSC: 4 alpha bank + 0 + 6 alnum branch. */
export const IFSC = /\b([A-Z]{4}0[A-Z0-9]{6})\b/g;

/** Cheque number — 6 digits, requires context to avoid matching any 6 digits. */
export const CHEQUE_NO = new RegExp(
  String.raw`\b(?:Cheque|Chq\.?|Check|D\.?D\.?|Demand\s+Draft|Pay\s*Order)\s*` +
  String.raw`(?:No\.?|Number|bearing\s+No\.?)?\s*[:\-]?\s*(\d{6,8})\b`,
  "gi",
);

/** MICR code, 9 digits, on the cheque face. */
export const MICR = /\b(?:MICR)\s*(?:Code|No\.?)?\s*[:\-]?\s*(\d{9})\b/gi;

/** Bank account number with context. Masked before persistence. */
export const ACCOUNT_NO = new RegExp(
  // "A/c" is routinely OCR'd as "Alc", "AIc" or "A1c" — the slash becomes an l,
  // an I or a 1. Accepting those variants recovers account references that were
  // otherwise invisible on scanned pages.
  String.raw`\b(?:A\s?[\/l|I1]\s?c|Account|Acct\.?|Bank\s+A\s?[\/l|I1]\s?c)\s*` +
  String.raw`(?:No\.?|Number)?\s*[:\-]?\s*(\d{9,18})\b`,
  "gi",
);

/** Cheque dishonour memo reason — the s.138 trigger. */
export const DISHONOUR_REASON =
  /\b(insufficient\s+funds?|funds?\s+insufficient|exceeds\s+arrangement|payment\s+stopped\s+by\s+drawer|account\s+closed|signature\s+differs|stale\s+cheque|drawer'?s?\s+signature\s+(?:differs|incomplete))\b/gi;

/** Loan / facility account reference. */
export const LOAN_ACCOUNT = new RegExp(
  String.raw`\b(?:Loan|Facility|Credit|LAN|Agreement)\s*(?:A\/c|Account)?\s*` +
  String.raw`(?:No\.?|Number|ID)\s*[:\-]?\s*([A-Z0-9\/\-]{6,25})\b`,
  "gi",
);

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

/** Survey / khasra / khata / plot numbers. */
export const SURVEY_NO = new RegExp(
  String.raw`\b(?:Survey|Sy\.?|S\.?\s?No\.?|Khasra|Khata|Gata|Plot|Flat|Door|Municipal|` +
  String.raw`T\.?S\.?\s?No\.?|R\.?S\.?\s?No\.?|C\.?T\.?S\.?\s?No\.?)\s*` +
  String.raw`(?:No\.?|Number)?\s*[:\-]?\s*` +
  String.raw`(\d{1,5}(?:\s*\/\s*\d{1,4}){0,3}(?:\s*-\s*[A-Z0-9]{1,4})?)\b`,
  "g",
);

/** Registered document reference: `Document No. 1234/2020 of Book-I`. */
export const REG_DOC_NO = new RegExp(
  String.raw`\b(?:Document|Doc\.?|Deed|Registration)\s*(?:No\.?|Number)\s*[:\-]?\s*` +
  String.raw`(\d{1,6})\s*(?:\/|\s+of\s+)\s*((?:19|20)\d{2})\b`,
  "gi",
);

/** Vehicle registration: `MH 12 AB 1234`, `DL8CAF1234`. */
export const VEHICLE_REG =
  /\b([A-Z]{2}[\s\-]?\d{1,2}[\s\-]?[A-Z]{0,3}[\s\-]?\d{4})\b/g;

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/** Relationship marker with the related person's name. */
export const RELATION = new RegExp(
  String.raw`\b(S\/o|s\/o|S\/O|D\/o|D\/O|W\/o|W\/O|C\/o|C\/O|H\/o|` +
  String.raw`son\s+of|daughter\s+of|wife\s+of|husband\s+of|care\s+of)\s*[:\-]?\s*` +
  String.raw`((?:Late\s+)?(?:Sri|Shri|Smt\.?|Mr\.?|Mrs\.?|Ms\.?|Dr\.?)?\s*` +
  String.raw`[A-Zऀ-෿][A-Za-z.ऀ-෿]*(?:\s+[A-Zऀ-෿][A-Za-z.ऀ-෿]*){0,4})`,
  "g",
);

/** Age, as pleaded. */
export const AGE = new RegExp(
  String.raw`\b(?:aged?|age|Age)\s*(?:about|approx\.?|around)?\s*` +
  String.raw`(\d{1,3})\s*(?:years?|yrs?\.?|Y)?\b`,
  "g",
);

/**
 * Party serial as printed on the array of parties.
 * `A-1`, `A1`, `Accused No. 2`, `R-3`, `PW-4`, `DW-2`, `Respondent No. 5`.
 */
export const PARTY_SERIAL = new RegExp(
  String.raw`\b(A|R|P|D|PW|DW|CW|OP)\s*[-–]?\s*(\d{1,3})\b|` +
  String.raw`\b(Accused|Respondent|Petitioner|Appellant|Plaintiff|Defendant|` +
  String.raw`Complainant|Applicant|Opposite\s+Party|Witness)\s*(?:No\.?|Number)?\s*[:\-]?\s*(\d{1,3})\b`,
  "g",
);

/** Honorific-led name, the most reliable name signal in Indian documents. */
export const HONORIFIC_NAME = new RegExp(
  String.raw`\b(Sri|Shri|Smt\.?|Mr\.?|Mrs\.?|Ms\.?|Dr\.?|Prof\.?|Hon'?ble|` +
  String.raw`Justice|J\.|Adv\.?|Advocate|Late\s+Sri|Late\s+Smt\.?|M\/s\.?)\s+` +
  String.raw`([A-Zऀ-෿][A-Za-z.ऀ-෿]*(?:\s+[A-Zऀ-෿][A-Za-z.ऀ-෿]*){0,5})`,
  "g",
);

/** Cause title separator. `Versus`, `Vs.`, `V/S`, `बनाम`. */
export const VERSUS = /(?:^|\s|\n)(?:-{0,3}\s*)?(?:Versus|VERSUS|versus|Vs\.?|VS\.?|vs\.?|V\/[Ss]|बनाम|எதிர்|వర్సెస్)(?:\s*-{0,3})?(?=\s|$|\n)/g;

/** Corporate entity suffix — separates a company from a natural person. */
export const ENTITY_SUFFIX = new RegExp(
  String.raw`\b(Pvt\.?\s*Ltd\.?|Private\s+Limited|Public\s+Limited|Ltd\.?|Limited|` +
  String.raw`LLP|L\.?L\.?P\.?|Inc\.?|Corp\.?|Corporation|Company|Co\.?|` +
  String.raw`Enterprises?|Industries|Trust|Society|Association|Bank|` +
  String.raw`Sangh|Samiti|Nigam|Board|Authority|Corporation\s+of\s+India|HUF)\b`,
  "g",
);

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

/** Indian mobile: optional +91/0 prefix, then 6-9 followed by 9 digits. */
export const PHONE_IN =
  /(?:(?:\+?91[\s\-]?)|(?:0(?=\d{10})))?([6-9]\d{9})\b/g;

/** Landline with STD code. */
export const PHONE_LANDLINE =
  /\b(?:0\d{2,4}[\s\-]?\d{6,8})\b/g;

export const EMAIL =
  /\b([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,63})\b/g;

/** PIN code, 6 digits not starting with 0. Requires no context — the shape is
 *  distinctive enough when combined with an address block check. */
export const PINCODE = /\b([1-9]\d{5})\b/g;

// ---------------------------------------------------------------------------
// Court / forum names
// ---------------------------------------------------------------------------

export const COURT_NAME = new RegExp(
  String.raw`\b(?:IN\s+THE\s+|BEFORE\s+THE\s+|In\s+the\s+|Before\s+the\s+)?` +
  String.raw`((?:HON'?BLE\s+|Hon'?ble\s+)?(?:` +
  String.raw`SUPREME\s+COURT(?:\s+OF\s+INDIA)?|Supreme\s+Court(?:\s+of\s+India)?|` +
  String.raw`HIGH\s+COURT[A-Za-z\s,'()\-]{0,60}|High\s+Court[A-Za-z\s,'()\-]{0,60}|` +
  String.raw`(?:COURT|Court)\s+OF\s+(?:THE\s+)?[A-Za-z\s,'()\-]{3,60}|` +
  String.raw`(?:DISTRICT|District)\s+(?:AND\s+SESSIONS\s+|and\s+Sessions\s+)?(?:JUDGE|Judge|COURT|Court)[A-Za-z\s,'()\-]{0,50}|` +
  String.raw`(?:CHIEF\s+)?(?:JUDICIAL|Judicial|METROPOLITAN|Metropolitan)\s+MAGISTRATE[A-Za-z\s,'()\-]{0,50}|` +
  String.raw`(?:CHIEF\s+)?(?:Judicial|Metropolitan)\s+Magistrate[A-Za-z\s,'()\-]{0,50}|` +
  String.raw`[A-Za-z\s]{0,30}TRIBUNAL[A-Za-z\s,'()\-]{0,50}|[A-Za-z\s]{0,30}Tribunal[A-Za-z\s,'()\-]{0,50}|` +
  String.raw`[A-Za-z\s]{0,30}COMMISSION[A-Za-z\s,'()\-]{0,50}|[A-Za-z\s]{0,30}Commission[A-Za-z\s,'()\-]{0,50}|` +
  String.raw`FAMILY\s+COURT[A-Za-z\s,'()\-]{0,50}|Family\s+Court[A-Za-z\s,'()\-]{0,50}|` +
  String.raw`(?:SPECIAL|Special)\s+(?:JUDGE|Judge|COURT|Court)[A-Za-z\s,'()\-]{0,50}` +
  String.raw`))`,
  "g",
);

/** Judge name on an order: `CORAM: HON'BLE MR. JUSTICE X`. */
export const CORAM = new RegExp(
  String.raw`\b(?:CORAM|Coram|BEFORE|Before)\s*[:\-]?\s*` +
  String.raw`((?:HON'?BLE|Hon'?ble)?[^\n]{5,120})`,
  "g",
);

// ---------------------------------------------------------------------------
// Pleading structure
// ---------------------------------------------------------------------------

/** Prayer / relief clause opener. */
export const PRAYER_CUE = new RegExp(
  String.raw`\b(?:PRAYER|Prayer|it\s+is\s+(?:therefore\s+)?(?:most\s+)?(?:humbly\s+)?prayed|` +
  String.raw`this\s+Hon'?ble\s+Court\s+may\s+be\s+pleased\s+to|` +
  String.raw`RELIEF\s+SOUGHT|Reliefs?\s+[Ss]ought|WHEREFORE)\b`,
  "g",
);

/** Verification clause, which closes a pleading. */
export const VERIFICATION_CUE = new RegExp(
  String.raw`\b(?:VERIFICATION|Verification|verified\s+at|I,?\s+the\s+(?:above\s+named\s+)?` +
  String.raw`(?:deponent|petitioner|plaintiff|complainant|applicant))\b`,
  "g",
);

/** Judgement disposition. */
export const DISPOSITION = new RegExp(
  String.raw`\b(?:appeal|petition|application|suit|revision|complaint)\s+is\s+` +
  String.raw`(allowed|dismissed|partly\s+allowed|partially\s+allowed|disposed\s+of|` +
  String.raw`withdrawn|abated|remanded|rejected)\b`,
  "gi",
);

/** Contract clause numbering: `Clause 4.2`, `Article 7.1.3`. */
export const CLAUSE_NO =
  /\b(?:Clause|clause|Cl\.?|Article|Section|Para(?:graph)?)\s*[:\-]?\s*(\d{1,3}(?:\.\d{1,3}){0,4})\b/g;

/** Obligation modal — what makes a clause an obligation rather than a recital. */
export const OBLIGATION_MODAL =
  /\b(shall|must|is\s+required\s+to|undertakes\s+to|agrees\s+to|covenants\s+to|is\s+liable\s+to|shall\s+not|may\s+not)\b/gi;

/** Arbitration clause cue. */
export const ARBITRATION_CUE = new RegExp(
  String.raw`\b(?:arbitrat(?:ion|or|al)\s+(?:clause|tribunal|proceedings)?|` +
  String.raw`referred\s+to\s+arbitration|sole\s+arbitrator|` +
  String.raw`Arbitration\s+and\s+Conciliation\s+Act)\b`,
  "gi",
);

/** Jurisdiction clause cue. */
export const JURISDICTION_CUE = new RegExp(
  String.raw`\b(?:courts?\s+at\s+[A-Z][a-z]+\s+(?:alone\s+)?shall\s+have|` +
  String.raw`exclusive\s+jurisdiction|subject\s+to\s+the\s+jurisdiction)\b`,
  "gi",
);

/** Limitation / notice period inside a contract or statutory notice. */
export const NOTICE_PERIOD = new RegExp(
  String.raw`\bwithin\s+(\d{1,3}|(?:thirty|sixty|ninety|fifteen|seven|fourteen|` +
  String.raw`one|two|three|six|twelve))\s*(days?|months?|years?|weeks?)\b`,
  "gi",
);

// ---------------------------------------------------------------------------
// Registry of every pattern, for the sweep runner
// ---------------------------------------------------------------------------

export interface PatternSpec {
  id: string;
  re: RegExp;
  /** Dotted field path the primary capture maps to, when it maps to one. */
  fieldPath?: string;
  /** Base confidence for a match from this pattern alone, before adjustment. */
  baseConf: number;
  /** True when the captured value must be masked before persistence. */
  sensitive?: boolean;
  /** Human label for the review UI. */
  label: string;
}

export const PATTERN_REGISTRY: PatternSpec[] = [
  { id: "CNR", re: CNR, fieldPath: "cnr", baseConf: 0.95, label: "CNR" },
  { id: "NEUTRAL_SC", re: NEUTRAL_SC, fieldPath: "citations.neutral", baseConf: 0.92, label: "SC neutral citation" },
  { id: "NEUTRAL_HC", re: NEUTRAL_HC, fieldPath: "citations.neutral", baseConf: 0.9, label: "HC neutral citation" },
  { id: "CITATION_REPORTED", re: CITATION_REPORTED, fieldPath: "citations.reported", baseConf: 0.85, label: "Reported citation" },
  { id: "CASE_NUMBER", re: CASE_NUMBER, fieldPath: "caseNumber", baseConf: 0.8, label: "Case number" },
  { id: "DIARY_NO", re: DIARY_NO, fieldPath: "diaryNumber", baseConf: 0.88, label: "Diary number" },
  { id: "FIR_NO", re: FIR_NO, fieldPath: "fir.number", baseConf: 0.9, label: "FIR number" },
  { id: "POLICE_STATION", re: POLICE_STATION, fieldPath: "fir.policeStation", baseConf: 0.8, label: "Police station" },
  { id: "CHARGESHEET_NO", re: CHARGESHEET_NO, fieldPath: "chargesheet.number", baseConf: 0.85, label: "Charge sheet number" },
  { id: "GD_ENTRY", re: GD_ENTRY, fieldPath: "fir.gdEntry", baseConf: 0.8, label: "GD entry" },
  { id: "SECTION_BLOCK", re: SECTION_BLOCK, fieldPath: "sections", baseConf: 0.88, label: "Statutory sections" },
  { id: "ARTICLE", re: ARTICLE, fieldPath: "articles", baseConf: 0.85, label: "Constitutional article" },
  { id: "ORDER_RULE", re: ORDER_RULE, fieldPath: "orderRules", baseConf: 0.82, label: "Order and Rule" },
  { id: "ACT_NUMBER", re: ACT_NUMBER, fieldPath: "acts", baseConf: 0.85, label: "Act number" },
  { id: "ACT_NUMBER_PAREN", re: ACT_NUMBER_PAREN, fieldPath: "acts", baseConf: 0.8, label: "Act number (parenthetical)" },
  { id: "NOTIFICATION", re: NOTIFICATION, fieldPath: "notifications", baseConf: 0.7, label: "Notification" },
  { id: "MONEY", re: MONEY, fieldPath: "amounts", baseConf: 0.85, label: "Amount" },
  { id: "AADHAAR", re: AADHAAR, fieldPath: "ids.aadhaar", baseConf: 0.75, sensitive: true, label: "Aadhaar" },
  { id: "PAN", re: PAN, fieldPath: "ids.pan", baseConf: 0.9, label: "PAN" },
  { id: "GSTIN", re: GSTIN, fieldPath: "ids.gstin", baseConf: 0.92, label: "GSTIN" },
  { id: "CIN", re: CIN, fieldPath: "ids.cin", baseConf: 0.92, label: "CIN" },
  { id: "DIN", re: DIN, fieldPath: "ids.din", baseConf: 0.88, label: "DIN" },
  { id: "TAN", re: TAN, fieldPath: "ids.tan", baseConf: 0.85, label: "TAN" },
  { id: "EPIC", re: EPIC, fieldPath: "ids.epic", baseConf: 0.7, label: "Voter ID" },
  { id: "PASSPORT", re: PASSPORT, fieldPath: "ids.passport", baseConf: 0.65, label: "Passport" },
  { id: "DRIVING_LICENCE", re: DRIVING_LICENCE, fieldPath: "ids.drivingLicence", baseConf: 0.8, label: "Driving licence" },
  { id: "BAR_ENROLMENT", re: BAR_ENROLMENT, fieldPath: "advocates.enrolmentNo", baseConf: 0.7, label: "Bar enrolment" },
  { id: "IFSC", re: IFSC, fieldPath: "bank.ifsc", baseConf: 0.92, label: "IFSC" },
  { id: "CHEQUE_NO", re: CHEQUE_NO, fieldPath: "instrument.chequeNo", baseConf: 0.88, label: "Cheque number" },
  { id: "MICR", re: MICR, fieldPath: "bank.micr", baseConf: 0.88, label: "MICR" },
  { id: "ACCOUNT_NO", re: ACCOUNT_NO, fieldPath: "bank.accountNo", baseConf: 0.82, sensitive: true, label: "Account number" },
  { id: "DISHONOUR_REASON", re: DISHONOUR_REASON, fieldPath: "instrument.dishonourReason", baseConf: 0.9, label: "Dishonour reason" },
  { id: "SURVEY_NO", re: SURVEY_NO, fieldPath: "property.surveyNo", baseConf: 0.75, label: "Survey number" },
  { id: "REG_DOC_NO", re: REG_DOC_NO, fieldPath: "property.registrationNo", baseConf: 0.85, label: "Registration number" },
  { id: "VEHICLE_REG", re: VEHICLE_REG, fieldPath: "vehicle.registrationNo", baseConf: 0.7, label: "Vehicle registration" },
  { id: "PHONE_IN", re: PHONE_IN, fieldPath: "contacts.phone", baseConf: 0.8, label: "Mobile" },
  { id: "EMAIL", re: EMAIL, fieldPath: "contacts.email", baseConf: 0.9, label: "Email" },
  { id: "RELATION", re: RELATION, fieldPath: "parties.relation", baseConf: 0.8, label: "Relation" },
  { id: "AGE", re: AGE, fieldPath: "parties.age", baseConf: 0.75, label: "Age" },
  { id: "COURT_NAME", re: COURT_NAME, fieldPath: "court.raw", baseConf: 0.8, label: "Court" },
  { id: "CORAM", re: CORAM, fieldPath: "coram", baseConf: 0.8, label: "Coram" },
  { id: "DISPOSITION", re: DISPOSITION, fieldPath: "disposition", baseConf: 0.85, label: "Disposition" },
];

/** Reset a global regex before reuse. `lastIndex` leakage is a real bug source. */
export function freshRegex(re: RegExp): RegExp {
  return new RegExp(re.source, re.flags);
}
