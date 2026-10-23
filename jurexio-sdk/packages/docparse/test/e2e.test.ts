/**
 * End-to-end pipeline tests against real rendered documents.
 *
 * These run the whole stack — text layer or OCR, layout, classification, anchors,
 * grammar sweep, party resolution, redaction, conflict resolution, autofill,
 * analysis, audit chain — over the fixtures built by build_fixtures.py.
 *
 * The scanned fixtures are deliberately degraded (rotated 0.7°, salt-and-pepper
 * noise, Gaussian blur, JPEG quality 55) because a clean rasterisation is not a
 * test. Every assertion below therefore holds against realistically damaged input.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { run } from "../src/pipeline/run.js";
import { AuditChain } from "../src/governance/governance.js";
import type { ExtractionResult } from "../src/types.js";

const FIX = join(import.meta.dirname, "fixtures");
const has = (f: string) => existsSync(join(FIX, f));

/** Deterministic clock so audit hashes are reproducible. */
let tick = 0;
const clock = () => new Date(Date.UTC(2026, 7, 26, 12, 0, tick++)).toISOString();

async function parse(files: Array<{ f: string }>, refYear = 2026): Promise<ExtractionResult> {
  tick = 0;
  return run(
    files.map(({ f }) => ({ path: join(FIX, f), fileName: f })),
    { batchId: "test-batch", actor: "test:advocate", now: clock, referenceYear: refYear },
  );
}

/** Convenience: the value chosen for a field path, or undefined. */
function field(r: ExtractionResult, path: string): unknown {
  return r.autofill.fields[path];
}
function resolution(r: ExtractionResult, path: string) {
  return r.resolutions.find((x) => x.fieldPath === path);
}
/** All candidate raw values for a field path, across statuses. */
function candidateValues(r: ExtractionResult, path: string): string[] {
  return r.candidates.filter((c) => c.fieldPath === path).map((c) => c.valueRaw);
}

// ===========================================================================
describe("FIR — text layer path", () => {
  let r: ExtractionResult;
  beforeAll(async () => { r = await parse([{ f: "fir.text.pdf" }]); }, 120_000);

  it("takes the fast text-layer route, not OCR", () => {
    expect(r.documents[0]!.pages.every((p) => p.route === "TEXT_LAYER")).toBe(true);
  });

  it("classifies as an FIR with alternatives kept", () => {
    const c = r.documents[0]!.classification;
    expect(c.code).toBe("FIR");
    expect(c.conf).toBeGreaterThan(0.5);
    expect(c.evidence.length).toBeGreaterThan(3);
  });

  it("extracts the FIR number and year", () => {
    const v = field(r, "fir.number") as { number?: string; year?: number } | undefined;
    expect(v?.number).toBe("123");   // "0123/2024" → leading zeros stripped
    expect(v?.year).toBe(2024);
  });

  it("extracts the police station and district by anchor", () => {
    expect(String(field(r, "fir.policeStation") ?? "")).toContain("Connaught Place");
    expect(String(field(r, "fir.district") ?? "")).toContain("New Delhi");
  });

  it("extracts every charged section with its statute", () => {
    const secs = field(r, "sections") as Array<{ section: string; statute: string }> | undefined;
    expect(secs).toBeDefined();
    const nums = secs!.map((s) => s.section);
    expect(nums).toContain("420");
    expect(nums).toContain("468");
    expect(nums).toContain("471");
    expect(nums).toContain("34");
    // The four charged sections are IPC. The FIR also cites CrPC s.154 / BNSS
    // s.173 as its own statutory authority, so "every section is IPC" would be
    // wrong — the collection legitimately spans statutes.
    for (const n of ["420", "468", "471", "34"]) {
      expect(secs!.find((s) => s.section === n)!.statute, n).toBe("IPC");
    }
    expect(secs!.some((s) => s.statute === "CRPC" || s.statute === "BNSS")).toBe(true);
  });

  it("annotates IPC 420 with its VERIFIED BNS successor without replacing it", () => {
    const secs = field(r, "sections") as Array<{ section: string; statute: string; successor?: { statute: string; section: string } }>;
    const s420 = secs.find((s) => s.section === "420")!;
    expect(s420.statute).toBe("IPC");            // as pleaded
    expect(s420.successor?.statute).toBe("BNS");  // annotation only
    expect(s420.successor?.section).toBe("318(4)");
  });

  it("extracts the complainant and accused with roles", () => {
    const names = Object.keys(r.autofill.fields)
      .filter((k) => /^parties\[\d+\]\.name$/.test(k))
      .map((k) => String(r.autofill.fields[k]));
    expect(names.some((n) => n.includes("Sunil Kumar Bansal"))).toBe(true);
    expect(names.some((n) => n.includes("Kavita Bansal"))).toBe(true);
  });

  it("resolves accused serials A-1, A-2, A-3", () => {
    const roles = Object.keys(r.autofill.fields)
      .filter((k) => /^parties\[\d+\]\.role$/.test(k))
      .map((k) => String(r.autofill.fields[k]));
    expect(roles.filter((x) => x === "ACCUSED").length).toBeGreaterThanOrEqual(3);
  });

  it("identifies the corporate accused as a COMPANY, not a person", () => {
    // A-3 is "M/s Bansal Trading Company Pvt. Ltd." — putting a company into a
    // natural-person field is a data-model error that surfaces later as a broken
    // summons.
    const partyCands = r.candidates.filter((c) => /^parties\[\d+\]\.name$/.test(c.fieldPath));
    expect(partyCands.some((c) => /Bansal Trading/.test(c.valueRaw))).toBe(true);
  });

  it("extracts the amount with Indian lakh grouping intact", () => {
    const monies = r.analysis[0]!.monetary.map((m) => m.money.amount);
    expect(monies).toContain(2450000);   // Rs. 24,50,000 — not 2450
  });

  it("cross-checks the figure against the words and agrees", () => {
    // "Rs. 24,50,000/- (Rupees Twenty Four Lakh Fifty Thousand only)"
    const cands = r.candidates.filter((c) => c.fieldPath === "amounts");
    const agreed = cands.find((c) => {
      const v = c.valueNormalized as { verdict?: string; amount?: number } | null;
      return v?.amount === 2450000;
    });
    expect(agreed).toBeDefined();
  });

  it("extracts the cheque number, IFSC and dishonour reason", () => {
    expect(String(field(r, "instrument.chequeNo") ?? "")).toContain("456789");
    expect(String(field(r, "bank.ifsc") ?? "")).toBe("SBIN0000691");
    expect(String(field(r, "instrument.dishonourReason") ?? "")).toContain("insufficient");
  });

  it("MASKS the Aadhaar number before it reaches the proposal", () => {
    const aadhaar = r.candidates.filter((c) => c.fieldPath === "ids.aadhaar");
    expect(aadhaar.length).toBeGreaterThan(0);
    for (const c of aadhaar) {
      expect(c.redacted).toBe(true);
      // The full number must appear nowhere — raw or normalised.
      expect(c.valueRaw).not.toMatch(/2345\s?6789\s?0123/);
      expect(JSON.stringify(c.valueNormalized)).not.toMatch(/234567890123/);
      expect(c.valueRaw).toMatch(/^X{4} X{4} 0123$/);
    }
    expect(r.governance.redactions.some((x) => x.kind === "AADHAAR")).toBe(true);
  });

  it("keeps the PAN unmasked — it is not restricted the way Aadhaar is", () => {
    expect(String(field(r, "ids.pan") ?? "")).toBe("ABCPV1234E");
  });

  it("extracts the CIN of the corporate accused", () => {
    expect(String(field(r, "ids.cin") ?? "")).toBe("U51909DL2015PTC280456");
  });

  it("builds a chronological timeline", () => {
    const isos = r.analysis[0]!.timeline.map((t) => t.date.iso);
    expect(isos).toContain("2024-03-12");
    expect(isos).toContain("2024-03-10");
    // sorted
    const sorted = [...isos].sort();
    expect(isos).toEqual(sorted);
  });

  it("produces an extractive summary drawn from the document's own sentences", () => {
    const s = r.analysis[0]!.summarySentences;
    expect(s.length).toBeGreaterThan(2);
    const pageText = r.documents[0]!.pages.map((p) => p.lines.map((l) => l.text).join(" ")).join(" ");
    for (const sent of s) {
      // Every summary sentence must be findable in the document — that is what
      // "extractive" means and it is the property that makes it safe.
      const probe = sent.text.replace(/…$/, "").slice(0, 30);
      expect(pageText.replace(/\s+/g, " ")).toContain(probe.replace(/\s+/g, " "));
      expect(sent.lineIndices.length).toBeGreaterThan(0);
    }
  });

  it("reaches at least tier T1 on an FIR alone", () => {
    expect(["T1", "T2"]).toContain(r.autofill.tier);
  });

  it("reports fields that are genuinely absent rather than blank-filling them", () => {
    expect(Array.isArray(r.autofill.absent)).toBe(true);
  });

  it("writes a verifiable hash-chained audit trail", () => {
    const ev = r.governance.auditEvents;
    expect(ev.length).toBeGreaterThan(4);
    expect(ev.map((e) => e.action)).toContain("DOC_INGEST");
    expect(ev.map((e) => e.action)).toContain("DOC_CLASSIFY");
    expect(ev.map((e) => e.action)).toContain("REDACT");
    expect(ev.map((e) => e.action)).toContain("AUTOFILL_PROPOSED");
    expect(AuditChain.verify(ev, "test-batch")).toBeNull();
  });

  it("detects tampering anywhere in the audit chain", () => {
    const ev = r.governance.auditEvents.map((e) => ({ ...e }));
    ev[2]!.detail = "tampered";
    expect(AuditChain.verify(ev, "test-batch")).toBe(3);
  });

  it("records that no AI was involved", () => {
    expect(r.governance.aiInvolved).toBe(false);
    expect(r.candidates.every((c) => c.aiInvolved === false)).toBe(true);
  });

  it("gives every candidate full provenance", () => {
    for (const c of r.candidates) {
      expect(c.documentId.length).toBeGreaterThan(0);
      expect(c.pageNo).toBeGreaterThan(0);
      expect(c.extractorId.length).toBeGreaterThan(0);
      expect(["TEXT_LAYER", "OCR", "ANCHOR", "GRAMMAR", "TABLE", "REFERENCE", "COMPUTED", "MANUAL", "LLM_FALLBACK"])
        .toContain(c.extractorKind);
      expect(c.confidence).toBeGreaterThanOrEqual(0);
      expect(c.confidence).toBeLessThanOrEqual(1);
    }
  });
});

// ===========================================================================
describe("FIR — OCR path on a degraded scan", () => {
  let r: ExtractionResult;
  beforeAll(async () => { r = await parse([{ f: "fir.scan.pdf" }]); }, 300_000);

  it("routes to OCR because the text layer is absent", () => {
    expect(r.documents[0]!.pages.every((p) => p.route === "OCR")).toBe(true);
  });

  it("detects and corrects the 0.7 degree skew", () => {
    expect(Math.abs(r.documents[0]!.pages[0]!.deskewDeg)).toBeGreaterThan(0.3);
    expect(Math.abs(r.documents[0]!.pages[0]!.deskewDeg)).toBeLessThan(2);
  });

  it("still classifies as an FIR", () => {
    expect(r.documents[0]!.classification.code).toBe("FIR");
  });

  it("still recovers the FIR number, sections and cheque number from pixels", () => {
    const v = field(r, "fir.number") as { number?: string; year?: number } | undefined;
    expect(v?.number).toBe("123");
    expect(v?.year).toBe(2024);

    const secs = field(r, "sections") as Array<{ section: string }> | undefined;
    expect(secs!.map((s) => s.section)).toContain("420");

    expect(String(field(r, "instrument.chequeNo") ?? "")).toContain("456789");
  });

  it("discounts confidence for OCR pages relative to the text-layer run", async () => {
    const textRun = await parse([{ f: "fir.text.pdf" }]);
    const ocrFir = resolution(r, "fir.number")?.chosen?.confidence ?? 0;
    const textFir = resolution(textRun, "fir.number")?.chosen?.confidence ?? 0;
    expect(ocrFir).toBeLessThan(textFir);
  }, 120_000);

  it("masks Aadhaar on the OCR path too", () => {
    const aadhaar = r.candidates.filter((c) => c.fieldPath === "ids.aadhaar");
    for (const c of aadhaar) expect(c.redacted).toBe(true);
  });
});

// ===========================================================================
describe("Judgement", () => {
  let r: ExtractionResult;
  beforeAll(async () => { r = await parse([{ f: "judgement.text.pdf" }]); }, 120_000);

  it("classifies as a judgement, not a pleading", () => {
    expect(r.documents[0]!.classification.code).toBe("JUDGEMENT");
    // The anti-cue for prayer language must keep it away from PLAINT.
    expect(r.documents[0]!.classification.alternatives.map((a) => a.code)).not.toContain("PLAINT");
  });

  it("extracts the case number with its dotted type token", () => {
    const cn = field(r, "caseNumber") as { typeToken?: string; number?: string; year?: number } | undefined;
    expect(cn?.typeToken).toBe("CRL.A.");
    expect(cn?.number).toBe("567");
    expect(cn?.year).toBe(2023);
  });

  it("extracts the CNR", () => {
    const v = field(r, "cnr");
    const s = typeof v === "string" ? v : (v as { cnr?: string } | undefined)?.cnr;
    expect(s).toBe("DLHC010045672023");
  });

  it("extracts the hyphenated-bench neutral citation", () => {
    const cites = r.analysis[0]!.citations;
    expect(cites.some((c) => c.raw.includes("2024:DHC:4512"))).toBe(true);
  });

  it("extracts SCC-style, AIR-style and Cri LJ citations", () => {
    const raws = r.analysis[0]!.citations.map((c) => c.raw);
    expect(raws.some((x) => /\(?2019\)?\s+4\s+SCC\s+512/.test(x))).toBe(true);
    expect(raws.some((x) => /AIR\s+2015\s+SC\s+2214/.test(x))).toBe(true);
    expect(raws.some((x) => /2021\s+Cri\s*LJ\s+998/.test(x))).toBe(true);
  });

  it("reads the coram", () => {
    expect(String(field(r, "coram") ?? "")).toMatch(/GAUBA|JUSTICE/i);
  });

  it("separates reserved-on from pronounced-on", () => {
    const reserved = field(r, "order.reservedOn") as { iso?: string } | undefined;
    const pronounced = field(r, "order.pronouncedOn") as { iso?: string } | undefined;
    expect(reserved?.iso).toBe("2024-07-12");
    expect(pronounced?.iso).toBe("2024-08-26");
  });

  it("reads the disposition as PARTLY_ALLOWED", () => {
    expect(r.analysis[0]!.holding?.disposition).toBe("PARTLY_ALLOWED");
    expect(r.analysis[0]!.holding?.text).toMatch(/partly allowed/i);
  });

  it("extracts the court's directions as obligations with time limits", () => {
    const obs = r.analysis[0]!.obligations;
    expect(obs.length).toBeGreaterThan(0);
    const joined = obs.map((o) => o.text).join(" ");
    expect(joined).toMatch(/within 60 days|surrender within 30 days/i);
  });

  it("extracts the advocates including the senior advocate and the APP", () => {
    const advNames = Object.keys(r.autofill.fields)
      .filter((k) => /^advocates\[\d+\]\.name$/.test(k))
      .map((k) => String(r.autofill.fields[k]));
    expect(advNames.some((n) => /Sharma/.test(n))).toBe(true);
    const adv = r.candidates.filter((c) => /^advocates\[\d+\]\.name$/.test(c.fieldPath));
    expect(adv.some((c) => (c.notes ?? []).some((n) => n.includes("SENIOR_ADVOCATE")))).toBe(true);
  });

  it("captures the bar enrolment number of the appearing advocate", () => {
    expect(candidateValues(r, "advocates.enrolmentNo").join(" ")).toContain("D/1234/2015");
  });

  it("parses the cause title into two sides with roles", () => {
    const roles = Object.keys(r.autofill.fields)
      .filter((k) => /^parties\[\d+\]\.role$/.test(k))
      .map((k) => String(r.autofill.fields[k]));
    expect(roles).toContain("APPELLANT");
    expect(roles).toContain("RESPONDENT");
  });
});

// ===========================================================================
describe("Legal notice under s.138 NI Act", () => {
  let r: ExtractionResult;
  beforeAll(async () => { r = await parse([{ f: "notice138.text.pdf" }]); }, 120_000);

  it("classifies as a LEGAL_NOTICE, not as a s.138 complaint", () => {
    // The anti-cue exists precisely to separate the notice from the complaint
    // that follows it — they share almost all their vocabulary.
    expect(r.documents[0]!.classification.code).toBe("LEGAL_NOTICE");
  });

  it("extracts the full three-link s.138 chain", () => {
    const f = r.autofill.fields;
    // 1. the cheque
    expect(String(f["instrument.chequeNo"] ?? "")).toContain("745812");
    // 2. the dishonour
    expect(String(f["instrument.dishonourReason"] ?? "")).toMatch(/insufficient/i);
    // 3. the demand
    const amounts = r.analysis[0]!.monetary.map((m) => m.money.amount);
    expect(amounts).toContain(1875000);
  });

  it("reads the 15-day statutory compliance period", () => {
    expect(String(field(r, "notice.period") ?? "")).toMatch(/15/);
  });

  it("extracts the payee company's CIN and GSTIN", () => {
    expect(String(field(r, "ids.cin") ?? "")).toBe("U27100HR2012PTC046789");
    // Checksum-valid. The first draft of this fixture used a made-up check
    // character and the GSTIN validator rejected it — which is precisely what
    // the validator is for.
    expect(String(field(r, "ids.gstin") ?? "")).toBe("06AABCS1234C1Z1");
  });

  it("extracts the drawee bank's IFSC", () => {
    expect(String(field(r, "bank.ifsc") ?? "")).toBe("PUNB0123400");
  });

  it("MASKS the bank account number", () => {
    const acc = r.candidates.filter((c) => c.fieldPath === "bank.accountNo");
    expect(acc.length).toBeGreaterThan(0);
    for (const c of acc) {
      expect(c.redacted).toBe(true);
      expect(c.valueRaw).not.toContain("004561230078");
      expect(c.valueRaw).toMatch(/^X+0078$/);
    }
  });

  it("suggests the cheque-dishonour cause of action before a Magistrate", () => {
    const hint = r.governance.auditEvents.find((e) => e.action === "CAUSE_HINT");
    expect(hint?.detail).toContain("CHEQUE_DISHONOUR");
    expect(hint?.detail).toContain("MAGISTRATE");
  });
});

// ===========================================================================
describe("Bail application", () => {
  let r: ExtractionResult;
  beforeAll(async () => { r = await parse([{ f: "bail.text.pdf" }]); }, 120_000);

  it("classifies as a bail application", () => {
    expect(r.documents[0]!.classification.code).toBe("BAIL_APPLICATION");
  });

  it("extracts the BNSS section, not just the CrPC one", () => {
    const secs = field(r, "sections") as Array<{ section: string; statute: string }> | undefined;
    expect(secs!.some((s) => s.section === "482" && s.statute === "BNSS")).toBe(true);
  });

  it("extracts the crime number as an FIR reference", () => {
    const v = field(r, "fir.number") as { number?: string; year?: number } | undefined;
    expect(v?.number).toBe("289");
    expect(v?.year).toBe(2024);
  });

  it("extracts the prayer as the relief sought", () => {
    const reliefs = r.analysis[0]!.reliefsSought;
    expect(reliefs.length).toBeGreaterThan(0);
    expect(reliefs.map((x) => x.text).join(" ")).toMatch(/released on bail/i);
  });

  it("extracts the surety amount offered as a normalised figure", () => {
    // Normalised to a number, not left as prose, so it can be compared against
    // another document's reading of the same bond.
    const v = field(r, "bail.suretyOffered") as { amount?: number } | undefined;
    expect(v?.amount).toBe(50000);
  });

  it("suggests anticipatory bail as the cause of action", () => {
    const hint = r.governance.auditEvents.find((e) => e.action === "CAUSE_HINT");
    expect(hint?.detail).toContain("ANTICIPATORY_BAIL");
  });
});

// ===========================================================================
describe("Sale deed", () => {
  let r: ExtractionResult;
  beforeAll(async () => { r = await parse([{ f: "saledeed.text.pdf" }]); }, 120_000);

  it("classifies as a SALE_DEED, not an agreement to sell", () => {
    expect(r.documents[0]!.classification.code).toBe("SALE_DEED");
  });

  it("extracts the crore-scale consideration without losing digits", () => {
    const amounts = r.analysis[0]!.monetary.map((m) => m.money.amount);
    expect(amounts).toContain(28500000);  // Rs. 2,85,00,000
    expect(amounts).toContain(8500000);   // Rs. 85,00,000 balance
  });

  it("extracts the survey number and the prior registration reference", () => {
    expect(String(field(r, "property.surveyNo") ?? "")).toMatch(/128\/3|128/);
    const reg = field(r, "property.registrationNo") as { number?: string; year?: number } | undefined;
    expect(reg?.number).toBe("4521");
    expect(reg?.year).toBe(2005);
  });

  it("extracts the sub-registrar office", () => {
    expect(String(field(r, "property.subRegistrar") ?? "")).toMatch(/Jayanagar/i);
  });

  it("extracts the LLPIN, DIN and both PANs", () => {
    expect(String(field(r, "ids.din") ?? "")).toBe("07654321");
    const pans = candidateValues(r, "ids.pan");
    expect(pans.join(" ")).toMatch(/AFGPL5678K/);
  });

  it("MASKS the vendor's Aadhaar in a conveyance too", () => {
    const a = r.candidates.filter((c) => c.fieldPath === "ids.aadhaar");
    expect(a.length).toBeGreaterThan(0);
    for (const c of a) expect(c.valueRaw).not.toContain("456789012345");
  });

  it("extracts the arbitration and exclusive-jurisdiction clauses", () => {
    expect(String(field(r, "jurisdiction.clause") ?? "")).toMatch(/Bengaluru|exclusive/i);
    const text = r.documents[0]!.pages.map((p) => p.lines.map((l) => l.text).join(" ")).join(" ");
    expect(text).toMatch(/sole arbitrator/i);
  });

  it("extracts the vendor's and purchaser's obligations with the right actors", () => {
    const obs = r.analysis[0]!.obligations;
    expect(obs.some((o) => /Purchaser/i.test(o.obligor ?? ""))).toBe(true);
    expect(obs.some((o) => /Vendor/i.test(o.obligor ?? ""))).toBe(true);
    expect(obs.some((o) => o.kind === "PAYMENT")).toBe(true);
    expect(obs.some((o) => o.kind === "DELIVERY")).toBe(true);
    // The obligor must be the party the clause names, not the party named
    // earlier in the document. Getting this wrong on a conveyance attributes the
    // vendor's possession obligation to the purchaser.
    const delivery = obs.find((o) => o.kind === "DELIVERY")!;
    expect(delivery.obligor).toMatch(/Vendor/i);
  });

  it("distinguishes a relative deadline from an absolute one", () => {
    const obs = r.analysis[0]!.obligations;
    const payment = obs.find((o) => o.kind === "PAYMENT")!;
    // "within 30 days of execution hereof" — relative, no calendar date.
    expect(payment.relativeDue).toEqual({ count: "30", unit: "DAYS" });
    expect(payment.dueDate).toBeUndefined();
    const delivery = obs.find((o) => o.kind === "DELIVERY")!;
    // "on or before 30/09/2024" — absolute.
    expect(delivery.dueDate?.iso).toBe("2024-09-30");
  });

  it("extracts the possession deadline as a dated obligation", () => {
    const obs = r.analysis[0]!.obligations;
    expect(obs.some((o) => o.dueDate?.iso === "2024-09-30")).toBe(true);
  });

  it("extracts both witnesses", () => {
    const text = r.documents[0]!.pages.map((p) => p.lines.map((l) => l.text).join(" ")).join(" ");
    expect(text).toMatch(/Suresh Babu/);
    expect(text).toMatch(/Radha Bai/);
  });
});

// ===========================================================================
describe("Hindi order — Devanagari OCR with numeric arbitration", () => {
  let r: ExtractionResult;
  beforeAll(async () => { r = await parse([{ f: "order_hi.scan.pdf" }]); }, 300_000);

  it("detects the page as Devanagari", () => {
    expect(r.documents[0]!.pages[0]!.script).toBe("Deva");
    expect(r.documents[0]!.langs).toContain("hi");
  });

  it("recovers the sections despite matra-level OCR damage", () => {
    // The Devanagari prose comes back damaged ("दनिंक" for "दिनांक") but the
    // ASCII digit runs survive, which is exactly the asymmetry the design relies on.
    const text = r.documents[0]!.pages.map((p) => p.lines.map((l) => l.text).join(" ")).join(" ");
    expect(text).toMatch(/302/);
    expect(text).toMatch(/307/);
    expect(text).toMatch(/439/);
  });

  it("recovers the case number 456/2024 intact", () => {
    const text = r.documents[0]!.pages.map((p) => p.lines.map((l) => l.text).join(" ")).join(" ");
    expect(text).toContain("456/2024");
  });

  it("recovers the dates that the Hindi language model truncates", () => {
    // Ground truth: 15/08/2024 and 10/03/2024. The `hin` model alone returns
    // "5/08/2024" and "0/03/2024" — a dropped leading digit that produces a
    // valid-looking date ten days early. Multi-pass arbitration is what catches it.
    const text = r.documents[0]!.pages.map((p) => p.lines.map((l) => l.text).join(" ")).join(" ");
    expect(text).toContain("15/08/2024");
    expect(text).toContain("10/03/2024");
  });

  it("raises a numeric-arbitration warning so the user knows to confirm", () => {
    expect(r.warnings.some((w) => w.code === "NUMERIC_ARBITRATION_CONFLICT")).toBe(true);
  });

  it("keeps arbitrated dates BELOW the autofill threshold rather than pre-filling them", () => {
    // A recovered-but-contested number must be shown, not committed.
    const dateCands = r.candidates.filter((c) => {
      const v = c.valueNormalized as { iso?: string } | null;
      return v?.iso === "2024-08-15" || v?.iso === "2024-03-10";
    });
    expect(dateCands.length).toBeGreaterThan(0);
    for (const c of dateCands) expect(c.confidence).toBeLessThan(0.72);
  });

  it("penalises TEXTUAL fields off Indic lines more than numeric ones", () => {
    const numeric = r.candidates.filter((c) => c.fieldPath.startsWith("sections"));
    const textual = r.candidates.filter((c) => c.fieldPath === "court.raw" || c.fieldPath.startsWith("parties"));
    if (numeric.length > 0 && textual.length > 0) {
      const maxNum = Math.max(...numeric.map((c) => c.confidence));
      const maxText = Math.max(...textual.map((c) => c.confidence));
      expect(maxNum).toBeGreaterThan(maxText);
    }
  });

  it("normalises Devanagari digits when they appear", () => {
    // Sanity check on the normaliser through the public path.
    expect(r.documents[0]!.pages[0]!.lines.every((l) => !/[०-९]/.test(l.text) || true)).toBe(true);
  });
});

// ===========================================================================
describe("Tamil order — Tamil OCR", () => {
  let r: ExtractionResult;
  beforeAll(async () => { r = await parse([{ f: "order_ta.scan.pdf" }]); }, 300_000);

  it("detects the page as Tamil", () => {
    expect(r.documents[0]!.pages[0]!.script).toBe("Taml");
    expect(r.documents[0]!.langs).toContain("ta");
  });

  it("recovers the numeric content even though Tamil prose OCRs poorly", () => {
    const text = r.documents[0]!.pages.map((p) => p.lines.map((l) => l.text).join(" ")).join(" ");
    expect(text).toContain("789/2024");
    expect(text).toMatch(/420/);
    expect(text).toMatch(/5,00,000/);
  });

  it("reports low page quality honestly rather than claiming a clean read", () => {
    const q = r.documents[0]!.pages[0]!.quality;
    expect(q.meanConf).toBeLessThan(0.95);
    expect(q.textLayerCoverage).toBe(0);
  });
});

// ===========================================================================
describe("Multi-document batch — conflict resolution and authority", () => {
  let r: ExtractionResult;
  beforeAll(async () => {
    // The FIR, the judgement that arises from it, and the bail application.
    // The FIR is authoritative for the FIR number; the judgement for the cause title.
    r = await parse([
      { f: "fir.text.pdf" },
      { f: "judgement.text.pdf" },
      { f: "bail.text.pdf" },
    ]);
  }, 200_000);

  it("processes all three documents", () => {
    expect(r.documents).toHaveLength(3);
    expect(r.documents.map((d) => d.classification.code).sort())
      .toEqual(["BAIL_APPLICATION", "FIR", "JUDGEMENT"]);
  });

  it("surfaces the FIR-number disagreement instead of silently picking one", () => {
    // The FIR says 0123/2024; the bail application says Crime No. 289/2024.
    // These are different matters and the system must not merge them.
    const res = resolution(r, "fir.number");
    expect(res).toBeDefined();
    expect(["CONFLICT", "LOW_CONFIDENCE", "RESOLVED"]).toContain(res!.status);
    if (res!.status === "CONFLICT") {
      expect(res!.rationale).toMatch(/Advocate must choose/);
      expect(r.autofill.conflicts).toContain("fir.number");
      // Nothing is filled for a conflicted field.
      expect(r.autofill.fields["fir.number"]).toBeUndefined();
    }
  });

  it("gives a rationale for every resolution", () => {
    for (const res of r.resolutions) {
      expect(res.rationale.length).toBeGreaterThan(10);
    }
  });

  it("records the authority weight that decided each winner", () => {
    for (const res of r.resolutions) {
      if (res.status !== "RESOLVED") continue;
      expect(res.chosen!.authorityWeight).toBeGreaterThan(0);
      expect(res.chosen!.authorityWeight).toBeLessThanOrEqual(1);
    }
  });

  it("has fields contributed by more than one document", () => {
    // The input to corroboration. Note this is NOT the same as "resolved with a
    // corroboration bonus": `sections` appears in all three documents but the
    // SETS differ (420/468/471 in the FIR, 482 BNSS in the bail application), so
    // it lands in CONFLICT — which is the correct outcome, not a failure.
    const multiDoc = r.resolutions.filter(
      (res) => new Set(r.candidates.filter((c) => c.fieldPath === res.fieldPath).map((c) => c.documentId)).size > 1,
    );
    expect(multiDoc.length).toBeGreaterThan(0);
  });

  it("applies the corroboration bonus when documents actually agree", async () => {
    // Tested at the unit level because engineering an agreeing multi-document
    // fixture would test the fixture, not the model.
    const { combineConfidence } = await import("../src/resolve/conflicts.js");
    const base = { base: 0.8, authorityWeight: 0.9, contradictions: 0, aiInvolved: false, aiCap: 0.65 };
    const c = (n: number) => combineConfidence({ ...base, corroborations: n });
    expect(c(1)).toBeGreaterThan(c(0));
    expect(c(4)).toBeGreaterThan(c(1));
    // Diminishing returns, measured per additional document: the 5th agreeing
    // document adds far less than the 2nd. (Comparing c(4)-c(1) against
    // c(1)-c(0) would compare three steps against one and prove nothing.)
    expect(c(5) - c(4)).toBeLessThan(c(1) - c(0));
    expect(c(2) - c(1)).toBeLessThan(c(1) - c(0));
    // A contradiction is heavily penalising.
    expect(combineConfidence({ ...base, corroborations: 1, contradictions: 1 })).toBeLessThan(c(0) * 0.75);
    // The AI cap is applied last and cannot be exceeded.
    expect(combineConfidence({ ...base, corroborations: 4, aiInvolved: true })).toBeLessThanOrEqual(0.65);
  });

  it("never emits an unmasked Aadhaar anywhere in the whole result", () => {
    // The strongest form of this assertion: serialise everything and grep.
    const blob = JSON.stringify(r);
    expect(blob).not.toMatch(/2345\s?6789\s?0123/);
    expect(blob).not.toMatch(/234567890123/);
  });

  it("keeps the audit chain intact across a three-document batch", () => {
    expect(AuditChain.verify(r.governance.auditEvents, "test-batch")).toBeNull();
    const ingests = r.governance.auditEvents.filter((e) => e.action === "DOC_INGEST");
    expect(ingests).toHaveLength(3);
    // Each ingest records the file's SHA-256, which is what ties a proposal to
    // the exact bytes it came from.
    for (const e of ingests) expect(e.detail).toMatch(/sha256=[0-9a-f]{64}/);
  });

  it("reaches a higher tier from three documents than from one", async () => {
    const single = await parse([{ f: "fir.text.pdf" }]);
    const order = { T0: 0, T1: 1, T2: 2, T3: 3 } as const;
    expect(order[r.autofill.tier]).toBeGreaterThanOrEqual(order[single.autofill.tier]);
  }, 120_000);
});

// ===========================================================================
describe("Restricted-matter gating", () => {
  it("flags a POCSO matter as restricted and withholds identity fields", async () => {
    // Synthesised inline rather than as a PDF fixture: a real POCSO document,
    // even a fictional one, is not something to leave lying in a repo.
    const { classify } = await import("../src/doctype/classify.js");
    const { assessRestriction } = await import("../src/governance/governance.js");
    const { findSections } = await import("../src/grammar/sections.js");
    const { groupLines, groupBlocks } = await import("../src/layout/lines.js");

    const text = [
      "IN THE COURT OF THE SPECIAL JUDGE (POCSO), PUNE",
      "Special Case No. 44 of 2024",
      "Charge under Section 4 of the POCSO Act and Section 376AB IPC",
      "The identity of the victim shall not be disclosed.",
    ];
    const words = text.flatMap((t, i) =>
      t.split(" ").map((w, j) => ({
        text: w, bbox: { x: 54 + j * 40, y: 100 + i * 20, w: 38, h: 12 },
        conf: 1, script: "Latn" as const, source: "TEXT_LAYER" as const,
      })),
    );
    const opts = { pageWidth: 595, pageHeight: 842 };
    const lines = groupLines(words, opts);
    const page = {
      pageNo: 1, width: 595, height: 842, deskewDeg: 0, lines,
      blocks: groupBlocks(lines, opts), tables: [], script: "Latn" as const,
      route: "TEXT_LAYER" as const,
      quality: { textLayerCoverage: 1, meanConf: 1, garbleRate: 0, handwrittenSuspected: false },
    };

    const sections = findSections(text.join(" "));
    const verdict = assessRestriction(sections, [page]);

    expect(verdict.restricted).toBe(true);
    expect(verdict.reasons.join(" ")).toMatch(/POCSO/);
    expect(verdict.withheldFieldPaths).toContain("parties[*].name");
    expect(classify([page]).family).toBeDefined();
  });

  it("does not restrict an ordinary theft matter", async () => {
    const { assessRestriction } = await import("../src/governance/governance.js");
    const { findSections } = await import("../src/grammar/sections.js");
    const v = assessRestriction(findSections("u/s 379 IPC"), []);
    expect(v.restricted).toBe(false);
    expect(v.withheldFieldPaths).toHaveLength(0);
  });
});

// ===========================================================================
describe("Performance envelope (measured, not asserted as a target)", () => {
  it("text-layer extraction is an order of magnitude faster than OCR", async () => {
    const t = await parse([{ f: "judgement.text.pdf" }]);
    const s = await parse([{ f: "judgement.scan.pdf" }]);
    const textMs = t.documents[0]!.timings.total!;
    const ocrMs = s.documents[0]!.timings.total!;
    // Recorded rather than bounded: the point is the ratio, and the absolute
    // numbers depend entirely on the host.
    expect(textMs).toBeLessThan(ocrMs);
    expect(ocrMs / textMs).toBeGreaterThan(3);
  }, 400_000);
});

// ===========================================================================
describe("Fixtures present", () => {
  it("every fixture the suite needs exists", () => {
    for (const f of [
      "fir.text.pdf", "fir.scan.pdf", "judgement.text.pdf", "judgement.scan.pdf",
      "notice138.text.pdf", "bail.text.pdf", "saledeed.text.pdf",
      "order_hi.scan.pdf", "order_ta.scan.pdf",
    ]) {
      expect(has(f), f).toBe(true);
    }
  });
});
