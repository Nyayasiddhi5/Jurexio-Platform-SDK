import { describe, it, expect } from "vitest";
import { normalizeCnr, validateCnr } from "../lib/cnrNormalize";

describe("normalizeCnr / validateCnr", () => {
  it("normalizes spaces hyphens and case", () => {
    expect(normalizeCnr(" mhcc-01012345-2024 ")).toBe("MHCC010123452024");
  });

  it("accepts classic 16-char CNR as ok", () => {
    expect(validateCnr("MHCC010123452024")).toEqual({ validation: "ok" });
  });

  it("soft-accepts other alphanumeric lengths 10–20", () => {
    expect(validateCnr("ABCDE12345").validation).toBe("soft");
  });

  it("rejects short / empty / non-alnum", () => {
    expect(validateCnr("").validation).toBe("invalid");
    expect(validateCnr("SHORT").validation).toBe("invalid");
    expect(validateCnr("BAD*CNR!!!!").validation).toBe("invalid");
  });
});
