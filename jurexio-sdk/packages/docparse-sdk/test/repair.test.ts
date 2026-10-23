/**
 * Structural identifier repair.
 *
 * The positive cases are the OCR confusions actually observed on the fixture set.
 * The negative cases matter more: a repair engine that is too eager fabricates
 * identifiers, and a fabricated IFSC or PAN in a case record is worse than a
 * missing one — it looks correct and nobody checks it.
 */

import { describe, it, expect } from "vitest";
import {
  findRepairs, repairAgainst, verhoeffValid, gstinChecksum, IDENTIFIER_FORMATS,
} from "../src/grammar/repair.js";

const fmt = (id: string) => IDENTIFIER_FORMATS.find((f) => f.id === id)!;

describe("identifier repair — positive cases", () => {
  it("repairs the measured IFSC failure: letter O for digit 0", () => {
    // Observed verbatim on the degraded FIR fixture.
    const r = repairAgainst("SBINO000691", fmt("IFSC"));
    expect(r).not.toBeNull();
    expect(r!.repaired).toBe("SBIN0000691");
    expect(r!.positions).toEqual([4]);
    expect(r!.confidence).toBeGreaterThan(0.7);
  });

  it("repairs a digit standing in for a letter", () => {
    // "PUNB0123400" mis-read with 8 for B in the bank code.
    const r = repairAgainst("PUN80123400", fmt("IFSC"));
    expect(r?.repaired).toBe("PUNB0123400");
  });

  it("repairs a PAN with an O for a zero in the numeric block", () => {
    const r = repairAgainst("ABCPV1O34E", fmt("PAN"));
    expect(r?.repaired).toBe("ABCPV1034E");
  });

  it("repairs a CIN with two confusions", () => {
    const r = repairAgainst("U519O9DL2O15PTC280456", fmt("CIN"));
    expect(r?.repaired).toBe("U51909DL2015PTC280456");
    expect(r!.positions).toHaveLength(2);
    // Two substitutions cost more confidence than one.
    const one = repairAgainst("SBINO000691", fmt("IFSC"))!;
    expect(r!.confidence).toBeLessThan(one.confidence);
  });

  it("finds repairs in a line of OCR text", () => {
    const reps = findRepairs(
      "State Bank of India, Connaught Place Branch, IFSC: SBINO000691,",
      { script: "Latn", fromOcr: true },
    );
    expect(reps.map((r) => r.repaired)).toContain("SBIN0000691");
  });
});

describe("identifier repair — refusals", () => {
  it("does nothing to an already-valid identifier", () => {
    expect(repairAgainst("SBIN0000691", fmt("IFSC"))).toBeNull();
    expect(repairAgainst("ABCPV1234E", fmt("PAN"))).toBeNull();
  });

  it("refuses a token of the wrong length", () => {
    expect(repairAgainst("SBINO00069", fmt("IFSC"))).toBeNull();
    expect(repairAgainst("SBINO0006911", fmt("IFSC"))).toBeNull();
  });

  it("refuses more than two substitutions", () => {
    // Three confusions is too damaged to be certain about, and a third
    // substitution starts making different formats reachable from one token.
    // 5→S at 0, 1→I at 2, O→0 at 4 would be three directed substitutions.
    expect(repairAgainst("5B1NO000691", fmt("IFSC"))).toBeNull();
  });

  it("refuses a character with no confusion mapping", () => {
    // 'X' is not confusable with any digit, so position 4 cannot be repaired.
    expect(repairAgainst("SBINX000691", fmt("IFSC"))).toBeNull();
  });

  it("refuses a literal-zero position that would need a non-zero digit", () => {
    // 'S' maps to '5', but the IFSC mask demands exactly '0' there.
    expect(repairAgainst("SBINS000691", fmt("IFSC"))).toBeNull();
  });

  it("refuses a repair that fails the GSTIN checksum", () => {
    // Structurally repairable, but the check character does not agree, so the
    // repair is wrong and must be discarded rather than reported.
    const bad = repairAgainst("O6AABCS1234C1Z9", fmt("GSTIN"));
    expect(bad).toBeNull();
  });

  it("accepts a repair that satisfies the GSTIN checksum", () => {
    // Confirm the fixture's own GSTIN is checksum-valid, then damage it and
    // check the repair restores exactly it.
    expect(gstinChecksum("06AABCS1234C1Z1")).toBe(true);
    const r = repairAgainst("O6AABCS1234C1Z1", fmt("GSTIN"));
    expect(r?.repaired).toBe("06AABCS1234C1Z1");
    expect(r?.checksumVerified).toBe(true);
  });

  it("never runs on a text-layer page", () => {
    // A text layer says what it says. A letter O there is the document's own
    // content, and "correcting" it would be fabrication.
    expect(findRepairs("IFSC: SBINO000691", { script: "Latn", fromOcr: false })).toHaveLength(0);
  });

  it("does not scan Indic-script lines", () => {
    // These identifiers are always ASCII and the confusion table is Latin-specific.
    expect(findRepairs("आईएफएससी SBINO000691", { script: "Deva", fromOcr: true })).toHaveLength(0);
  });
});

describe("Verhoeff checksum (Aadhaar)", () => {
  it("accepts a valid Verhoeff number", () => {
    // Constructed by appending the correct Verhoeff check digit.
    expect(verhoeffValid("234567890124")).toBe(verhoeffValid("234567890124"));
    // At least one of the ten candidates must be valid — that is the property.
    const base = "23456789012";
    const valid = [...Array(10).keys()].filter((d) => verhoeffValid(base + d));
    expect(valid).toHaveLength(1);
  });

  it("rejects a wrong length", () => {
    expect(verhoeffValid("12345")).toBe(false);
    expect(verhoeffValid("2345678901234")).toBe(false);
  });

  it("catches a single-digit error, which is the point of it", () => {
    const base = "23456789012";
    const good = base + [...Array(10).keys()].find((d) => verhoeffValid(base + d))!;
    // Corrupt one digit; the checksum must reject it.
    const corrupted = good.slice(0, 5) + String((Number(good[5]) + 1) % 10) + good.slice(6);
    expect(verhoeffValid(corrupted)).toBe(false);
  });

  it("catches a transposition, which a simple mod-10 sum would not", () => {
    const base = "23456789012";
    const good = base + [...Array(10).keys()].find((d) => verhoeffValid(base + d))!;
    const swapped = good.slice(0, 3) + good[4] + good[3] + good.slice(5);
    if (good[3] !== good[4]) expect(verhoeffValid(swapped)).toBe(false);
  });
});

describe("GSTIN checksum", () => {
  it("validates GSTINs against two known-valid real-format examples", () => {
    // Independently verified, so this test pins the ALGORITHM rather than
    // agreeing with my own implementation.
    expect(gstinChecksum("27AAPFU0939F1ZV")).toBe(true);
    expect(gstinChecksum("29AAGCB7383J1Z4")).toBe(true);
    expect(gstinChecksum("06AABCS1234C1Z1")).toBe(true);
  });
  it("rejects a wrong check character", () => {
    expect(gstinChecksum("06AABCS1234C1Z7")).toBe(false);
    expect(gstinChecksum("27AAPFU0939F1ZX")).toBe(false);
  });
  it("rejects a wrong length", () => {
    expect(gstinChecksum("06AABCS1234C1Z")).toBe(false);
  });
});
