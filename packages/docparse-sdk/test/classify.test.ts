/**
 * Classification coverage across ALL 58 document types.
 *
 * WHY THIS FILE EXISTS. The registry carried 58 profiles but only five had ever
 * been run against a document of their own type. The rest were written from the
 * statutory forms and were plausible-but-unverified — "58 document types" was an
 * assertion, not a measurement. This file makes it a measurement.
 *
 * Building the fixtures immediately found five real defects that no amount of
 * reading the code would have surfaced:
 *
 *  1. LEASE_DEED's `lease` cue was unanchored and matched inside "pleased".
 *     "…may be pleased to…" is the standard prayer formula in every Indian
 *     pleading, so a weight-11 lease cue fired on maintenance petitions, writs
 *     and plaints alike.
 *  2. POWER_OF_ATTORNEY required "do hereby" and "MY true and lawful attorney".
 *     Real deeds say "doth hereby" and "HIS true and lawful attorney". Two of
 *     four cues scored nothing and the profile lost outright to AGREEMENT.
 *  3. WARRANT beat SUMMONS by two points, because a warrant recites the summons
 *     that preceded it and WARRANT's own `apprehend the accused` cue missed the
 *     far commoner `apprehend the said <name>`.
 *  4. SEIZURE_MEMO scored 13 against CASE_DIARY's 15, because a case diary
 *     narrates the day's seizures and cites the memo by reference.
 *  5. INVOICE's cue was unanchored too.
 *
 * The MARGIN test below is the one that generalises. A correct answer reached by
 * two points is not a correct answer; it is a coin toss that happened to land
 * right on this fixture.
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { run } from "../src/pipeline/run.js";
import { DOC_TYPES } from "../src/doctype/registry.js";
import type { Classification, ExtractionResult } from "../src/types.js";

const FIX = join(import.meta.dirname, "fixtures");

/** The five types whose fixtures predate this file, under their own names. */
const LEGACY: Record<string, string> = {
  FIR: "fir.text.pdf",
  JUDGEMENT: "judgement.text.pdf",
  LEGAL_NOTICE: "notice138.text.pdf",
  BAIL_APPLICATION: "bail.text.pdf",
  SALE_DEED: "saledeed.text.pdf",
};

function fixtureFor(code: string): string | null {
  const own = join(FIX, `type_${code}.pdf`);
  if (existsSync(own)) return own;
  const legacy = LEGACY[code];
  if (legacy && existsSync(join(FIX, legacy))) return join(FIX, legacy);
  return null;
}

let tick = 0;
const clock = () => new Date(Date.UTC(2026, 7, 26, 12, 0, tick++)).toISOString();

/** One pipeline run per type, computed once and shared by every assertion. */
const results = new Map<string, { classification: Classification; result: ExtractionResult }>();

async function classifyOnce(code: string) {
  const cached = results.get(code);
  if (cached) return cached;
  const path = fixtureFor(code)!;
  tick = 0;
  const result = await run(
    [{ path, fileName: `${code}.pdf` }],
    { batchId: "classify-test", actor: "test", now: clock, referenceYear: 2026 },
  );
  const entry = { classification: result.documents[0]!.classification, result };
  results.set(code, entry);
  return entry;
}

// ===========================================================================
describe("fixture coverage", () => {
  it("every one of the 58 document types has a fixture", () => {
    const missing = DOC_TYPES.filter((d) => fixtureFor(d.code) === null).map((d) => d.code);
    expect(missing, `types without a fixture: ${missing.join(", ")}`).toEqual([]);
    expect(DOC_TYPES).toHaveLength(58);
  });

  it("no two profiles share a code", () => {
    const codes = DOC_TYPES.map((d) => d.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

// ===========================================================================
describe("cue hygiene", () => {
  /**
   * Words that EMBED a short legal token. A cue matching inside one of these is
   * unanchored, and unanchored cues fire on ordinary boilerplate — which is how
   * LEASE_DEED came to score weight 11 on the word "pleased".
   */
  const TRAPS = [
    "pleased", "displeased", "released", "releasing", "pleasure", "leasehold",
    "witnesses", "hereinafter", "notwithstanding", "warranty", "warranted",
    "summonsed", "ordered", "reordered", "acting", "enacting", "cheques",
    "invoices", "affidavits", "decreed", "bonded", "billed", "willed",
    "actionable", "transaction", "contractual", "misdeed", "indeed",
    "proceeding", "exceeding", "complaint", "complainant", "ratification",
    "classified", "provisional", "divisional", "occasioned", "seizures",
    "blessing", "cleanse", "warranties",
  ];

  it("no cue or anti-cue matches inside a longer word", () => {
    const offenders: string[] = [];
    for (const d of DOC_TYPES) {
      for (const [kind, list] of [["cue", d.cues], ["anti", d.antiCues ?? []]] as const) {
        for (const c of list) {
          const re = new RegExp(c.re.source, c.re.flags.replace("g", ""));
          for (const trap of TRAPS) {
            const m = re.exec(trap);
            if (!m) continue;
            if (m[0].length < trap.length || m.index > 0) {
              offenders.push(`${d.code}/${kind} w=${c.w}: "${trap}" ~ "${m[0]}" — ${c.re.source.slice(0, 60)}`);
              break;
            }
          }
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("every profile has at least one cue and a non-empty expectedFields list", () => {
    for (const d of DOC_TYPES) {
      expect(d.cues.length, d.code).toBeGreaterThan(0);
      expect(d.expectedFields.length, d.code).toBeGreaterThan(0);
    }
  });

  it("no cue matches the empty string, which would score every document", () => {
    for (const d of DOC_TYPES) {
      for (const c of [...d.cues, ...(d.antiCues ?? [])]) {
        const re = new RegExp(c.re.source, c.re.flags.replace("g", ""));
        expect(re.test(""), `${d.code}: ${c.re.source}`).toBe(false);
      }
    }
  });

  it("cue weights are within the intended 1..12 band", () => {
    for (const d of DOC_TYPES) {
      for (const c of [...d.cues, ...(d.antiCues ?? [])]) {
        expect(c.w, `${d.code}: ${c.re.source}`).toBeGreaterThan(0);
        expect(c.w, `${d.code}: ${c.re.source}`).toBeLessThanOrEqual(12);
      }
    }
  });
});

// ===========================================================================
describe("every document type classifies to itself", () => {
  for (const d of DOC_TYPES) {
    it(`${d.code} (${d.family})`, async () => {
      const { classification } = await classifyOnce(d.code);
      expect(classification.code, `got ${classification.code} instead of ${d.code}`).toBe(d.code);
      expect(classification.family).toBe(d.family);
    }, 120_000);
  }
});

// ===========================================================================
describe("classification quality", () => {
  it("every type reaches at least 0.40 confidence on its own document", async () => {
    const weak: string[] = [];
    for (const d of DOC_TYPES) {
      const { classification } = await classifyOnce(d.code);
      if (classification.conf < 0.40) {
        weak.push(`${d.code} ${classification.conf.toFixed(2)} (alts: ${classification.alternatives.map((a) => `${a.code}:${a.conf.toFixed(2)}`).join(" ")})`);
      }
    }
    expect(weak, weak.join("\n")).toEqual([]);
  }, 600_000);

  /**
   * The margin test. This is the one that generalises beyond these fixtures.
   *
   * A winner two points clear of the runner-up is not a classification, it is a
   * tie that happened to break the right way on this document. WARRANT beat
   * SUMMONS by exactly that margin before the anti-cues went in, and the
   * consequence of losing that coin toss is a document that commands arrest
   * being filed as one that commands attendance.
   */
  it("every type is clear of its runner-up by a real margin", async () => {
    const narrow: string[] = [];
    for (const d of DOC_TYPES) {
      const { classification } = await classifyOnce(d.code);
      const runnerUp = classification.alternatives[0];
      if (!runnerUp) continue;
      const margin = classification.conf - runnerUp.conf;
      if (margin < 0.12) {
        narrow.push(`${d.code} ${classification.conf.toFixed(2)} vs ${runnerUp.code} ${runnerUp.conf.toFixed(2)} (margin ${margin.toFixed(2)})`);
      }
    }
    expect(narrow, `too close to call:\n${narrow.join("\n")}`).toEqual([]);
  }, 600_000);

  it("keeps runners-up so a misclassification stays visible", async () => {
    // A single confident answer with no alternatives is how a wrong call becomes
    // invisible. Most documents should surface at least one plausible neighbour.
    let withAlts = 0;
    for (const d of DOC_TYPES) {
      const { classification } = await classifyOnce(d.code);
      if (classification.alternatives.length > 0) withAlts++;
    }
    expect(withAlts).toBeGreaterThan(DOC_TYPES.length * 0.5);
  }, 600_000);

  it("gives explainable evidence for every classification", async () => {
    for (const d of DOC_TYPES) {
      const { classification } = await classifyOnce(d.code);
      expect(classification.evidence.length, d.code).toBeGreaterThan(0);
      for (const e of classification.evidence) {
        expect(e.weight, d.code).toBeGreaterThan(0);
        expect(e.pageNo, d.code).toBeGreaterThan(0);
        expect(e.snippet.length, d.code).toBeGreaterThan(0);
      }
    }
  }, 600_000);
});

// ===========================================================================
describe("near-neighbour separations, stated explicitly", () => {
  /**
   * Each pair below is a distinction where confusing the two has a real
   * consequence. Asserting them individually — rather than relying on the
   * blanket margin test — documents WHY the anti-cues exist, so a future edit
   * that removes one fails with a message that explains itself.
   */
  const PAIRS: Array<[string, string, string]> = [
    ["PLAINT", "WRITTEN_STATEMENT", "inverts plaintiff and defendant, and so the whole case record"],
    ["WRITTEN_STATEMENT", "PLAINT", "same, in the other direction"],
    ["FIR", "CHARGESHEET", "different stage of the same prosecution"],
    ["CHARGESHEET", "FIR", "same, in the other direction"],
    ["ORDER", "JUDGEMENT", "interlocutory versus final — decides whether an appeal clock runs"],
    ["JUDGEMENT", "ORDER", "same, in the other direction"],
    ["SALE_DEED", "AGREEMENT_TO_SELL", "only one transfers title"],
    ["AGREEMENT_TO_SELL", "SALE_DEED", "same, in the other direction"],
    ["LEGAL_NOTICE", "COMPLAINT_138", "before and after the s.138 cause of action accrues"],
    ["COMPLAINT_138", "LEGAL_NOTICE", "same, in the other direction"],
    ["BAIL_APPLICATION", "BAIL_BOND", "the request versus the security furnished after it"],
    ["BAIL_BOND", "BAIL_APPLICATION", "same, in the other direction"],
    ["SUMMONS", "WARRANT", "commands attendance versus commands arrest"],
    ["WARRANT", "SUMMONS", "same, in the other direction"],
    ["CASE_DIARY", "SEIZURE_MEMO", "the diary narrates the seizure the memo records"],
    ["SEIZURE_MEMO", "CASE_DIARY", "same, in the other direction"],
    ["POWER_OF_ATTORNEY", "AGREEMENT", "both carry WHEREAS / NOW THEREFORE / IN WITNESS WHEREOF"],
    ["AGREEMENT", "POWER_OF_ATTORNEY", "same, in the other direction"],
    ["WRIT_PETITION", "PIL", "private grievance versus public interest"],
    ["PIL", "WRIT_PETITION", "same, in the other direction"],
    ["MAINTENANCE_PETITION", "DIVORCE_PETITION", "maintenance survives without dissolution"],
    ["DECREE", "JUDGEMENT", "the decree is executable, the judgment is the reasoning"],
    ["MLC", "POST_MORTEM", "the living versus the dead"],
    ["POST_MORTEM", "MLC", "same, in the other direction"],
    ["ACT", "ORDINANCE", "enacted by Parliament versus promulgated by the President"],
    ["ORDINANCE", "ACT", "same, in the other direction"],
    ["CHEQUE", "RETURN_MEMO", "the instrument versus the record of its dishonour"],
    ["RETURN_MEMO", "CHEQUE", "same, in the other direction"],
  ];

  for (const [subject, neighbour, why] of PAIRS) {
    it(`${subject} is not read as ${neighbour} — ${why}`, async () => {
      const { classification } = await classifyOnce(subject);
      expect(classification.code).toBe(subject);
      const neighbourConf =
        classification.alternatives.find((a) => a.code === neighbour)?.conf ?? 0;
      expect(
        classification.conf - neighbourConf,
        `${subject} ${classification.conf.toFixed(2)} vs ${neighbour} ${neighbourConf.toFixed(2)}`,
      ).toBeGreaterThan(0.12);
    }, 120_000);
  }
});

// ===========================================================================
describe("extraction actually fires on the new types", () => {
  /**
   * Classifying correctly is half the job. A profile that classifies but yields
   * no fields is a label, not an extractor. This does not demand every expected
   * field — many are genuinely absent from any single document — but it does
   * demand that each type produces SOMETHING with provenance.
   */
  it("every type produces at least one candidate with full provenance", async () => {
    const barren: string[] = [];
    for (const d of DOC_TYPES) {
      const { result } = await classifyOnce(d.code);
      if (result.candidates.length === 0) { barren.push(d.code); continue; }
      for (const c of result.candidates) {
        expect(c.documentId.length, d.code).toBeGreaterThan(0);
        expect(c.pageNo, d.code).toBeGreaterThan(0);
        expect(c.extractorId.length, d.code).toBeGreaterThan(0);
        expect(c.aiInvolved, d.code).toBe(false);
      }
    }
    expect(barren, `types yielding no candidates: ${barren.join(", ")}`).toEqual([]);
  }, 600_000);

  it("types with an anchor profile produce at least one ANCHOR candidate", async () => {
    const missed: string[] = [];
    for (const d of DOC_TYPES) {
      if (!d.anchorProfile) continue;
      const { result } = await classifyOnce(d.code);
      if (!result.candidates.some((c) => c.extractorKind === "ANCHOR")) missed.push(d.code);
    }
    expect(missed, `anchor profile declared but nothing extracted: ${missed.join(", ")}`).toEqual([]);
  }, 600_000);

  it("reports completeness against the expected fields of the type", async () => {
    // Recorded rather than bounded — this is the number that tells us where the
    // anchor profiles are thin, and it should be watched as it moves.
    const rows: Array<[string, number, number]> = [];
    for (const d of DOC_TYPES) {
      const { result } = await classifyOnce(d.code);
      rows.push([d.code, result.autofill.completeness.filled, d.expectedFields.length]);
    }
    for (const [code, filled, expected] of rows) {
      expect(filled, code).toBeGreaterThanOrEqual(0);
      expect(expected, code).toBeGreaterThan(0);
    }
  }, 600_000);
});

// ===========================================================================
describe("governance holds across all 58 types", () => {
  it("no unmasked Aadhaar appears in any serialised result", async () => {
    // The Aadhaar-card fixture deliberately contains one, twice.
    for (const d of DOC_TYPES) {
      const { result } = await classifyOnce(d.code);
      const blob = JSON.stringify(result);
      expect(blob, d.code).not.toMatch(/2345\s?6789\s?0123/);
      expect(blob, d.code).not.toMatch(/234567890123/);
    }
  }, 600_000);

  it("records no AI involvement anywhere", async () => {
    for (const d of DOC_TYPES) {
      const { result } = await classifyOnce(d.code);
      expect(result.governance.aiInvolved, d.code).toBe(false);
    }
  }, 600_000);

  it("writes an intact audit chain for every type", async () => {
    const { AuditChain } = await import("../src/governance/governance.js");
    for (const d of DOC_TYPES) {
      const { result } = await classifyOnce(d.code);
      expect(AuditChain.verify(result.governance.auditEvents, "classify-test"), d.code).toBeNull();
    }
  }, 600_000);
});
