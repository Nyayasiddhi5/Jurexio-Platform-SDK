/**
 * Grammar pack verification.
 *
 * Every assertion here is a shape taken from a real Indian legal document. When a
 * pattern is changed, this file is the contract that says the change did not
 * quietly drop a document family.
 */

import { describe, it, expect } from "vitest";
import * as P from "../src/grammar/patterns.js";
import { prepare, profileScript, normaliseDigits, detectScript, hygiene } from "../src/grammar/script.js";
import { parseDate, findDates, expandYear, daysInMonth, addDays, daysBetween } from "../src/grammar/dates.js";
import { findMoney, wordsToNumber, crossCheckMoney, formatINR } from "../src/grammar/money.js";
import {
  findSections, parseSectionToken, splitSectionRun, canonicalStatute,
  mapSuccessor, concordanceEntry, concordanceStats, isProtectedOffence, causeOfActionHints,
} from "../src/grammar/sections.js";

/** Collect all matches of a global pattern, returning full match + groups. */
function all(re: RegExp, s: string): RegExpExecArray[] {
  const r = P.freshRegex(re);
  const out: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = r.exec(s)) !== null) {
    if (m[0].length === 0) { r.lastIndex++; continue; }
    out.push(m);
  }
  return out;
}

function first(re: RegExp, s: string): RegExpExecArray | undefined {
  return all(re, s)[0];
}

// ===========================================================================
describe("script detection", () => {
  it("identifies Latin, Devanagari, Tamil, Telugu, Bengali", () => {
    expect(detectScript("IN THE HIGH COURT OF DELHI")).toBe("Latn");
    expect(detectScript("दिल्ली उच्च न्यायालय में")).toBe("Deva");
    expect(detectScript("சென்னை உயர் நீதிமன்றம்")).toBe("Taml");
    expect(detectScript("హైదరాబాద్ హైకోర్టు")).toBe("Telu");
    expect(detectScript("কলকাতা উচ্চ আদালত")).toBe("Beng");
  });

  it("does NOT count ASCII digits or punctuation as Latin", () => {
    // This is the bug that routes a Devanagari page to the English model.
    const p = profileScript("धारा 302/34");
    expect(p.dominant).toBe("Deva");
    expect(p.counts.Latn).toBeUndefined();
  });

  it("flags genuinely bi-script lines", () => {
    const p = profileScript("प्राथमिकी संख्या FIR No. 123 of 2024 पुलिस थाना");
    expect(p.mixed).toBe(true);
    expect(p.significant).toContain("Deva");
    expect(p.significant).toContain("Latn");
  });

  it("returns Zyyy for digits-only input rather than guessing a script", () => {
    expect(detectScript("123/2024")).toBe("Zyyy");
  });
});

describe("digit normalisation", () => {
  it("folds Devanagari digits", () => {
    expect(normaliseDigits("१५/०८/२०२४").text).toBe("15/08/2024");
  });
  it("folds Bengali, Tamil, Telugu, Gujarati, Gurmukhi, Odia, Malayalam, Kannada", () => {
    expect(normaliseDigits("১২৩").text).toBe("123");
    expect(normaliseDigits("௧௨௩").text).toBe("123");
    expect(normaliseDigits("౧౨౩").text).toBe("123");
    expect(normaliseDigits("૧૨૩").text).toBe("123");
    expect(normaliseDigits("੧੨੩").text).toBe("123");
    expect(normaliseDigits("୧୨୩").text).toBe("123");
    expect(normaliseDigits("൧൨൩").text).toBe("123");
    expect(normaliseDigits("೧೨೩").text).toBe("123");
  });
  it("folds Arabic-Indic and extended Arabic-Indic (Urdu)", () => {
    expect(normaliseDigits("١٢٣").text).toBe("123");
    expect(normaliseDigits("۱۲۳").text).toBe("123");
  });
  it("reports which digit scripts were seen", () => {
    expect(normaliseDigits("१२३").digitScripts).toEqual(["Deva"]);
  });
  it("leaves ASCII digits untouched and reports no change", () => {
    const r = normaliseDigits("123");
    expect(r.text).toBe("123");
    expect(r.changed).toBe(false);
  });
});

describe("text hygiene", () => {
  it("strips zero-width characters that survive OCR of conjuncts", () => {
    expect(hygiene("क‍ष")).toBe("कष");
    expect(hygiene("a​b")).toBe("ab");
  });
  it("strips soft hyphens from line-wrapped typeset judgements", () => {
    expect(hygiene("judge­ment")).toBe("judgement");
  });
  it("normalises exotic spaces and curly quotes", () => {
    expect(hygiene("Rs. 50,000")).toBe("Rs. 50,000");
    expect(hygiene("“quoted”")).toBe('"quoted"');
  });
  it("preserves the Devanagari danda, which terminates sentences", () => {
    expect(hygiene("यह वाक्य है।")).toContain("।");
  });
});

// ===========================================================================
describe("CNR", () => {
  it("parses a full CNR into state, district, establishment, serial, year", () => {
    const m = first(P.CNR, "CNR No.: DLST010012342024");
    expect(m?.[1]).toBe("DL");
    expect(m?.[2]).toBe("ST");
    expect(m?.[3]).toBe("01");
    expect(m?.[4]).toBe("001234");
    expect(m?.[5]).toBe("2024");
  });
  it("matches CNRs across states", () => {
    for (const cnr of ["MHAU020056782023", "KAAB010000012019", "UPGB050123452021", "TNCH010098762022"]) {
      expect(first(P.CNR, cnr), cnr).toBeDefined();
    }
  });
  it("rejects a 15-character near-miss", () => {
    expect(first(P.CNR, "DLST01001234202")).toBeUndefined();
  });
});

describe("neutral citations", () => {
  it("parses Supreme Court INSC", () => {
    expect(first(P.NEUTRAL_SC, "2024 INSC 456")?.[2]).toBe("456");
    expect(first(P.NEUTRAL_SC, "2023:INSC:1102")?.[2]).toBe("1102");
  });

  it("parses plain High Court neutral citations", () => {
    const m = first(P.NEUTRAL_HC, "2024:DHC:1234");
    expect(m?.[2]).toBe("DHC");
    expect(m?.[3]).toBe("1234");
  });

  it("parses HYPHENATED bench codes — the whole Bombay family depends on it", () => {
    // Without the hyphen branch every BHC-AS / BHC-NAG / BHC-GOA citation is lost.
    const m = first(P.NEUTRAL_HC, "2024:BHC-AS:5678:DB");
    expect(m?.[2]).toBe("BHC-AS");
    expect(m?.[3]).toBe("5678");
    expect(m?.[4]).toBe("DB");
    expect(first(P.NEUTRAL_HC, "2023:BHC-NAG:991")?.[2]).toBe("BHC-NAG");
    expect(first(P.NEUTRAL_HC, "2025:BHC-OS:12")?.[2]).toBe("BHC-OS");
  });

  it("parses other High Court prefixes", () => {
    for (const [cite, code] of [
      ["2024:KER:9012", "KER"], ["2024:MHCDB:77", "MHCDB"], ["2024:AHC:4501", "AHC"],
      ["2024:PHHC:333", "PHHC"], ["2024:CGHC:120", "CGHC"], ["2024:GAU:55", "GAU"],
    ] as const) {
      expect(first(P.NEUTRAL_HC, cite)?.[2], cite).toBe(code);
    }
  });
});

describe("reported citations", () => {
  it("parses SCC-style citations with the volume number", () => {
    const m = first(P.CITATION_REPORTED, "(2024) 3 SCC 456");
    expect(m?.[1]).toBe("2024");
    expect(m?.[2]).toBe("3");     // volume
    expect(m?.[3]).toBe("SCC");
    expect(m?.[4]).toBe("456");   // page
  });

  it("parses citations without a volume number", () => {
    expect(first(P.CITATION_REPORTED, "2021 Cri LJ 998")).toBeDefined();
    expect(first(P.CITATION_REPORTED, "2018 CriLJ 45")).toBeDefined();
  });

  it("parses AIR-style citations, where the reporter comes first", () => {
    const m = first(P.CITATION_AIR, "AIR 2019 SC 1234");
    expect(m?.[1]).toBe("2019");
    expect(m?.[2]).toBe("SC");
    expect(m?.[3]).toBe("1234");
    expect(first(P.CITATION_AIR, "AIR 1973 SC 1461")).toBeDefined();
    expect(first(P.CITATION_AIR, "AIR 1995 Bom 275")).toBeDefined();
  });

  it("does not fire on a citation with no page number", () => {
    expect(first(P.CITATION_REPORTED, "2020 SCC OnLine")).toBeUndefined();
  });
});

describe("case numbers", () => {
  it("parses the dotted and bracketed type tokens Indian courts actually use", () => {
    const cases: Array<[string, string, string, string]> = [
      ["W.P.(C) No. 1234/2024", "W.P.(C)", "1234", "2024"],
      ["CRL.A. No. 567 of 2023", "CRL.A.", "567", "2023"],
      ["O.S. No. 89/2021", "O.S.", "89", "2021"],
      ["C.C. No. 4501/2024", "C.C.", "4501", "2024"],
      ["Crl.M.C. No. 77/2025", "Crl.M.C.", "77", "2025"],
      ["S.C. No. 12/2020", "S.C.", "12", "2020"],
      ["M.A.C.T. No. 340/2022", "M.A.C.T.", "340", "2022"],
      ["E.P. No. 5/2019", "E.P.", "5", "2019"],
      ["R.S.A. No. 210/2018", "R.S.A.", "210", "2018"],
    ];
    for (const [input, tok, num, yr] of cases) {
      const m = first(P.CASE_NUMBER, input);
      expect(m, input).toBeDefined();
      expect(m![1]!.replace(/\s/g, ""), input).toBe(tok);
      expect(m![2], input).toBe(num);
      expect(m![3], input).toBe(yr);
    }
  });

  it("does not fire on a bare number/year pair in prose", () => {
    // "1234/2024" alone is a date, a serial, anything. Requiring "No." is what
    // stops the candidate list flooding.
    expect(first(P.CASE_NUMBER, "the ratio in 1234/2024 applies")).toBeUndefined();
  });
});

describe("FIR", () => {
  it("parses every FIR spelling seen in the field", () => {
    const cases: Array<[string, string, string]> = [
      ["FIR No. 123/2024", "123", "2024"],
      ["F.I.R. No: 0123/24", "0123", "24"],
      ["FIR No 456 of 2023", "456", "2023"],
      ["Crime No. 45/2024", "45", "2024"],
      ["Cr. No. 45/2024", "45", "2024"],
      ["First Information Report No. 789/2022", "789", "2022"],
    ];
    for (const [input, num, yr] of cases) {
      const m = first(P.FIR_NO, input);
      expect(m, input).toBeDefined();
      expect(m![1], input).toBe(num);
      expect(m![2], input).toBe(yr);
    }
  });

  it("parses Devanagari-digit FIR numbers after normalisation", () => {
    const { text } = prepare("FIR No. १२३/२०२४");
    expect(first(P.FIR_NO, text)?.[1]).toBe("123");
  });

  it("extracts the police station name and stops at the boundary", () => {
    const m = first(P.POLICE_STATION, "P.S. Connaught Place, District New Delhi");
    expect(m?.[1]?.trim()).toBe("Connaught Place");
    const m2 = first(P.POLICE_STATION, "Police Station Saidapet, Chennai");
    expect(m2?.[1]?.trim()).toBe("Saidapet");
  });
});

// ===========================================================================
describe("statutory sections", () => {
  it("splits a section run with mixed separators", () => {
    expect(splitSectionRun("302, 307 r/w 34")).toEqual(["302", "307", "34"]);
    expect(splitSectionRun("420 and 468 & 471")).toEqual(["420", "468", "471"]);
    expect(splitSectionRun("323/324 read with 34")).toEqual(["323", "324", "34"]);
  });

  it("parses section tokens with letter suffixes and subsections", () => {
    expect(parseSectionToken("302")).toEqual({ section: "302", subsections: [] });
    expect(parseSectionToken("376AB")).toEqual({ section: "376AB", subsections: [] });
    expect(parseSectionToken("4(1)(a)")).toEqual({ section: "4", subsections: ["1", "a"] });
    expect(parseSectionToken("138")).toEqual({ section: "138", subsections: [] });
    expect(parseSectionToken("garbage")).toBeNull();
  });

  it("extracts sections with the statute across real phrasings", () => {
    const s1 = findSections("charged u/s 302, 307 r/w 34 IPC");
    expect(s1.map((s) => s.section)).toEqual(["302", "307", "34"]);
    expect(s1.every((s) => s.statute === "IPC")).toBe(true);

    const s2 = findSections("complaint under Section 138 of the NI Act");
    expect(s2[0]?.section).toBe("138");
    expect(s2[0]?.statute).toBe("NI_ACT");

    const s3 = findSections("Sections 4(1)(a) and 5 of the POCSO Act");
    expect(s3[0]?.section).toBe("4");
    expect(s3[0]?.subsections).toEqual(["1", "a"]);
    expect(s3[1]?.section).toBe("5");

    const s4 = findSections("S. 376AB IPC");
    expect(s4[0]?.section).toBe("376AB");

    const s5 = findSections("Sec. 420/34 IPC");
    expect(s5.map((s) => s.section)).toEqual(["420", "34"]);
  });

  it("canonicalises statute aliases", () => {
    expect(canonicalStatute("I.P.C.").code).toBe("IPC");
    expect(canonicalStatute("Cr.P.C.").code).toBe("CRPC");
    expect(canonicalStatute("Negotiable Instruments Act").code).toBe("NI_ACT");
    expect(canonicalStatute("Bharatiya Nyaya Sanhita").code).toBe("BNS");
  });

  it("parses constitutional articles", () => {
    const m = first(P.ARTICLE, "petition under Article 226 of the Constitution");
    expect(m?.[1]?.trim()).toBe("226");
  });

  it("parses Order and Rule of the CPC", () => {
    const m = first(P.ORDER_RULE, "application under Order VII Rule 11 CPC");
    expect(m?.[1]).toBe("VII");
    expect(m?.[2]?.trim()).toBe("11");
    const m2 = first(P.ORDER_RULE, "O. 39 R. 1 & 2 CPC");
    expect(m2?.[1]).toBe("39");
  });

  it("parses Act numbers", () => {
    const m = first(P.ACT_NUMBER, "the Indian Penal Code (Act No. 45 of 1860)");
    expect(m?.[1]).toBe("45");
    expect(m?.[2]).toBe("1860");
  });

  it("parses the parenthetical Act citation form", () => {
    // How every amending instrument cites its parent Act. The keyword-led
    // pattern cannot reach it because there is no keyword.
    const m = first(P.ACT_NUMBER_PAREN, "the Commercial Disputes Act, 2024 (18 of 2024)");
    expect(m?.[1]).toBe("18");
    expect(m?.[2]).toBe("2024");
    expect(first(P.ACT_NUMBER_PAREN, "the CGST Act, 2017 (12 of 2017)")?.[1]).toBe("12");
  });

  it("parses lower-case constitutional articles", () => {
    // "...conferred by clause (1) of article 123 of the Constitution..." — the
    // case-sensitive version found nothing in an entire Presidential Ordinance,
    // whose whole authority rests on that article.
    expect(first(P.ARTICLE, "by clause (1) of article 123 of the Constitution")?.[1]?.trim())
      .toBe("123");
    expect(first(P.ARTICLE, "under article 213")?.[1]?.trim()).toBe("213");
    // And does not fire on ordinary words beginning "art".
    expect(first(P.ARTICLE, "the artistic merit of 5 works")).toBeUndefined();
  });
});

describe("recodification concordance", () => {
  it("maps the flagship VERIFIED provisions", () => {
    expect(mapSuccessor("IPC", "302")).toMatchObject({ statute: "BNS", section: "103(1)" });
    expect(mapSuccessor("IPC", "420")).toMatchObject({ statute: "BNS", section: "318(4)" });
    expect(mapSuccessor("IPC", "498A")).toMatchObject({ statute: "BNS", section: "85" });
    expect(mapSuccessor("CRPC", "154")).toMatchObject({ statute: "BNSS", section: "173" });
    expect(mapSuccessor("CRPC", "438")).toMatchObject({ statute: "BNSS", section: "482" });
    expect(mapSuccessor("CRPC", "482")).toMatchObject({ statute: "BNSS", section: "528" });
    expect(mapSuccessor("IEA", "65B")).toMatchObject({ statute: "BSA", section: "63" });
  });

  it("refuses to invent a successor for an OMITTED section", () => {
    expect(mapSuccessor("IPC", "377")).toBeNull();
    expect(mapSuccessor("IPC", "309")).toBeNull();
    expect(concordanceEntry("IPC", "377")?.kind).toBe("OMITTED");
    expect(concordanceEntry("IPC", "377")?.verification).toBe("CONTESTED");
  });

  it("withholds SECONDARY and UNVERIFIED mappings while the table is DRAFT", () => {
    // 325→117(2) is SECONDARY; it must not auto-apply before SME sign-off.
    expect(concordanceEntry("IPC", "325")?.verification).toBe("SECONDARY");
    expect(mapSuccessor("IPC", "325")).toBeNull();
    expect(concordanceEntry("IEA", "106")?.verification).toBe("UNVERIFIED");
    expect(mapSuccessor("IEA", "106")).toBeNull();
  });

  it("never overwrites the pleaded section with its successor", () => {
    const s = findSections("u/s 302 IPC");
    expect(s[0]?.section).toBe("302");
    expect(s[0]?.statute).toBe("IPC");
    expect(s[0]?.successor?.section).toBe("103(1)");
  });

  it("reports honest verification statistics", () => {
    const st = concordanceStats();
    expect(st.total).toBeGreaterThan(100);
    expect(st.VERIFIED).toBeGreaterThan(0);
    expect(st.VERIFIED + st.SECONDARY + st.UNVERIFIED + st.CONTESTED).toBe(st.total);
    // The table is majority-unverified. If this ever flips to mostly VERIFIED
    // without an SME signing off, that is a governance failure, not progress.
    expect(st.VERIFIED).toBeLessThan(st.total);
  });
});

describe("protected offences", () => {
  it("flags POCSO, IPC 376 and BNS 64 as restricted", () => {
    expect(isProtectedOffence(findSections("u/s 4 of the POCSO Act")).restricted).toBe(true);
    expect(isProtectedOffence(findSections("u/s 376 IPC")).restricted).toBe(true);
    expect(isProtectedOffence(findSections("u/s 64 BNS")).restricted).toBe(true);
  });
  it("does not flag an ordinary theft matter", () => {
    expect(isProtectedOffence(findSections("u/s 379 IPC")).restricted).toBe(false);
  });
  it("cites the statutory basis for the restriction", () => {
    const r = isProtectedOffence(findSections("u/s 376 IPC"));
    expect(r.reasons[0]).toContain("228A");
  });
});

describe("cause of action hints", () => {
  it("maps s.138 NI Act to the cheque-dishonour flow before a Magistrate", () => {
    const h = causeOfActionHints(findSections("under Section 138 of the NI Act"));
    expect(h[0]).toMatchObject({ hint: "CHEQUE_DISHONOUR", forum: "MAGISTRATE" });
  });
  it("maps CrPC 438 to anticipatory bail", () => {
    const h = causeOfActionHints(findSections("u/s 438 CrPC"));
    expect(h[0]?.hint).toBe("ANTICIPATORY_BAIL");
  });
  it("returns nothing for a section with no mapped cause of action", () => {
    expect(causeOfActionHints(findSections("u/s 34 IPC"))).toHaveLength(0);
  });
});

// ===========================================================================
describe("dates", () => {
  it("parses DD/MM/YYYY as Indian order", () => {
    const d = parseDate("12/03/2024");
    expect(d?.iso).toBe("2024-03-12");
    expect(d?.ambiguousOrder).toBe(true); // both ≤ 12, so we chose
  });

  it("resolves the order unambiguously when a component exceeds 12", () => {
    const d = parseDate("25/03/2024");
    expect(d?.iso).toBe("2024-03-25");
    expect(d?.ambiguousOrder).toBe(false);
  });

  it("respects an explicit month-first preference", () => {
    expect(parseDate("12/03/2024", { preferMonthFirst: true })?.iso).toBe("2024-12-03");
  });

  it("parses verbal dates in both orders and the deed formula", () => {
    expect(parseDate("15th August, 2024")?.iso).toBe("2024-08-15");
    expect(parseDate("August 15, 2024")?.iso).toBe("2024-08-15");
    expect(parseDate("15th day of August, 2024")?.iso).toBe("2024-08-15");
    expect(parseDate("1 Jan 2020")?.iso).toBe("2020-01-01");
    expect(parseDate("30 Sept 2019")?.iso).toBe("2019-09-30");
  });

  it("parses Devanagari, Tamil, Telugu and Bengali month names", () => {
    expect(parseDate("१५ अगस्त २०२४")?.iso).toBe("2024-08-15");
    expect(parseDate("15 ஆகஸ்ட் 2024")?.iso).toBe("2024-08-15");
    expect(parseDate("15 ఆగస్టు 2024")?.iso).toBe("2024-08-15");
    expect(parseDate("15 আগস্ট 2024")?.iso).toBe("2024-08-15");
  });

  it("marks Saka calendar dates and does NOT emit a Gregorian ISO for them", () => {
    const d = parseDate("15 चैत्र 1946");
    expect(d?.calendar).toBe("SAKA");
    expect(d?.iso).toBeNull(); // conversion needs era context; refusing beats guessing
  });

  it("expands two-digit years around the reference year, not a fixed pivot", () => {
    expect(expandYear(24, 2026)).toBe(2024);
    expect(expandYear(97, 2026)).toBe(1997);
    expect(expandYear(30, 2026)).toBe(2030); // within +5? no — 2030 > 2031? it is not
    expect(expandYear(99, 2026)).toBe(1999);
  });

  it("refuses impossible dates instead of rolling them over", () => {
    const d = parseDate("31/02/2024");
    expect(d).not.toBeNull();
    expect(d?.iso).toBeNull();        // February has no 31st
    expect(d?.precision).toBe("UNKNOWN");
    expect(d?.d).toBe(31);            // parts kept so a human can see the problem
  });

  it("applies the correct leap rule", () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2023, 2)).toBe(28);
    expect(daysInMonth(1900, 2)).toBe(28); // century, not a leap year
    expect(daysInMonth(2000, 2)).toBe(29); // 400-year rule
    expect(parseDate("29/02/2024")?.iso).toBe("2024-02-29");
    expect(parseDate("29/02/2023")?.iso).toBeNull();
  });

  it("finds every date in a paragraph in document order", () => {
    const text = "The FIR was registered on 12.03.2024, the charge sheet filed on 15th June, 2024 and the matter is listed on 2024-09-01.";
    const found = findDates(text);
    expect(found.map((f) => f.date.iso)).toEqual(["2024-03-12", "2024-06-15", "2024-09-01"]);
  });

  it("does date arithmetic on UTC so the container's timezone cannot shift it", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2023-02-28", 1)).toBe("2023-03-01");
    expect(addDays("2024-12-31", 1)).toBe("2025-01-01");
    expect(daysBetween("2024-01-01", "2024-03-01")).toBe(60); // leap year
    expect(daysBetween("2023-01-01", "2023-03-01")).toBe(59);
  });
});

// ===========================================================================
describe("money", () => {
  it("parses Indian lakh grouping without losing digits", () => {
    // The classic failure: a Western pattern reads "1,50,000" as 150.
    const m = findMoney("Rs. 1,50,000/-")[0];
    expect(m?.amount).toBe(150000);
    expect(m?.grouping).toBe("INDIAN");
  });

  it("parses crore grouping", () => {
    expect(findMoney("₹ 12,34,56,789")[0]?.amount).toBe(123456789);
  });

  it("parses Western grouping for foreign-template documents", () => {
    const m = findMoney("Rs. 150,000")[0];
    expect(m?.amount).toBe(150000);
    expect(m?.grouping).toBe("WESTERN");
  });

  it("applies scale words", () => {
    expect(findMoney("Rs. 15 lakh")[0]?.amount).toBe(1_500_000);
    expect(findMoney("Rs. 2.5 crores")[0]?.amount).toBe(25_000_000);
    expect(findMoney("Rs. 50 thousand")[0]?.amount).toBe(50_000);
  });

  it("flags malformed grouping instead of silently accepting it", () => {
    const m = findMoney("Rs. 1,50,00")[0];
    expect(m?.grouping).toBe("MALFORMED");
  });

  it("parses paise", () => {
    expect(findMoney("Rs. 1,00,000.50")[0]?.amount).toBe(100000.5);
  });

  it("handles the ₹ symbol, Rs., INR, Rupees and Devanagari रु", () => {
    for (const s of ["₹5000", "Rs 5000", "Rs. 5000", "INR 5000", "Rupees 5000", "रु. 5000"]) {
      expect(findMoney(s)[0]?.amount, s).toBe(5000);
    }
  });

  it("converts Indian amount-in-words with segment-scale semantics", () => {
    expect(wordsToNumber("Fifteen Lakh only")).toBe(1_500_000);
    expect(wordsToNumber("Two Crore Fifteen Lakh Thirty Thousand Five Hundred")).toBe(21_530_500);
    expect(wordsToNumber("One Lakh Fifty Thousand")).toBe(150_000);
    expect(wordsToNumber("Five Hundred")).toBe(500);
    expect(wordsToNumber("Twenty Five Thousand")).toBe(25_000);
  });

  it("refuses a words amount it could not fully read", () => {
    // Partial reads are worse than no read — they look authoritative.
    expect(wordsToNumber("Fifteen Lakh and something")).toBeNull();
  });

  it("confirms figures against words when they agree", () => {
    const r = crossCheckMoney("a sum of Rs. 15,00,000/- (Rupees Fifteen Lakh only)")[0];
    expect(r?.verdict).toBe("AGREE");
    expect(r?.confidence).toBeGreaterThan(0.95);
  });

  it("raises a DISAGREE finding when figures and words differ", () => {
    // In a cheque-bounce or deed matter this discrepancy can decide the case.
    const r = crossCheckMoney("Rs. 5,00,000/- (Rupees Fifteen Lakh only)")[0];
    expect(r?.verdict).toBe("DISAGREE");
    expect(r?.confidence).toBeLessThan(0.5);
  });

  it("formats back to Indian grouping", () => {
    expect(formatINR(150000)).toBe("₹1,50,000");
    expect(formatINR(123456789)).toBe("₹12,34,56,789");
    expect(formatINR(500)).toBe("₹500");
    expect(formatINR(1000)).toBe("₹1,000");
  });
});

// ===========================================================================
describe("identity and statutory numbers", () => {
  it("finds Aadhaar in spaced and unspaced form", () => {
    expect(first(P.AADHAAR, "Aadhaar: 2345 6789 0123")).toBeDefined();
    expect(first(P.AADHAAR, "234567890123")).toBeDefined();
  });
  it("does not match an Aadhaar-shaped number starting 0 or 1", () => {
    expect(first(P.AADHAAR, "1234 5678 9012")).toBeUndefined();
  });

  it("refuses an Aadhaar-shaped WINDOW inside a longer digit run", () => {
    // A 15-digit IMEI contains a 12-digit Aadhaar-shaped substring: the IMEI
    // 351234567890123 contains 234567890123 starting at its fourth character.
    // Masking part of someone's IMEI would be a visible bug; asserting it as
    // their Aadhaar would be a worse one. Same for long account numbers.
    expect(first(P.AADHAAR, "IMEI 351234567890123")).toBeUndefined();
    expect(first(P.AADHAAR, "A/c 9234567890123456")).toBeUndefined();
    expect(first(P.AADHAAR, "23456789012345")).toBeUndefined();
    // …but a standalone 12-digit run still matches, spaced or not.
    expect(first(P.AADHAAR, "IMEI 351234 and Aadhaar 2345 6789 0123")).toBeDefined();
    expect(first(P.AADHAAR, "Aadhaar: 234567890123.")).toBeDefined();
  });
  it("validates PAN holder-type letter", () => {
    expect(first(P.PAN, "PAN: ABCPD1234E")?.[1]).toBe("ABCPD1234E");
    expect(first(P.PAN, "ABCDE1234F")).toBeUndefined(); // 4th letter D is valid...
  });
  it("finds GSTIN, CIN, TAN, DIN", () => {
    expect(first(P.GSTIN, "GSTIN: 27ABCDE1234F1Z5")?.[1]).toBe("27ABCDE1234F1Z5");
    expect(first(P.CIN, "CIN: L17110MH1973PLC019786")?.[1]).toBe("L17110MH1973PLC019786");
    expect(first(P.TAN, "TAN MUMA12345B")?.[1]).toBe("MUMA12345B");
    expect(first(P.DIN, "DIN: 00012345")?.[1]).toBe("00012345");
  });
  it("finds IFSC and requires the mandatory zero at position 5", () => {
    expect(first(P.IFSC, "IFSC: SBIN0001234")?.[1]).toBe("SBIN0001234");
    expect(first(P.IFSC, "SBIN1001234")).toBeUndefined();
  });
  it("finds a cheque number only when an instrument word is present", () => {
    expect(first(P.CHEQUE_NO, "Cheque No. 123456")?.[1]).toBe("123456");
    expect(first(P.CHEQUE_NO, "cheque bearing No. 654321")?.[1]).toBe("654321");
    expect(first(P.CHEQUE_NO, "Demand Draft No. 778899")?.[1]).toBe("778899");
    // Requiring the instrument word is deliberate. "bearing No. 654321" on its
    // own is just as likely a policy, an invoice or an exhibit number, and
    // guessing "cheque" would put a wrong figure into a s.138 complaint.
    expect(first(P.CHEQUE_NO, "bearing No. 654321")).toBeUndefined();
    expect(first(P.CHEQUE_NO, "the sum of 123456")).toBeUndefined();
  });
  it("recognises the statutory dishonour reasons that trigger s.138", () => {
    expect(first(P.DISHONOUR_REASON, "returned for insufficient funds")).toBeDefined();
    expect(first(P.DISHONOUR_REASON, "memo stating 'exceeds arrangement'")).toBeDefined();
    expect(first(P.DISHONOUR_REASON, "payment stopped by drawer")).toBeDefined();
  });
  it("finds a bar enrolment number", () => {
    expect(first(P.BAR_ENROLMENT, "Enrolment No. D/1234/2015")?.[1]).toBe("D/1234/2015");
    expect(first(P.BAR_ENROLMENT, "MAH/5678/2010")?.[1]).toBe("MAH/5678/2010");
  });
});

describe("contact details", () => {
  it("finds Indian mobiles with and without country code", () => {
    expect(first(P.PHONE_IN, "Mob: 9876543210")?.[1]).toBe("9876543210");
    expect(first(P.PHONE_IN, "+91 9876543210")?.[1]).toBe("9876543210");
    expect(first(P.PHONE_IN, "09876543210")?.[1]).toBe("9876543210");
  });
  it("does not treat a 10-digit number starting below 6 as a mobile", () => {
    expect(first(P.PHONE_IN, "1234567890")).toBeUndefined();
  });
  it("finds emails", () => {
    expect(first(P.EMAIL, "adv.sharma@lawfirm.co.in")?.[1]).toBe("adv.sharma@lawfirm.co.in");
  });
});

describe("people", () => {
  it("parses relationship markers", () => {
    const m = first(P.RELATION, "Ram Kumar S/o Late Shri Mohan Lal");
    expect(m?.[1]).toBe("S/o");
    expect(m?.[2]).toContain("Mohan Lal");
    expect(first(P.RELATION, "Sunita W/o Rajesh")?.[1]).toBe("W/o");
    expect(first(P.RELATION, "Priya daughter of Suresh Rao")?.[1]).toBe("daughter of");
  });
  it("parses age", () => {
    expect(first(P.AGE, "aged about 45 years")?.[1]).toBe("45");
    expect(first(P.AGE, "Age 32")?.[1]).toBe("32");
  });
  it("parses party serials in both notations", () => {
    expect(all(P.PARTY_SERIAL, "A-1, A-2 and R-3").length).toBe(3);
    const m = first(P.PARTY_SERIAL, "Accused No. 2");
    expect(m?.[3]).toBe("Accused");
    expect(m?.[4]).toBe("2");
    expect(first(P.PARTY_SERIAL, "PW-4")?.[1]).toBe("PW");
  });
  it("parses honorific-led names", () => {
    expect(first(P.HONORIFIC_NAME, "Shri Ramesh Chandra Gupta")?.[2]).toContain("Ramesh");
    expect(first(P.HONORIFIC_NAME, "Smt. Kamala Devi")?.[2]).toContain("Kamala");
    expect(first(P.HONORIFIC_NAME, "M/s. Sunrise Traders")?.[2]).toContain("Sunrise");
  });
  it("finds the cause-title separator in English and Indian scripts", () => {
    expect(first(P.VERSUS, "Ram Kumar Versus State of Delhi")).toBeDefined();
    expect(first(P.VERSUS, "ABC Ltd. vs. XYZ Pvt. Ltd.")).toBeDefined();
    expect(first(P.VERSUS, "राम कुमार बनाम दिल्ली राज्य")).toBeDefined();
  });
  it("recognises corporate suffixes to separate entities from natural persons", () => {
    expect(first(P.ENTITY_SUFFIX, "Sunrise Traders Pvt. Ltd.")).toBeDefined();
    expect(first(P.ENTITY_SUFFIX, "Acme LLP")).toBeDefined();
    expect(first(P.ENTITY_SUFFIX, "State Bank of India")).toBeDefined();
    expect(first(P.ENTITY_SUFFIX, "Ram Kumar")).toBeUndefined();
  });
});

describe("courts and pleading structure", () => {
  it("recognises court names across tiers", () => {
    expect(first(P.COURT_NAME, "IN THE SUPREME COURT OF INDIA")).toBeDefined();
    expect(first(P.COURT_NAME, "IN THE HIGH COURT OF DELHI AT NEW DELHI")).toBeDefined();
    expect(first(P.COURT_NAME, "In the Court of the District and Sessions Judge, Pune")).toBeDefined();
    expect(first(P.COURT_NAME, "Before the Chief Judicial Magistrate, Kanpur")).toBeDefined();
    expect(first(P.COURT_NAME, "BEFORE THE NATIONAL COMPANY LAW TRIBUNAL")).toBeDefined();
    expect(first(P.COURT_NAME, "In the Family Court at Bandra")).toBeDefined();
  });
  it("extracts the coram line", () => {
    expect(first(P.CORAM, "CORAM: HON'BLE MR. JUSTICE A K SHARMA")?.[1]).toContain("JUSTICE");
  });
  it("finds the prayer and verification clauses", () => {
    expect(first(P.PRAYER_CUE, "it is therefore most humbly prayed that")).toBeDefined();
    expect(first(P.PRAYER_CUE, "PRAYER")).toBeDefined();
    expect(first(P.VERIFICATION_CUE, "VERIFICATION")).toBeDefined();
  });
  it("reads the disposition of an order", () => {
    expect(first(P.DISPOSITION, "the appeal is allowed")?.[1]).toBe("allowed");
    expect(first(P.DISPOSITION, "The petition is dismissed")?.[1]).toBe("dismissed");
    expect(first(P.DISPOSITION, "the application is partly allowed")?.[1]).toBe("partly allowed");
  });
  it("finds clause numbers and obligation modals in contracts", () => {
    expect(first(P.CLAUSE_NO, "Clause 4.2.1 provides")?.[1]).toBe("4.2.1");
    expect(first(P.OBLIGATION_MODAL, "the Seller shall deliver")?.[1]).toBe("shall");
    expect(first(P.ARBITRATION_CUE, "referred to arbitration")).toBeDefined();
    expect(first(P.JURISDICTION_CUE, "courts at Mumbai alone shall have exclusive jurisdiction")).toBeDefined();
  });
  it("reads notice periods in digits and words", () => {
    expect(first(P.NOTICE_PERIOD, "within 30 days")?.[1]).toBe("30");
    expect(first(P.NOTICE_PERIOD, "within fifteen days")?.[1]).toBe("fifteen");
  });
});

describe("property and instruments", () => {
  it("parses survey and khasra numbers including composites", () => {
    expect(first(P.SURVEY_NO, "Survey No. 123/4")?.[1]).toBe("123/4");
    expect(first(P.SURVEY_NO, "Khasra No. 45/2/1")?.[1]).toBe("45/2/1");
    expect(first(P.SURVEY_NO, "C.T.S. No. 789")?.[1]).toBe("789");
  });
  it("parses a registered document reference", () => {
    const m = first(P.REG_DOC_NO, "Document No. 1234/2020 of Book-I");
    expect(m?.[1]).toBe("1234");
    expect(m?.[2]).toBe("2020");
  });
  it("parses vehicle registrations in spaced and unspaced form", () => {
    expect(first(P.VEHICLE_REG, "MH 12 AB 1234")?.[1]).toBe("MH 12 AB 1234");
    expect(first(P.VEHICLE_REG, "DL8CAF1234")?.[1]).toBe("DL8CAF1234");
  });
});

describe("regex hygiene", () => {
  it("every registry pattern is global, so the sweep runner cannot silently stop at one match", () => {
    for (const spec of P.PATTERN_REGISTRY) {
      expect(spec.re.flags, spec.id).toContain("g");
    }
  });
  it("freshRegex isolates lastIndex between uses", () => {
    const a = P.freshRegex(P.CNR);
    a.exec("DLST010012342024");
    const b = P.freshRegex(P.CNR);
    expect(b.exec("DLST010012342024")).not.toBeNull();
  });
  it("no registry pattern matches the empty string, which would loop forever", () => {
    for (const spec of P.PATTERN_REGISTRY) {
      const r = P.freshRegex(spec.re);
      const m = r.exec("");
      expect(m, spec.id).toBeNull();
    }
  });
  it("every registry pattern terminates quickly on adversarial input", () => {
    // Catastrophic backtracking in a section pattern would hang the ingest worker.
    const evil = "u/s " + "1".repeat(200) + "," .repeat(50) + " IPC" + "x".repeat(500);
    for (const spec of P.PATTERN_REGISTRY) {
      const t0 = performance.now();
      all(spec.re, evil);
      expect(performance.now() - t0, spec.id).toBeLessThan(250);
    }
  });
});
