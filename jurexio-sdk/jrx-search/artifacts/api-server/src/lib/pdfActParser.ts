/**
 * Parser for India Code act PDFs (Gazette-style re-typeset editions).
 *
 * Layout of these PDFs (as extracted to a single merged-page text string):
 *   [ARRANGEMENT OF SECTIONS]  — table of contents: "1. Short title. 2. ..."
 *   ACT NO. n OF yyyy          — body start marker
 *   CHAPTER I ... 1. Heading.—(1) text ... 2. Heading.—text ...
 *
 * Strategy: parse the arrangement to get the ordered (sectionNo, heading)
 * list, then locate each section's body start with a tiered, monotonically
 * advancing search (heading-prefix anchored first, then a looser
 * number-anchored fallback). Sections that never appear in the body (e.g.
 * "[Omitted.]" entries) fall back to the arrangement heading as text.
 *
 * Old PDF-only acts (mostly pre-1900) often have no arrangement at all; for
 * those the body is split directly on ascending "N. Heading" boundaries.
 */

export interface ParsedSection {
  section: string;
  heading: string;
  text: string;
  /** true when the body text could not be located and heading was used. */
  headingOnly: boolean;
}

export interface ParsedAct {
  sections: ParsedSection[];
  stats: {
    arrangementEntries: number;
    matchedInBody: number;
    headingOnly: number;
    mode: "arrangement" | "body-scan";
  };
}

const SECTION_NO = String.raw`\d+[A-Z]{0,4}`;
/** Footnote-marker digits and/or an opening bracket between "N." and the
 * heading (e.g. "10AA.3[Special provisions…", "80K. [Deduction…"). */
const GAP = String.raw`\s*\d{0,2}\s*\[?\s*`;
const MAX_HEADING_LEN = 300;

function escRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Heading prefix -> whitespace/curly-quote tolerant regex source. */
function fuzz(s: string): string {
  return escRe(s)
    .replace(/\s+/g, String.raw`\s+`)
    .replace(/[\u201C\u201D\u2018\u2019'"]/g, ".");
}

/** Find the English PDF bitstream path on an India Code act browse page.
 * English bitstreams are conventionally aYYYY-NN.pdf (Hindi ones
 * HYYYY-NN.pdf); otherwise the lexically first path is used. */
export function pickPdfPath(html: string, handle: string): string | null {
  const links = [...html.matchAll(/href="?(\/bitstream\/[^"'> ]+\.pdf)/gi)].map(
    (m) => m[1],
  );
  if (links.length === 0) return null;
  const own = links.filter((l) => l.includes(`/bitstream/${handle}/`));
  const candidates = own.length > 0 ? own : links;
  const english = candidates.find((l) => {
    const file = l.slice(l.lastIndexOf("/") + 1);
    return /^a/i.test(file) && !/^h/i.test(file);
  });
  return english ?? [...candidates].sort()[0];
}

interface ArrangementEntry {
  section: string;
  heading: string;
}

export function parseArrangement(arrangementText: string): ArrangementEntry[] {
  const entryRe = new RegExp(
    String.raw`(?:^|\s)(${SECTION_NO})\.\s+(.+?)\.(?=\s+(?:${SECTION_NO}\.\s|CHAPTER\s|THE\s+FIRST\s+SCHEDULE|SCHEDULE|PART\s+[A-Z]))`,
    "g",
  );
  const entries: ArrangementEntry[] = [];
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(arrangementText)) !== null) {
    const heading = m[2].replace(/\s+/g, " ").trim();
    if (heading.length <= MAX_HEADING_LEN) {
      entries.push({ section: m[1], heading });
    }
  }
  // dedupe by section number, keeping the first occurrence
  const seen = new Set<string>();
  return entries.filter((e) =>
    seen.has(e.section) ? false : (seen.add(e.section), true),
  );
}

function cleanSectionText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** Split body text using the ordered arrangement entries. */
function splitByArrangement(
  body: string,
  entries: ArrangementEntry[],
): { sections: ParsedSection[]; matched: number } {
  interface Located extends ArrangementEntry {
    start: number | null;
  }
  const located: Located[] = [];
  let prev = 0;
  let matched = 0;
  for (const e of entries) {
    let start: number | null = null;
    for (const plen of [30, 12]) {
      const re = new RegExp(
        String.raw`\b${escRe(e.section)}\.${GAP}${fuzz(e.heading.slice(0, plen))}`,
        "ig",
      );
      re.lastIndex = prev;
      const m = re.exec(body);
      if (m) {
        start = m.index;
        break;
      }
    }
    if (start === null && !/omitted|repealed/i.test(e.heading)) {
      // looser fallback: number followed by a capitalized/bracketed heading
      // start, but only within a bounded window past the previous section so
      // cross-references far ahead don't derail the ordering.
      const re = new RegExp(
        String.raw`[\s\[]${escRe(e.section)}\.${GAP}[A-Z\u201C\u2018]`,
        "g",
      );
      re.lastIndex = prev;
      const m = re.exec(body);
      if (m && m.index - prev < 150_000) start = m.index;
    }
    if (start !== null) {
      located.push({ ...e, start });
      prev = start + 3;
      matched++;
    } else {
      located.push({ ...e, start: null });
    }
  }

  const sections: ParsedSection[] = [];
  for (let i = 0; i < located.length; i++) {
    const cur = located[i];
    if (cur.start === null) {
      sections.push({
        section: cur.section,
        heading: cur.heading,
        text: cur.heading,
        headingOnly: true,
      });
      continue;
    }
    let j = i + 1;
    while (j < located.length && located[j].start === null) j++;
    const end = j < located.length ? (located[j].start as number) : body.length;
    const text = cleanSectionText(body.slice(cur.start, end));
    sections.push({
      section: cur.section,
      heading: cur.heading,
      text: text || cur.heading,
      headingOnly: text.length === 0,
    });
  }
  return { sections, matched };
}

/** Fallback for acts without an arrangement: scan the body for ascending
 * "N. Heading" boundaries (plain numeric sections only). */
function scanBody(body: string): ParsedSection[] {
  interface Hit {
    section: string;
    numeric: number;
    start: number;
    headingGuess: string;
  }
  const re = /[\s\[](\d{1,3})\.\s*\[?\s*([A-Z\u201C\u2018][^.]{0,200}?)[.\u2014]/g;
  const hits: Hit[] = [];
  let m: RegExpExecArray | null;
  let expected = 1;
  while ((m = re.exec(body)) !== null) {
    const n = parseInt(m[1], 10);
    if (n !== expected) continue;
    hits.push({
      section: m[1],
      numeric: n,
      start: m.index + 1,
      headingGuess: m[2].replace(/\s+/g, " ").trim(),
    });
    expected = n + 1;
  }
  return hits.map((h, i) => {
    const end = i + 1 < hits.length ? hits[i + 1].start : body.length;
    const text = cleanSectionText(body.slice(h.start, end));
    return {
      section: h.section,
      heading: h.headingGuess || `Section ${h.section}`,
      text: text || h.headingGuess,
      headingOnly: false,
    };
  });
}

export function parsePdfActText(fullText: string): ParsedAct {
  const arrStart = fullText.search(/ARRANGEMENT OF SECTIONS/i);
  if (arrStart >= 0) {
    const afterArr = fullText.slice(arrStart);
    const bodyRel = afterArr.search(/ACT NO\.\s*\d+/i);
    if (bodyRel > 0) {
      const arrangement = afterArr.slice(0, bodyRel);
      const body = afterArr.slice(bodyRel);
      const entries = parseArrangement(arrangement);
      if (entries.length > 0) {
        const { sections, matched } = splitByArrangement(body, entries);
        return {
          sections,
          stats: {
            arrangementEntries: entries.length,
            matchedInBody: matched,
            headingOnly: sections.filter((s) => s.headingOnly).length,
            mode: "arrangement",
          },
        };
      }
    }
  }
  const sections = scanBody(fullText);
  return {
    sections,
    stats: {
      arrangementEntries: 0,
      matchedInBody: sections.length,
      headingOnly: 0,
      mode: "body-scan",
    },
  };
}
