/**
 * Party, advocate and witness extraction.
 *
 * This is the hardest extraction in the system and the one with the highest cost
 * of error, because getting a party's ROLE wrong inverts the case. So the design
 * is conservative: a person is only assigned a role when there is positional or
 * lexical evidence for it, and an unassigned person is emitted with role UNKNOWN
 * rather than guessed into a side.
 *
 * FOUR STRUCTURES that parties appear in, all of which occur in one bundle:
 *
 *  1. CAUSE TITLE — two blocks separated by "Versus", with role labels on the
 *     right ("... Appellant", "... Respondent"). Roles come from the labels; when
 *     the labels are missing, from position relative to "Versus".
 *
 *  2. NUMBERED ARRAY — the FIR / charge sheet style: "A-1 Name, S/o …, aged …,
 *     R/o …". Role comes from the serial prefix (A = accused, R = respondent,
 *     PW = prosecution witness, DW = defence witness).
 *
 *  3. DEED PARTIES — "BETWEEN … hereinafter the VENDOR … AND … hereinafter the
 *     PURCHASER". Role comes from the "hereinafter" designation.
 *
 *  4. NARRATIVE MENTION — "the complainant states that the accused persons …".
 *     These are references, not party records, and must NOT create new people.
 *
 * The engine handles 1-3 and deliberately ignores 4.
 */

import type { Advocate, Candidate, Page, Person, PartyRole } from "../types.js";
import { bboxUnion } from "../types.js";
import * as P from "../grammar/patterns.js";
import { prepare } from "../grammar/script.js";

// ---------------------------------------------------------------------------
// Role vocabulary
// ---------------------------------------------------------------------------

const ROLE_LABELS: Array<{ re: RegExp; role: PartyRole }> = [
  { re: /\bappellants?\b/i, role: "APPELLANT" },
  { re: /\brespondents?\b/i, role: "RESPONDENT" },
  { re: /\bpetitioners?\b/i, role: "PETITIONER" },
  { re: /\bplaintiffs?\b/i, role: "PLAINTIFF" },
  { re: /\bdefendants?\b/i, role: "DEFENDANT" },
  { re: /\bcomplainants?\b/i, role: "COMPLAINANT" },
  { re: /\baccused\b/i, role: "ACCUSED" },
  { re: /\bapplicants?\b/i, role: "APPLICANT" },
  { re: /\bopposite\s+part(?:y|ies)\b/i, role: "OPPOSITE_PARTY" },
  { re: /\bdecree\s*-?\s*holders?\b/i, role: "DECREE_HOLDER" },
  { re: /\bjudg(?:e)?ment\s*-?\s*debtors?\b/i, role: "JUDGEMENT_DEBTOR" },
  { re: /\binformants?\b/i, role: "INFORMANT" },
  { re: /\bvictims?\b/i, role: "VICTIM" },
  { re: /\bwitness(?:es)?\b/i, role: "WITNESS" },
  { re: /\bsuret(?:y|ies)\b/i, role: "SURETY" },
  { re: /\bintervener\b/i, role: "INTERVENER" },
  { re: /\bamicus\b/i, role: "AMICUS" },
  { re: /\bclaimants?\b/i, role: "APPLICANT" },
  // Deed roles map onto the generic transactional pair.
  { re: /\bvendors?\b|\bsellers?\b|\blessors?\b|\bassignors?\b|\bdonors?\b/i, role: "PLAINTIFF" },
  { re: /\bpurchasers?\b|\bbuyers?\b|\blessees?\b|\bassignees?\b|\bdonees?\b/i, role: "DEFENDANT" },
];

const SERIAL_ROLE: Record<string, PartyRole> = {
  A: "ACCUSED", R: "RESPONDENT", P: "PETITIONER", D: "DEFENDANT",
  PW: "WITNESS", DW: "WITNESS", CW: "WITNESS", OP: "OPPOSITE_PARTY",
};

const WORD_ROLE: Record<string, PartyRole> = {
  accused: "ACCUSED", respondent: "RESPONDENT", petitioner: "PETITIONER",
  appellant: "APPELLANT", plaintiff: "PLAINTIFF", defendant: "DEFENDANT",
  complainant: "COMPLAINANT", applicant: "APPLICANT", witness: "WITNESS",
};

function roleFromLabel(text: string): PartyRole | null {
  for (const { re, role } of ROLE_LABELS) if (re.test(text)) return role;
  return null;
}

/** The counterpart role, used when only one side is labelled. */
export function opposingRole(r: PartyRole): PartyRole {
  const pairs: Partial<Record<PartyRole, PartyRole>> = {
    APPELLANT: "RESPONDENT", RESPONDENT: "APPELLANT",
    PETITIONER: "RESPONDENT", PLAINTIFF: "DEFENDANT", DEFENDANT: "PLAINTIFF",
    COMPLAINANT: "ACCUSED", ACCUSED: "COMPLAINANT",
    APPLICANT: "OPPOSITE_PARTY", OPPOSITE_PARTY: "APPLICANT",
    DECREE_HOLDER: "JUDGEMENT_DEBTOR", JUDGEMENT_DEBTOR: "DECREE_HOLDER",
  };
  return pairs[r] ?? "UNKNOWN";
}

// ---------------------------------------------------------------------------
// Name hygiene
// ---------------------------------------------------------------------------

const HONORIFICS = /^(?:Sri|Shri|Smt\.?|Mr\.?|Mrs\.?|Ms\.?|Dr\.?|Prof\.?|M\/s\.?|Late\s+Sri|Late\s+Smt\.?|Late|Kum\.?|Master)\s+/i;

/** Words that mean the token is not a name at all. */
const NOT_A_NAME = new RegExp(
  "^(?:the|and|versus|vs|state|union|through|hereinafter|whereas|address|" +
  "aged|about|years|occupation|nationality|resident|residing|son|daughter|wife|" +
  "husband|father|mother|no|number|date|place|police|station|district|" +
  "petitioner|respondent|appellant|plaintiff|defendant|complainant|accused|" +
  "applicant|witness|advocate|counsel|court|judge|justice|honble|hon)$",
  "i",
);

export function cleanName(raw: string): string {
  let s = prepare(raw).text;
  s = s.replace(/[,;.]+$/, "").trim();
  // Strip a trailing role label that ran into the name.
  s = s.replace(/\s*[.…]{2,}\s*(?:Appellant|Respondent|Petitioner|Plaintiff|Defendant|Complainant|Accused|Applicant)s?\s*$/i, "");
  s = s.replace(/\s*\.\.\.\s*.*$/, "");
  s = s.replace(/\s{2,}/g, " ").trim();
  return s;
}

/**
 * Is this plausibly a person or entity name?
 *
 * Deliberately strict. A false name in the party array is worse than a missing
 * one: the advocate has to notice and delete it, whereas a missing party is an
 * obvious gap they will fill.
 */
export function looksLikeName(s: string): boolean {
  const t = cleanName(s).replace(HONORIFICS, "");
  if (t.length < 3 || t.length > 90) return false;
  if (/^\d/.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length > 8) return false;
  if (words.every((w) => NOT_A_NAME.test(w.replace(/[^A-Za-z]/g, "")))) return false;
  // At least one capitalised or Indic word.
  return words.some((w) => /^[A-Z]/.test(w) || /[ऀ-෿]/.test(w));
}

function entityTypeOf(name: string): Person["entityType"] {
  if (/\b(?:Pvt\.?\s*Ltd|Private\s+Limited|Ltd\.?|Limited|Inc\.?|Corp\.?|Corporation)\b/i.test(name)) return "COMPANY";
  if (/\bLLP\b|\bL\.L\.P\b/i.test(name)) return "COMPANY";
  if (/^M\/s\.?\s/i.test(name) || /\b(?:Enterprises?|Traders?|Industries|& Co\.?|and Company)\b/i.test(name)) return "FIRM";
  if (/\bTrust\b/i.test(name)) return "TRUST";
  if (/\b(?:Society|Sangh|Samiti|Association)\b/i.test(name)) return "SOCIETY";
  if (/\bHUF\b/i.test(name)) return "HUF";
  if (/^(?:State|Union\s+of\s+India|Govt\.?|Government)\b/i.test(name) ||
      /\b(?:Municipal\s+Corporation|Nigam|Board|Authority)\b/i.test(name)) return "GOVERNMENT";
  return "INDIVIDUAL";
}

// ---------------------------------------------------------------------------
// Structure 1: cause title
// ---------------------------------------------------------------------------

export interface CauseTitle {
  leftNames: string[];
  rightNames: string[];
  leftRole: PartyRole;
  rightRole: PartyRole;
  versusLineIndex: number;
  conf: number;
}

/**
 * Parse the cause title.
 *
 * Anchored on "Versus". Names above it are one side, below it the other, bounded
 * by the surrounding structure — we stop going up at a court name or a case
 * number, and down at "CORAM", a heading, or a numbered paragraph, because those
 * mark the end of the title block.
 */
export function parseCauseTitle(page: Page): CauseTitle | null {
  const versusIdx = page.lines.findIndex((l) => {
    const re = P.freshRegex(P.VERSUS);
    return re.test(l.text) && l.text.trim().length < 40;
  });
  if (versusIdx < 0) return null;

  const STOP_UP = /IN\s+THE|BEFORE\s+THE|COURT\s+OF|JURISDICTION|No\.\s*\d|CNR|Neutral\s+Citation|^\s*$/i;
  const STOP_DOWN = /^\s*(?:CORAM|BEFORE|JUDG(?:E)?MENT|ORDER|MOST\s+RESPECTFULLY|\d{1,2}[.)]\s|Reserved\s+on|Pronounced\s+on)/i;

  const left: string[] = [];
  for (let i = versusIdx - 1; i >= 0 && versusIdx - i <= 8; i--) {
    const t = page.lines[i]!.text.trim();
    if (t.length === 0) { if (left.length > 0) break; else continue; }
    if (STOP_UP.test(t)) break;
    left.unshift(t);
  }

  const right: string[] = [];
  for (let i = versusIdx + 1; i < page.lines.length && i - versusIdx <= 8; i++) {
    const t = page.lines[i]!.text.trim();
    if (t.length === 0) { if (right.length > 0) break; else continue; }
    if (STOP_DOWN.test(t)) break;
    right.push(t);
  }

  const extract = (block: string[]): { names: string[]; role: PartyRole | null } => {
    const role = roleFromLabel(block.join(" "));
    const names: string[] = [];
    for (const line of block) {
      // "Through: Mr X, Advocate" is counsel, not a party.
      if (/^\s*(?:Through|For\s+the)\b/i.test(line)) continue;
      const n = cleanName(line);
      if (looksLikeName(n)) names.push(n);
    }
    return { names, role };
  };

  const l = extract(left);
  const r = extract(right);
  if (l.names.length === 0 && r.names.length === 0) return null;

  // Role inference. If exactly one side is labelled, the other is its counterpart
  // — that is a safe inference in an adversarial title. If neither is labelled we
  // leave both UNKNOWN rather than assuming the conventional order, because the
  // conventional order is not universal (criminal appeals by the State invert it).
  let leftRole = l.role ?? "UNKNOWN";
  let rightRole = r.role ?? "UNKNOWN";
  if (l.role && !r.role) rightRole = opposingRole(l.role);
  if (!l.role && r.role) leftRole = opposingRole(r.role);

  const bothLabelled = Boolean(l.role && r.role);
  return {
    leftNames: l.names,
    rightNames: r.names,
    leftRole,
    rightRole,
    versusLineIndex: versusIdx,
    conf: bothLabelled ? 0.92 : (l.role || r.role) ? 0.8 : 0.55,
  };
}

// ---------------------------------------------------------------------------
// Structure 2: numbered party array
// ---------------------------------------------------------------------------

export interface ArrayParty extends Person {
  lineIndices: number[];
  pageNo: number;
  conf: number;
}

/**
 * Parse a numbered party array.
 *
 * Each entry may run over several lines, so an entry begins at a serial marker
 * and continues until the next serial marker or a blank/heading line. Attributes
 * (relation, age, address, phone, ids) are then pulled from the entry's joined text.
 */
export function parsePartyArray(page: Page): ArrayParty[] {
  const out: ArrayParty[] = [];
  const serialRe = /^\s*(?:(A|R|P|D|PW|DW|CW|OP)\s*[-–]\s*(\d{1,3})|(Accused|Respondent|Petitioner|Appellant|Plaintiff|Defendant|Complainant|Applicant|Witness)\s*(?:No\.?)?\s*(\d{1,3}))\s*[.):]?\s*/i;

  let entry: { serial: string; role: PartyRole; lines: string[]; indices: number[] } | null = null;
  const flush = () => {
    if (!entry) return;
    const text = entry.lines.join(" ");
    const person = personFromText(text, entry.role);
    if (person && looksLikeName(person.name)) {
      out.push({ ...person, serial: entry.serial, lineIndices: entry.indices, pageNo: page.pageNo, conf: 0.85 });
    }
    entry = null;
  };

  for (const line of page.lines) {
    const m = serialRe.exec(line.text);
    if (m) {
      flush();
      const prefix = (m[1] ?? "").toUpperCase();
      const word = (m[3] ?? "").toLowerCase();
      const num = m[2] ?? m[4] ?? "";
      const role = prefix ? (SERIAL_ROLE[prefix] ?? "UNKNOWN") : (WORD_ROLE[word] ?? "UNKNOWN");
      const serial = prefix ? `${prefix}-${num}` : `${m[3]} ${num}`;
      entry = { serial, role, lines: [line.text.slice(m[0].length)], indices: [line.index] };
      continue;
    }
    if (entry) {
      const t = line.text.trim();
      // A continuation line is indented or begins mid-sentence. A heading or a
      // new numbered form field ends the entry.
      if (t.length === 0 || /^\s*\d{1,2}[.)]\s+[A-Z]/.test(t) || /^[A-Z][A-Z\s]{6,}$/.test(t)) {
        flush();
      } else {
        entry.lines.push(t);
        entry.indices.push(line.index);
      }
    }
  }
  flush();
  return out;
}

/** Pull a Person out of a block of text about one person. */
export function personFromText(text: string, role: PartyRole): Person | null {
  const { text: t } = prepare(text);

  // Name: the leading run before the first attribute marker.
  const cut = /\b(?:S\/o|D\/o|W\/o|C\/o|H\/o|son\s+of|daughter\s+of|wife\s+of|aged?|age|R\/o|resident|residing|Occupation|Mobile|Ph|Email|through)\b/i.exec(t);
  const namePart = cut ? t.slice(0, cut.index) : t.split(/[,;]/)[0] ?? t;
  const name = cleanName(namePart);
  if (!looksLikeName(name)) return null;

  const person: Person = {
    name,
    role,
    phones: [],
    emails: [],
    ids: [],
    entityType: entityTypeOf(name),
  };

  const rel = P.freshRegex(P.RELATION).exec(t);
  if (rel) {
    const kind = (rel[1] ?? "").toLowerCase();
    const type =
      /^s\/o|son/.test(kind) ? "S/O" :
      /^d\/o|daughter/.test(kind) ? "D/O" :
      /^w\/o|wife/.test(kind) ? "W/O" :
      /^h\/o|husband/.test(kind) ? "H/O" : "C/O";
    const relName = cleanName(rel[2] ?? "");
    if (looksLikeName(relName)) person.relation = { type: type as never, name: relName };
  }

  const age = P.freshRegex(P.AGE).exec(t);
  if (age) {
    const n = Number(age[1]);
    // A plausibility band. "aged 250 years" is an OCR error, not a party.
    if (n >= 1 && n <= 120) person.age = n;
  }

  const occ = /\bOccupation\s*[:\-]?\s*([A-Za-zऀ-෿ ]{3,40})/i.exec(t);
  if (occ) person.occupation = occ[1]!.trim();

  const addr = /\b(?:R\/o|resident\s+of|residing\s+at|Address\s*[:\-]?)\s*(.{6,140}?)(?=\s*(?:Mobile|Ph\.?|Email|Aadhaar|PAN|$))/i.exec(t);
  if (addr) person.address = addr[1]!.replace(/[,.\s]+$/, "").trim();

  for (const m of matchAll(P.PHONE_IN, t)) if (m[1]) person.phones.push(m[1]);
  for (const m of matchAll(P.EMAIL, t)) if (m[1]) person.emails.push(m[1]);

  // Identity numbers. Aadhaar is captured but flagged for masking — see
  // governance/redact.ts, which is what actually masks it before persistence.
  for (const m of matchAll(P.AADHAAR, t)) {
    person.ids.push({ kind: "AADHAAR", value: `${m[1]}${m[2]}${m[3]}`, masked: false });
  }
  for (const m of matchAll(P.PAN, t)) person.ids.push({ kind: "PAN", value: m[1]!, masked: false });
  for (const m of matchAll(P.CIN, t)) person.ids.push({ kind: "CIN", value: m[1]!, masked: false });
  for (const m of matchAll(P.GSTIN, t)) person.ids.push({ kind: "GSTIN", value: m[1]!, masked: false });
  for (const m of matchAll(P.DIN, t)) person.ids.push({ kind: "DIN", value: m[1]!, masked: false });

  const gender =
    person.relation?.type === "W/O" ? "F" :
    /^(?:Smt\.?|Mrs\.?|Ms\.?|Kum\.?)\s/i.test(cleanName(namePart)) ? "F" :
    /^(?:Sri|Shri|Mr\.?)\s/i.test(cleanName(namePart)) ? "M" : undefined;
  if (gender) person.gender = gender;

  return person;
}

function matchAll(re: RegExp, s: string): RegExpExecArray[] {
  const r = P.freshRegex(re);
  const out: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = r.exec(s)) !== null) {
    if (m[0].length === 0) { r.lastIndex++; continue; }
    out.push(m);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Structure 3: deed parties
// ---------------------------------------------------------------------------

/**
 * Parse "BETWEEN … hereinafter … AND … hereinafter …".
 *
 * The "hereinafter" designation is the authoritative role in a deed, and it is
 * explicit, so this is the most reliable party structure of the three.
 */
export function parseDeedParties(page: Page): ArrayParty[] {
  const text = page.lines.map((l) => l.text).join("\n");
  const out: ArrayParty[] = [];

  const re = /(?:^|\n)\s*(?:BETWEEN|AND)\s*\n([\s\S]{10,600}?)(?:hereinafter(?:\s+(?:called|referred\s+to\s+as|the))?\s*[:\-]?\s*(?:the\s+)?["'“]?([A-Z][A-Za-z\s]{2,30}?)["'”]?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const block = m[1] ?? "";
    const designation = (m[2] ?? "").trim();
    const role = roleFromLabel(designation) ?? "UNKNOWN";
    const person = personFromText(block.replace(/\n/g, " "), role);
    if (person && looksLikeName(person.name)) {
      const lineIdx = page.lines.findIndex((l) => person.name.startsWith(l.text.trim().slice(0, 12)) || l.text.includes(person.name.slice(0, 15)));
      out.push({
        ...person,
        lineIndices: lineIdx >= 0 ? [lineIdx] : [],
        pageNo: page.pageNo,
        conf: 0.9,
        notes: undefined as never,
      } as ArrayParty);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Advocates
// ---------------------------------------------------------------------------

/**
 * Extract advocates.
 *
 * Counsel lines are distinctive: they follow "Through:", "For the Respondent:",
 * or end with "Advocate" / "Senior Advocate" / "AOR", and they frequently carry
 * an enrolment number. We attach the appearing-for role from the preceding label
 * where one exists.
 */
export function parseAdvocates(page: Page): Array<Advocate & { lineIndices: number[]; conf: number }> {
  const out: Array<Advocate & { lineIndices: number[]; conf: number }> = [];
  const APPEAR_LABEL = /^\s*(?:Through|For\s+the\s+(Appellant|Respondent|Petitioner|Plaintiff|Defendant|Complainant|Accused|Applicant|State)s?)\s*[:\-]/i;
  const COUNSEL_CUE = /\b(?:Advocate|Adv\.|Counsel|Senior\s+Advocate|A\.?O\.?R\.?|Additional\s+Public\s+Prosecutor|Public\s+Prosecutor|Government\s+Pleader|Standing\s+Counsel|Amicus\s+Curiae)\b/i;

  let currentFor: PartyRole | undefined;

  for (const line of page.lines) {
    const lab = APPEAR_LABEL.exec(line.text);
    if (lab) {
      currentFor = lab[1] ? (roleFromLabel(lab[1]) ?? undefined) : currentFor;
      const rest = line.text.slice(lab[0].length).trim();
      if (rest.length > 0 && COUNSEL_CUE.test(rest + " Advocate")) {
        pushAdvocate(out, rest, currentFor, line.index);
      }
      continue;
    }
    if (COUNSEL_CUE.test(line.text)) {
      pushAdvocate(out, line.text, currentFor, line.index);
    }
  }
  return out;
}

function pushAdvocate(
  out: Array<Advocate & { lineIndices: number[]; conf: number }>,
  text: string,
  appearingFor: PartyRole | undefined,
  lineIndex: number,
): void {
  const { text: t } = prepare(text);

  const designation: Advocate["designation"] =
    /\bSenior\s+Advocate\b/i.test(t) ? "SENIOR_ADVOCATE" :
    /\bA\.?O\.?R\.?\b/i.test(t) ? "AOR" :
    /\b(?:Additional\s+)?Public\s+Prosecutor\b/i.test(t) ? "PUBLIC_PROSECUTOR" :
    /\bGovernment\s+Pleader\b/i.test(t) ? "GOVERNMENT_PLEADER" :
    /\bAmicus\b/i.test(t) ? "AMICUS" : "ADVOCATE";

  // Names in a counsel line: honorific-led, or the run before "Advocate".
  const names: string[] = [];
  for (const m of matchAll(P.HONORIFIC_NAME, t)) {
    const n = cleanName(m[2] ?? "");
    if (looksLikeName(n)) names.push(n);
  }
  if (names.length === 0) {
    const before = /^(.{3,60}?),?\s*(?:Senior\s+)?Advocate\b/i.exec(t);
    if (before) {
      const n = cleanName(before[1]!);
      if (looksLikeName(n)) names.push(n);
    }
  }
  if (names.length === 0) return;

  const enr = P.freshRegex(P.BAR_ENROLMENT).exec(t);
  const phones = matchAll(P.PHONE_IN, t).map((m) => m[1]!).filter(Boolean);
  const emails = matchAll(P.EMAIL, t).map((m) => m[1]!).filter(Boolean);

  for (const name of names) {
    if (out.some((a) => a.name === name)) continue;
    out.push({
      name,
      designation,
      ...(enr?.[1] ? { enrolmentNo: enr[1] } : {}),
      ...(appearingFor ? { appearingFor } : {}),
      phones,
      emails,
      lineIndices: [lineIndex],
      conf: enr ? 0.9 : 0.78,
    });
  }
}

// ---------------------------------------------------------------------------
// Candidate emission
// ---------------------------------------------------------------------------

/**
 * Run every party structure over a document and emit candidates.
 *
 * Deduplication is by normalised name plus role. Two structures naming the same
 * person (a cause title and a party array) should produce one party with the
 * higher confidence, not two — and dropping the duplicate silently would lose the
 * corroboration, so the surviving candidate records that it was seen twice.
 */
export function extractParties(
  pages: Page[],
  documentId: string,
  docTypeCode: string,
  authorityWeight: number,
): { candidates: Candidate[]; persons: Person[]; advocates: Advocate[] } {
  const candidates: Candidate[] = [];
  const byKey = new Map<string, { person: Person; conf: number; pageNo: number; lineIndices: number[]; sources: string[] }>();
  const advocates: Advocate[] = [];

  for (const page of pages) {
    // Cause title
    const ct = parseCauseTitle(page);
    if (ct) {
      const add = (names: string[], role: PartyRole) => {
        names.forEach((n, i) => {
          const p = personFromText(n, role) ?? { name: cleanName(n), role, phones: [], emails: [], ids: [], entityType: entityTypeOf(n) };
          upsert(byKey, p, ct.conf, page.pageNo, [ct.versusLineIndex], `causeTitle[${i}]`);
        });
      };
      add(ct.leftNames, ct.leftRole);
      add(ct.rightNames, ct.rightRole);
    }

    // Numbered array
    for (const ap of parsePartyArray(page)) {
      upsert(byKey, ap, ap.conf, page.pageNo, ap.lineIndices, `array[${ap.serial}]`);
    }

    // Deed parties
    if (docTypeCode === "SALE_DEED" || docTypeCode === "AGREEMENT_TO_SELL" ||
        docTypeCode === "LEASE_DEED" || docTypeCode === "AGREEMENT" ||
        docTypeCode === "POWER_OF_ATTORNEY" || docTypeCode === "PARTNERSHIP_DEED") {
      for (const dp of parseDeedParties(page)) {
        upsert(byKey, dp, dp.conf, page.pageNo, dp.lineIndices, "deed");
      }
    }

    // Advocates
    for (const a of parseAdvocates(page)) {
      if (advocates.some((x) => x.name === a.name)) continue;
      advocates.push(a);
      candidates.push({
        fieldPath: `advocates[${advocates.length - 1}].name`,
        valueRaw: a.name,
        valueNormalized: a.name,
        confidence: a.conf,
        extractorId: "parties:advocates",
        extractorKind: "ANCHOR",
        aiInvolved: false,
        documentId,
        pageNo: page.pageNo,
        bbox: page.lines[a.lineIndices[0] ?? 0]?.bbox ?? null,
        lineIndices: a.lineIndices,
        authorityWeight,
        notes: [`designation=${a.designation}`, a.enrolmentNo ? `enrolment=${a.enrolmentNo}` : "no enrolment number found"],
      });
    }
  }

  const persons: Person[] = [];
  let idx = 0;
  for (const entry of byKey.values()) {
    persons.push(entry.person);
    const bbox = entry.lineIndices.length > 0
      ? pages.find((p) => p.pageNo === entry.pageNo)?.lines
          .filter((l) => entry.lineIndices.includes(l.index))
          .reduce<null | typeof pages[0]["lines"][0]["bbox"]>((acc, l) => acc ? bboxUnion(acc, l.bbox) : { ...l.bbox }, null) ?? null
      : null;

    // Corroboration bonus: a party found by two independent structures is more
    // certain than one found by either alone.
    const corroborated = entry.sources.length > 1;
    candidates.push({
      fieldPath: `parties[${idx}].name`,
      valueRaw: entry.person.name,
      valueNormalized: entry.person.name,
      confidence: Math.min(0.97, corroborated ? entry.conf * 1.08 : entry.conf),
      extractorId: "parties:structure",
      extractorKind: "ANCHOR",
      aiInvolved: false,
      documentId,
      pageNo: entry.pageNo,
      bbox,
      lineIndices: entry.lineIndices,
      authorityWeight,
      notes: [`role=${entry.person.role}`, `sources=${entry.sources.join("|")}`],
    });
    candidates.push({
      fieldPath: `parties[${idx}].role`,
      valueRaw: entry.person.role,
      valueNormalized: entry.person.role,
      // Role confidence is capped below name confidence on purpose. Reading a
      // name off a page is easier than knowing which side it is on, and an
      // over-confident role is the error that inverts a case.
      confidence: Math.min(0.9, entry.conf * (entry.person.role === "UNKNOWN" ? 0.4 : 0.95)),
      extractorId: "parties:structure",
      extractorKind: "ANCHOR",
      aiInvolved: false,
      documentId,
      pageNo: entry.pageNo,
      bbox,
      lineIndices: entry.lineIndices,
      authorityWeight,
      notes: [`sources=${entry.sources.join("|")}`],
    });
    idx++;
  }

  return { candidates, persons, advocates };
}

function upsert(
  map: Map<string, { person: Person; conf: number; pageNo: number; lineIndices: number[]; sources: string[] }>,
  person: Person,
  conf: number,
  pageNo: number,
  lineIndices: number[],
  source: string,
): void {
  const key = `${normaliseKey(person.name)}|${person.role}`;
  const existing = map.get(key);
  if (!existing) {
    map.set(key, { person, conf, pageNo, lineIndices, sources: [source] });
    return;
  }
  existing.sources.push(source);
  existing.conf = Math.max(existing.conf, conf);
  // Merge attributes — a cause title gives the name, the party array gives the
  // address and age. Neither alone is complete.
  const t = existing.person;
  t.relation ??= person.relation;
  t.age ??= person.age;
  t.gender ??= person.gender;
  t.occupation ??= person.occupation;
  t.address ??= person.address;
  t.serial ??= person.serial;
  for (const p of person.phones) if (!t.phones.includes(p)) t.phones.push(p);
  for (const e of person.emails) if (!t.emails.includes(e)) t.emails.push(e);
  for (const i of person.ids) if (!t.ids.some((x) => x.kind === i.kind && x.value === i.value)) t.ids.push(i);
}

function normaliseKey(name: string): string {
  return cleanName(name).replace(HONORIFICS, "").toLowerCase().replace(/[^a-zऀ-෿]/g, "");
}
