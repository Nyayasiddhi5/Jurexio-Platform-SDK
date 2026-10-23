/**
 * Statutory section parsing and the 2023 recodification concordance.
 *
 * Two jobs:
 *
 *  1. Split a section run — "302, 307 r/w 34 IPC" — into structured sections
 *     with subsections. The separators in real pleadings are heterogeneous
 *     (comma, "and", "&", "/", "r/w", "read with") and the section tokens carry
 *     letter suffixes (376AB) and bracketed subsections (4(1)(a)).
 *
 *  2. Annotate each section with its post-2023 successor, where one exists.
 *
 * ON THE CONCORDANCE — read this before trusting it.
 *
 * The IPC→BNS, CrPC→BNSS and IEA→BSA mappings below are an ANNOTATION LAYER, not
 * a substitution. Three hard rules follow from that, and they are enforced in code:
 *
 *   a. The section as pleaded is always the primary value. The successor is
 *      attached as `successor`, never written over `section`. An advocate who
 *      pleaded 498A IPC pleaded 498A IPC; the system does not silently restate
 *      their pleading.
 *   b. Every mapping carries a `verification` status. Only VERIFIED mappings are
 *      surfaced without a caveat. SECONDARY renders with "verify"; UNVERIFIED and
 *      CONTESTED do not auto-display at all.
 *   c. Many IPC provisions did not map one-to-one. Some were split across several
 *      BNS sections, some were merged, some were omitted outright (IPC 377, IPC
 *      309). Those are recorded as OMITTED or SPLIT and must never produce a
 *      single confident successor.
 *
 * The concordance requires SME sign-off before it drives anything a court sees.
 * `CONCORDANCE_STATUS` below is the gate.
 */

import type { StatuteSection } from "../types.js";
import { prepare } from "./script.js";
import { SECTION_BLOCK, freshRegex } from "./patterns.js";

/**
 * Set to "SIGNED_OFF" only after a qualified advocate has reviewed the table.
 * While DRAFT, `mapSuccessor()` returns VERIFIED entries only and every consumer
 * must render them as advisory.
 */
export const CONCORDANCE_STATUS: "DRAFT" | "SIGNED_OFF" = "DRAFT";

// ---------------------------------------------------------------------------
// Statute canonicalisation
// ---------------------------------------------------------------------------

interface StatuteDef { code: string; label: string; aliases: RegExp }

const STATUTES: StatuteDef[] = [
  { code: "IPC", label: "Indian Penal Code, 1860", aliases: /^(IPC|I\.P\.C\.?|Indian\s+Penal\s+Code)$/i },
  { code: "BNS", label: "Bharatiya Nyaya Sanhita, 2023", aliases: /^(BNS|Bharatiya\s+Nyaya\s+Sanhita)$/i },
  { code: "CRPC", label: "Code of Criminal Procedure, 1973", aliases: /^(CrPC|Cr\.?P\.?C\.?|Code\s+of\s+Criminal\s+Procedure)$/i },
  { code: "BNSS", label: "Bharatiya Nagarik Suraksha Sanhita, 2023", aliases: /^(BNSS|Bharatiya\s+Nagarik\s+Suraksha\s+Sanhita)$/i },
  { code: "IEA", label: "Indian Evidence Act, 1872", aliases: /^(IEA|Indian\s+Evidence\s+Act)$/i },
  { code: "BSA", label: "Bharatiya Sakshya Adhiniyam, 2023", aliases: /^(BSA|Bharatiya\s+Sakshya\s+Adhiniyam)$/i },
  { code: "CPC", label: "Code of Civil Procedure, 1908", aliases: /^(CPC|C\.?P\.?C\.?|Code\s+of\s+Civil\s+Procedure)$/i },
  { code: "NI_ACT", label: "Negotiable Instruments Act, 1881", aliases: /^(NI\s*Act|N\.?I\.?\s*Act|Negotiable\s+Instruments\s+Act)$/i },
  { code: "NDPS", label: "Narcotic Drugs and Psychotropic Substances Act, 1985", aliases: /^NDPS$/i },
  { code: "POCSO", label: "Protection of Children from Sexual Offences Act, 2012", aliases: /^POCSO$/i },
  { code: "JJ_ACT", label: "Juvenile Justice (Care and Protection of Children) Act, 2015", aliases: /^JJ\s*Act$/i },
  { code: "MV_ACT", label: "Motor Vehicles Act, 1988", aliases: /^(MV\s*Act|Motor\s+Vehicles\s+Act)$/i },
  { code: "IBC", label: "Insolvency and Bankruptcy Code, 2016", aliases: /^(IBC|Insolvency\s+and\s+Bankruptcy\s+Code)$/i },
  { code: "COMPANIES_ACT", label: "Companies Act, 2013", aliases: /^Companies\s+Act$/i },
  { code: "IT_ACT", label: "Information Technology Act, 2000", aliases: /^(IT\s*Act|Information\s+Technology\s+Act)$/i },
  { code: "INCOME_TAX", label: "Income Tax Act, 1961", aliases: /^Income\s+Tax\s+Act$/i },
  { code: "GST", label: "Goods and Services Tax Acts", aliases: /^(GST\s*Act|CGST\s*Act|SGST\s*Act)$/i },
  { code: "CUSTOMS", label: "Customs Act, 1962", aliases: /^Customs\s+Act$/i },
  { code: "PMLA", label: "Prevention of Money Laundering Act, 2002", aliases: /^PMLA$/i },
  { code: "UAPA", label: "Unlawful Activities (Prevention) Act, 1967", aliases: /^UAPA$/i },
  { code: "SC_ST_ACT", label: "SC and ST (Prevention of Atrocities) Act, 1989", aliases: /^SC\/ST\s*Act$/i },
  { code: "DV_ACT", label: "Protection of Women from Domestic Violence Act, 2005", aliases: /^(DV\s*Act|Domestic\s+Violence\s+Act)$/i },
  { code: "HMA", label: "Hindu Marriage Act, 1955", aliases: /^(HMA|Hindu\s+Marriage\s+Act)$/i },
  { code: "SMA", label: "Special Marriage Act, 1954", aliases: /^Special\s+Marriage\s+Act$/i },
  { code: "RERA", label: "Real Estate (Regulation and Development) Act, 2016", aliases: /^RERA$/i },
  { code: "CPA", label: "Consumer Protection Act, 2019", aliases: /^(CPA|Consumer\s+Protection\s+Act)$/i },
  { code: "ARB_ACT", label: "Arbitration and Conciliation Act, 1996", aliases: /^Arbitration\s+and\s+Conciliation\s+Act$/i },
  { code: "TPA", label: "Transfer of Property Act, 1882", aliases: /^(TPA|Transfer\s+of\s+Property\s+Act)$/i },
  { code: "SRA", label: "Specific Relief Act, 1963", aliases: /^Specific\s+Relief\s+Act$/i },
  { code: "LIMITATION", label: "Limitation Act, 1963", aliases: /^Limitation\s+Act$/i },
  { code: "CONTRACT_ACT", label: "Indian Contract Act, 1872", aliases: /^Contract\s+Act$/i },
  { code: "SARFAESI", label: "SARFAESI Act, 2002", aliases: /^SARFAESI$/i },
  { code: "RDDBFI", label: "Recovery of Debts and Bankruptcy Act, 1993", aliases: /^RDDBFI$/i },
  { code: "PC_ACT", label: "Prevention of Corruption Act, 1988", aliases: /^(PC\s*Act|Prevention\s+of\s+Corruption\s+Act)$/i },
  { code: "CONSTITUTION", label: "Constitution of India", aliases: /^Constitution(\s+of\s+India)?$/i },
];

export function canonicalStatute(raw: string): { code: string; label: string } {
  const s = raw.replace(/\s+/g, " ").trim();
  for (const st of STATUTES) {
    if (st.aliases.test(s)) return { code: st.code, label: st.label };
  }
  return { code: s.toUpperCase().replace(/[^A-Z0-9]+/g, "_"), label: s };
}

// ---------------------------------------------------------------------------
// Section run splitting
// ---------------------------------------------------------------------------

/**
 * A single section token: digits, optional letter suffix, optional bracketed
 * subsections. Anchored to the whole token so "302X" does not parse as "302".
 */
const SECTION_TOKEN = /^(\d{1,4})([A-Z]{0,3})((?:\(\s*[0-9a-zA-Z]{1,4}\s*\))*)$/;

export function parseSectionToken(token: string): { section: string; subsections: string[] } | null {
  const t = token.replace(/\s+/g, "");
  const m = SECTION_TOKEN.exec(t);
  if (!m) return null;
  const subs: string[] = [];
  const subRe = /\(\s*([0-9a-zA-Z]{1,4})\s*\)/g;
  let sm: RegExpExecArray | null;
  while ((sm = subRe.exec(m[3] ?? "")) !== null) subs.push(sm[1]!);
  return { section: `${m[1]}${m[2] ?? ""}`, subsections: subs };
}

/** Split a captured section run into tokens, tolerating every separator seen. */
export function splitSectionRun(run: string): string[] {
  return run
    .replace(/\bread\s+with\b/gi, ",")
    .replace(/\br\/w\b/gi, ",")
    .replace(/\band\b/gi, ",")
    .replace(/&/g, ",")
    .replace(/\//g, ",")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface SectionMatch extends StatuteSection {
  index: number;
  length: number;
}

/** Find every section run in text and expand it into individual sections. */
export function findSections(input: string): SectionMatch[] {
  const { text } = prepare(input);
  const re = freshRegex(SECTION_BLOCK);
  const out: SectionMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const run = m[1] ?? "";
    const statuteRaw = m[2] ?? "";
    const { code, label } = canonicalStatute(statuteRaw);
    for (const tok of splitSectionRun(run)) {
      const parsed = parseSectionToken(tok);
      if (!parsed) continue;
      const successor = mapSuccessor(code, parsed.section);
      out.push({
        section: parsed.section,
        subsections: parsed.subsections,
        statute: code,
        statuteLabel: label,
        raw: `${tok} ${statuteRaw}`.trim(),
        index: m.index,
        length: m[0].length,
        ...(successor ? { successor } : {}),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2023 recodification concordance
// ---------------------------------------------------------------------------

export type MappingVerification = "VERIFIED" | "SECONDARY" | "UNVERIFIED" | "CONTESTED";
export type MappingKind = "ONE_TO_ONE" | "SPLIT" | "MERGED" | "OMITTED" | "RENUMBERED";

export interface ConcordanceEntry {
  from: { statute: string; section: string };
  /** Absent for OMITTED. Multiple for SPLIT. */
  to: Array<{ statute: string; section: string }>;
  kind: MappingKind;
  verification: MappingVerification;
  note?: string;
}

/**
 * IPC → BNS. Effective 1 July 2024 for offences committed on or after that date;
 * IPC continues to govern earlier offences, so BOTH statutes are live for years.
 * That is precisely why this is an annotation and not a replacement.
 */
export const IPC_BNS: ConcordanceEntry[] = [
  { from: { statute: "IPC", section: "34" }, to: [{ statute: "BNS", section: "3(5)" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Acts done by several persons in furtherance of common intention" },
  { from: { statute: "IPC", section: "120B" }, to: [{ statute: "BNS", section: "61(2)" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Criminal conspiracy" },
  { from: { statute: "IPC", section: "141" }, to: [{ statute: "BNS", section: "189(1)" }], kind: "RENUMBERED", verification: "SECONDARY" },
  { from: { statute: "IPC", section: "143" }, to: [{ statute: "BNS", section: "189(2)" }], kind: "RENUMBERED", verification: "SECONDARY" },
  { from: { statute: "IPC", section: "147" }, to: [{ statute: "BNS", section: "191(2)" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Rioting" },
  { from: { statute: "IPC", section: "148" }, to: [{ statute: "BNS", section: "191(3)" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Rioting, armed with deadly weapon" },
  { from: { statute: "IPC", section: "149" }, to: [{ statute: "BNS", section: "190" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Vicarious liability of unlawful assembly" },
  { from: { statute: "IPC", section: "153A" }, to: [{ statute: "BNS", section: "196" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Promoting enmity between groups" },
  { from: { statute: "IPC", section: "201" }, to: [{ statute: "BNS", section: "238" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Causing disappearance of evidence" },
  { from: { statute: "IPC", section: "279" }, to: [{ statute: "BNS", section: "281" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Rash driving on a public way" },
  { from: { statute: "IPC", section: "299" }, to: [{ statute: "BNS", section: "100" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Culpable homicide, definition" },
  { from: { statute: "IPC", section: "300" }, to: [{ statute: "BNS", section: "101" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Murder, definition" },
  { from: { statute: "IPC", section: "302" }, to: [{ statute: "BNS", section: "103(1)" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Punishment for murder" },
  { from: { statute: "IPC", section: "304" }, to: [{ statute: "BNS", section: "105" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Culpable homicide not amounting to murder" },
  { from: { statute: "IPC", section: "304A" }, to: [{ statute: "BNS", section: "106(1)" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Death by negligence" },
  { from: { statute: "IPC", section: "304B" }, to: [{ statute: "BNS", section: "80" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Dowry death" },
  { from: { statute: "IPC", section: "306" }, to: [{ statute: "BNS", section: "108" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Abetment of suicide" },
  { from: { statute: "IPC", section: "307" }, to: [{ statute: "BNS", section: "109" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Attempt to murder" },
  { from: { statute: "IPC", section: "309" }, to: [], kind: "OMITTED", verification: "SECONDARY", note: "Attempt to commit suicide has no BNS equivalent; see Mental Healthcare Act 2017 s.115" },
  { from: { statute: "IPC", section: "319" }, to: [{ statute: "BNS", section: "114" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Hurt, definition" },
  { from: { statute: "IPC", section: "323" }, to: [{ statute: "BNS", section: "115(2)" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Voluntarily causing hurt" },
  { from: { statute: "IPC", section: "324" }, to: [{ statute: "BNS", section: "118(1)" }], kind: "RENUMBERED", verification: "SECONDARY" },
  { from: { statute: "IPC", section: "325" }, to: [{ statute: "BNS", section: "117(2)" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Grievous hurt" },
  { from: { statute: "IPC", section: "326" }, to: [{ statute: "BNS", section: "118(2)" }], kind: "RENUMBERED", verification: "SECONDARY" },
  { from: { statute: "IPC", section: "337" }, to: [{ statute: "BNS", section: "125(a)" }], kind: "RENUMBERED", verification: "UNVERIFIED" },
  { from: { statute: "IPC", section: "338" }, to: [{ statute: "BNS", section: "125(b)" }], kind: "RENUMBERED", verification: "UNVERIFIED" },
  { from: { statute: "IPC", section: "354" }, to: [{ statute: "BNS", section: "74" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Assault to outrage modesty" },
  { from: { statute: "IPC", section: "354A" }, to: [{ statute: "BNS", section: "75" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Sexual harassment" },
  { from: { statute: "IPC", section: "354B" }, to: [{ statute: "BNS", section: "76" }], kind: "RENUMBERED", verification: "SECONDARY" },
  { from: { statute: "IPC", section: "354C" }, to: [{ statute: "BNS", section: "77" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Voyeurism" },
  { from: { statute: "IPC", section: "354D" }, to: [{ statute: "BNS", section: "78" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Stalking" },
  { from: { statute: "IPC", section: "363" }, to: [{ statute: "BNS", section: "137(2)" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Kidnapping" },
  { from: { statute: "IPC", section: "366" }, to: [{ statute: "BNS", section: "87" }], kind: "RENUMBERED", verification: "SECONDARY" },
  { from: { statute: "IPC", section: "376" }, to: [{ statute: "BNS", section: "64" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Rape" },
  { from: { statute: "IPC", section: "376A" }, to: [{ statute: "BNS", section: "66" }], kind: "RENUMBERED", verification: "SECONDARY" },
  { from: { statute: "IPC", section: "376AB" }, to: [{ statute: "BNS", section: "65(2)" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Rape of a woman under twelve" },
  { from: { statute: "IPC", section: "376D" }, to: [{ statute: "BNS", section: "70(1)" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Gang rape" },
  { from: { statute: "IPC", section: "377" }, to: [], kind: "OMITTED", verification: "CONTESTED", note: "No BNS equivalent enacted. The omission and its effect on non-consensual acts against adult men and on bestiality is actively litigated — do not assert a successor" },
  { from: { statute: "IPC", section: "379" }, to: [{ statute: "BNS", section: "303(2)" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Theft" },
  { from: { statute: "IPC", section: "380" }, to: [{ statute: "BNS", section: "305" }], kind: "RENUMBERED", verification: "SECONDARY" },
  { from: { statute: "IPC", section: "384" }, to: [{ statute: "BNS", section: "308(2)" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Extortion" },
  { from: { statute: "IPC", section: "392" }, to: [{ statute: "BNS", section: "309(4)" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Robbery" },
  { from: { statute: "IPC", section: "395" }, to: [{ statute: "BNS", section: "310(2)" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Dacoity" },
  { from: { statute: "IPC", section: "406" }, to: [{ statute: "BNS", section: "316(2)" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Criminal breach of trust" },
  { from: { statute: "IPC", section: "409" }, to: [{ statute: "BNS", section: "316(5)" }], kind: "RENUMBERED", verification: "SECONDARY" },
  { from: { statute: "IPC", section: "411" }, to: [{ statute: "BNS", section: "317(2)" }], kind: "RENUMBERED", verification: "SECONDARY" },
  { from: { statute: "IPC", section: "415" }, to: [{ statute: "BNS", section: "318(1)" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Cheating, definition" },
  { from: { statute: "IPC", section: "420" }, to: [{ statute: "BNS", section: "318(4)" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Cheating and dishonestly inducing delivery of property" },
  { from: { statute: "IPC", section: "425" }, to: [{ statute: "BNS", section: "324(1)" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Mischief" },
  { from: { statute: "IPC", section: "441" }, to: [{ statute: "BNS", section: "329(1)" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Criminal trespass" },
  { from: { statute: "IPC", section: "447" }, to: [{ statute: "BNS", section: "329(3)" }], kind: "RENUMBERED", verification: "UNVERIFIED" },
  { from: { statute: "IPC", section: "463" }, to: [{ statute: "BNS", section: "335" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Forgery" },
  { from: { statute: "IPC", section: "465" }, to: [{ statute: "BNS", section: "336(2)" }], kind: "RENUMBERED", verification: "SECONDARY" },
  { from: { statute: "IPC", section: "468" }, to: [{ statute: "BNS", section: "336(3)" }], kind: "RENUMBERED", verification: "SECONDARY" },
  { from: { statute: "IPC", section: "471" }, to: [{ statute: "BNS", section: "340(2)" }], kind: "RENUMBERED", verification: "SECONDARY" },
  { from: { statute: "IPC", section: "494" }, to: [{ statute: "BNS", section: "82(1)" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Bigamy" },
  { from: { statute: "IPC", section: "498A" }, to: [{ statute: "BNS", section: "85" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Cruelty by husband or his relatives" },
  { from: { statute: "IPC", section: "499" }, to: [{ statute: "BNS", section: "356(1)" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Defamation, definition" },
  { from: { statute: "IPC", section: "500" }, to: [{ statute: "BNS", section: "356(2)" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Punishment for defamation" },
  { from: { statute: "IPC", section: "503" }, to: [{ statute: "BNS", section: "351(1)" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Criminal intimidation" },
  { from: { statute: "IPC", section: "506" }, to: [{ statute: "BNS", section: "351(2)" }], kind: "RENUMBERED", verification: "SECONDARY" },
  { from: { statute: "IPC", section: "509" }, to: [{ statute: "BNS", section: "79" }], kind: "RENUMBERED", verification: "SECONDARY" },
  { from: { statute: "IPC", section: "511" }, to: [{ statute: "BNS", section: "62" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Attempt to commit offences" },
];

/** CrPC → BNSS. The procedural provisions advocates cite daily. */
export const CRPC_BNSS: ConcordanceEntry[] = [
  { from: { statute: "CRPC", section: "41" }, to: [{ statute: "BNSS", section: "35" }], kind: "RENUMBERED", verification: "VERIFIED", note: "When police may arrest without warrant" },
  { from: { statute: "CRPC", section: "41A" }, to: [{ statute: "BNSS", section: "35(3)" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Notice of appearance" },
  { from: { statute: "CRPC", section: "82" }, to: [{ statute: "BNSS", section: "84" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Proclamation for person absconding" },
  { from: { statute: "CRPC", section: "83" }, to: [{ statute: "BNSS", section: "85" }], kind: "RENUMBERED", verification: "SECONDARY" },
  { from: { statute: "CRPC", section: "91" }, to: [{ statute: "BNSS", section: "94" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Summons to produce document" },
  { from: { statute: "CRPC", section: "125" }, to: [{ statute: "BNSS", section: "144" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Maintenance of wife, children and parents" },
  { from: { statute: "CRPC", section: "133" }, to: [{ statute: "BNSS", section: "152" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Conditional order for removal of nuisance" },
  { from: { statute: "CRPC", section: "144" }, to: [{ statute: "BNSS", section: "163" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Power to issue order in urgent cases of nuisance or apprehended danger" },
  { from: { statute: "CRPC", section: "154" }, to: [{ statute: "BNSS", section: "173" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Information in cognizable cases (FIR)" },
  { from: { statute: "CRPC", section: "156" }, to: [{ statute: "BNSS", section: "175" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Police officer's power to investigate; 156(3) → 175(3)" },
  { from: { statute: "CRPC", section: "161" }, to: [{ statute: "BNSS", section: "180" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Examination of witnesses by police" },
  { from: { statute: "CRPC", section: "164" }, to: [{ statute: "BNSS", section: "183" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Recording of confessions and statements" },
  { from: { statute: "CRPC", section: "167" }, to: [{ statute: "BNSS", section: "187" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Procedure when investigation cannot be completed in 24 hours; default bail" },
  { from: { statute: "CRPC", section: "173" }, to: [{ statute: "BNSS", section: "193" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Police report on completion of investigation" },
  { from: { statute: "CRPC", section: "174" }, to: [{ statute: "BNSS", section: "194" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Inquest" },
  { from: { statute: "CRPC", section: "190" }, to: [{ statute: "BNSS", section: "210" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Cognizance of offences by Magistrates" },
  { from: { statute: "CRPC", section: "200" }, to: [{ statute: "BNSS", section: "223" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Examination of complainant" },
  { from: { statute: "CRPC", section: "202" }, to: [{ statute: "BNSS", section: "225" }], kind: "RENUMBERED", verification: "SECONDARY" },
  { from: { statute: "CRPC", section: "204" }, to: [{ statute: "BNSS", section: "227" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Issue of process" },
  { from: { statute: "CRPC", section: "207" }, to: [{ statute: "BNSS", section: "230" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Supply of copies to accused" },
  { from: { statute: "CRPC", section: "227" }, to: [{ statute: "BNSS", section: "250" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Discharge" },
  { from: { statute: "CRPC", section: "239" }, to: [{ statute: "BNSS", section: "262" }], kind: "RENUMBERED", verification: "SECONDARY" },
  { from: { statute: "CRPC", section: "313" }, to: [{ statute: "BNSS", section: "351" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Power to examine the accused" },
  { from: { statute: "CRPC", section: "320" }, to: [{ statute: "BNSS", section: "359" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Compounding of offences" },
  { from: { statute: "CRPC", section: "340" }, to: [{ statute: "BNSS", section: "379" }], kind: "RENUMBERED", verification: "SECONDARY" },
  { from: { statute: "CRPC", section: "357" }, to: [{ statute: "BNSS", section: "395" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Order to pay compensation" },
  { from: { statute: "CRPC", section: "372" }, to: [{ statute: "BNSS", section: "413" }], kind: "RENUMBERED", verification: "SECONDARY" },
  { from: { statute: "CRPC", section: "374" }, to: [{ statute: "BNSS", section: "415" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Appeals from convictions" },
  { from: { statute: "CRPC", section: "378" }, to: [{ statute: "BNSS", section: "419" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Appeal in case of acquittal" },
  { from: { statute: "CRPC", section: "397" }, to: [{ statute: "BNSS", section: "438" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Revision" },
  { from: { statute: "CRPC", section: "436" }, to: [{ statute: "BNSS", section: "478" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Bail in bailable offence" },
  { from: { statute: "CRPC", section: "436A" }, to: [{ statute: "BNSS", section: "479" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Maximum period of detention of undertrial" },
  { from: { statute: "CRPC", section: "437" }, to: [{ statute: "BNSS", section: "480" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Bail in non-bailable offence" },
  { from: { statute: "CRPC", section: "438" }, to: [{ statute: "BNSS", section: "482" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Anticipatory bail" },
  { from: { statute: "CRPC", section: "439" }, to: [{ statute: "BNSS", section: "483" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Special powers of High Court and Sessions Court on bail" },
  { from: { statute: "CRPC", section: "451" }, to: [{ statute: "BNSS", section: "497" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Custody of property pending trial" },
  { from: { statute: "CRPC", section: "457" }, to: [{ statute: "BNSS", section: "503" }], kind: "RENUMBERED", verification: "SECONDARY" },
  { from: { statute: "CRPC", section: "482" }, to: [{ statute: "BNSS", section: "528" }], kind: "RENUMBERED", verification: "VERIFIED", note: "Inherent powers of the High Court" },
];

/** IEA → BSA. */
export const IEA_BSA: ConcordanceEntry[] = [
  { from: { statute: "IEA", section: "3" }, to: [{ statute: "BSA", section: "2" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Definitions" },
  { from: { statute: "IEA", section: "25" }, to: [{ statute: "BSA", section: "23(1)" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Confession to police officer not provable" },
  { from: { statute: "IEA", section: "27" }, to: [{ statute: "BSA", section: "23(2)" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Discovery statement" },
  { from: { statute: "IEA", section: "32" }, to: [{ statute: "BSA", section: "26" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Dying declaration and other statements by persons who cannot be called" },
  { from: { statute: "IEA", section: "45" }, to: [{ statute: "BSA", section: "39" }], kind: "RENUMBERED", verification: "SECONDARY", note: "Expert opinion" },
  { from: { statute: "IEA", section: "65B" }, to: [{ statute: "BSA", section: "63" }], kind: "MERGED", verification: "VERIFIED", note: "Electronic records. IEA 65A and 65B are consolidated into BSA 63; the certificate requirement is retained and the schedule form is new" },
  { from: { statute: "IEA", section: "106" }, to: [{ statute: "BSA", section: "109" }], kind: "RENUMBERED", verification: "UNVERIFIED" },
  { from: { statute: "IEA", section: "113A" }, to: [{ statute: "BSA", section: "116" }], kind: "RENUMBERED", verification: "UNVERIFIED" },
  { from: { statute: "IEA", section: "113B" }, to: [{ statute: "BSA", section: "117" }], kind: "RENUMBERED", verification: "UNVERIFIED", note: "Presumption as to dowry death" },
  { from: { statute: "IEA", section: "114A" }, to: [{ statute: "BSA", section: "120" }], kind: "RENUMBERED", verification: "UNVERIFIED" },
  { from: { statute: "IEA", section: "137" }, to: [{ statute: "BSA", section: "144" }], kind: "RENUMBERED", verification: "UNVERIFIED", note: "Examination-in-chief, cross-examination, re-examination" },
];

const CONCORDANCE_INDEX = new Map<string, ConcordanceEntry>();
for (const e of [...IPC_BNS, ...CRPC_BNSS, ...IEA_BSA]) {
  CONCORDANCE_INDEX.set(`${e.from.statute}:${e.from.section}`, e);
}

/**
 * Look up a successor. Returns null unless a single, unambiguous, sufficiently
 * verified mapping exists.
 *
 * The gates, in order:
 *  - OMITTED and SPLIT never return a single successor. An omitted section has no
 *    successor; a split section has several and picking one would be a guess.
 *  - While CONCORDANCE_STATUS is DRAFT, only VERIFIED entries are returned.
 *  - CONTESTED is never returned regardless of status.
 */
export function mapSuccessor(
  statute: string,
  section: string,
): { statute: string; section: string; confidence: number } | null {
  const e = CONCORDANCE_INDEX.get(`${statute}:${section}`);
  if (!e) return null;
  if (e.verification === "CONTESTED") return null;
  if (e.kind === "OMITTED" || e.kind === "SPLIT") return null;
  if (e.to.length !== 1) return null;
  if (CONCORDANCE_STATUS === "DRAFT" && e.verification !== "VERIFIED") return null;
  const target = e.to[0]!;
  const confidence =
    e.verification === "VERIFIED" ? 0.95 :
    e.verification === "SECONDARY" ? 0.75 : 0.5;
  return { statute: target.statute, section: target.section, confidence };
}

/** Full concordance record, including the ones mapSuccessor() refuses to apply. */
export function concordanceEntry(statute: string, section: string): ConcordanceEntry | null {
  return CONCORDANCE_INDEX.get(`${statute}:${section}`) ?? null;
}

/** Governance reporting: how much of the table is actually verified. */
export function concordanceStats(): Record<MappingVerification, number> & { total: number } {
  const out = { VERIFIED: 0, SECONDARY: 0, UNVERIFIED: 0, CONTESTED: 0, total: 0 };
  for (const e of CONCORDANCE_INDEX.values()) {
    out[e.verification]++;
    out.total++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Offence characteristics that drive the case shape
// ---------------------------------------------------------------------------

/**
 * Sections whose presence flips a matter to RESTRICTED handling. Identity of the
 * victim in these matters is protected by statute, so the intake proposal must
 * not surface names to unauthorised roles and must not be used for analytics.
 */
export const PROTECTED_OFFENCE_SECTIONS: Array<{ statute: string; sections: string[]; basis: string }> = [
  { statute: "POCSO", sections: ["*"], basis: "POCSO Act s.23 — disclosure of identity of the child prohibited" },
  { statute: "IPC", sections: ["376", "376A", "376AB", "376B", "376C", "376D", "376DA", "376DB", "376E", "354", "354A", "354B", "354C", "354D", "509"], basis: "IPC s.228A — disclosure of identity of victim of specified offences" },
  { statute: "BNS", sections: ["64", "65", "66", "67", "68", "69", "70", "71", "72", "74", "75", "76", "77", "78", "79"], basis: "BNS s.72 — disclosure of identity of victim of specified offences" },
  { statute: "JJ_ACT", sections: ["74"], basis: "JJ Act s.74 — no disclosure of identity of a child in conflict with law or in need of care" },
];

export function isProtectedOffence(sections: StatuteSection[]): { restricted: boolean; reasons: string[] } {
  const reasons: string[] = [];
  for (const s of sections) {
    for (const p of PROTECTED_OFFENCE_SECTIONS) {
      if (p.statute !== s.statute) continue;
      if (p.sections.includes("*") || p.sections.includes(s.section)) {
        reasons.push(`${s.statute} ${s.section}: ${p.basis}`);
      }
    }
  }
  return { restricted: reasons.length > 0, reasons: [...new Set(reasons)] };
}

/**
 * Sections that identify the matter's cause of action strongly enough to seed a
 * case type. This is a hint for the creation flow, never a determination — the
 * advocate picks the case type.
 */
export const CAUSE_OF_ACTION_HINTS: Array<{ statute: string; section: string; hint: string; forum: string }> = [
  { statute: "NI_ACT", section: "138", hint: "CHEQUE_DISHONOUR", forum: "MAGISTRATE" },
  { statute: "IPC", section: "498A", hint: "MATRIMONIAL_CRUELTY", forum: "MAGISTRATE" },
  { statute: "BNS", section: "85", hint: "MATRIMONIAL_CRUELTY", forum: "MAGISTRATE" },
  { statute: "CRPC", section: "125", hint: "MAINTENANCE", forum: "MAGISTRATE" },
  { statute: "BNSS", section: "144", hint: "MAINTENANCE", forum: "MAGISTRATE" },
  { statute: "CRPC", section: "438", hint: "ANTICIPATORY_BAIL", forum: "SESSIONS_OR_HC" },
  { statute: "BNSS", section: "482", hint: "ANTICIPATORY_BAIL", forum: "SESSIONS_OR_HC" },
  { statute: "CRPC", section: "439", hint: "REGULAR_BAIL", forum: "SESSIONS_OR_HC" },
  { statute: "BNSS", section: "483", hint: "REGULAR_BAIL", forum: "SESSIONS_OR_HC" },
  { statute: "CRPC", section: "482", hint: "QUASHING", forum: "HIGH_COURT" },
  { statute: "BNSS", section: "528", hint: "QUASHING", forum: "HIGH_COURT" },
  { statute: "HMA", section: "13", hint: "DIVORCE", forum: "FAMILY_COURT" },
  { statute: "HMA", section: "9", hint: "RESTITUTION_CONJUGAL_RIGHTS", forum: "FAMILY_COURT" },
  { statute: "DV_ACT", section: "12", hint: "DOMESTIC_VIOLENCE", forum: "MAGISTRATE" },
  { statute: "MV_ACT", section: "166", hint: "MOTOR_ACCIDENT_CLAIM", forum: "MACT" },
  { statute: "MV_ACT", section: "163A", hint: "MOTOR_ACCIDENT_CLAIM_NO_FAULT", forum: "MACT" },
  { statute: "IBC", section: "7", hint: "INSOLVENCY_FINANCIAL_CREDITOR", forum: "NCLT" },
  { statute: "IBC", section: "9", hint: "INSOLVENCY_OPERATIONAL_CREDITOR", forum: "NCLT" },
  { statute: "ARB_ACT", section: "9", hint: "ARBITRATION_INTERIM_MEASURES", forum: "COMMERCIAL_COURT_OR_HC" },
  { statute: "ARB_ACT", section: "11", hint: "ARBITRATOR_APPOINTMENT", forum: "HIGH_COURT_OR_SC" },
  { statute: "ARB_ACT", section: "34", hint: "AWARD_CHALLENGE", forum: "COMMERCIAL_COURT_OR_HC" },
  { statute: "ARB_ACT", section: "37", hint: "ARBITRATION_APPEAL", forum: "COMMERCIAL_APPELLATE" },
  { statute: "SRA", section: "10", hint: "SPECIFIC_PERFORMANCE", forum: "CIVIL_COURT" },
  { statute: "CPA", section: "35", hint: "CONSUMER_COMPLAINT", forum: "CONSUMER_COMMISSION" },
  { statute: "RERA", section: "31", hint: "RERA_COMPLAINT", forum: "RERA_AUTHORITY" },
  { statute: "SARFAESI", section: "17", hint: "SARFAESI_APPLICATION", forum: "DRT" },
  { statute: "CONSTITUTION", section: "226", hint: "WRIT_PETITION", forum: "HIGH_COURT" },
  { statute: "CONSTITUTION", section: "32", hint: "WRIT_PETITION", forum: "SUPREME_COURT" },
  { statute: "CONSTITUTION", section: "227", hint: "SUPERVISORY_JURISDICTION", forum: "HIGH_COURT" },
];

export function causeOfActionHints(sections: StatuteSection[]): Array<{ hint: string; forum: string; basis: string }> {
  const out: Array<{ hint: string; forum: string; basis: string }> = [];
  for (const s of sections) {
    for (const h of CAUSE_OF_ACTION_HINTS) {
      if (h.statute === s.statute && h.section === s.section) {
        out.push({ hint: h.hint, forum: h.forum, basis: `${s.statute} ${s.section}` });
      }
    }
  }
  return out;
}
