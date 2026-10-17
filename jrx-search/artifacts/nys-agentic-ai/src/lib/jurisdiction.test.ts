import { describe, expect, it, beforeEach } from "vitest";
import {
  isAll,
  isLive,
  isReserved,
  jurisdictionQueryParam,
  matchesJurisdictionSelection,
  concreteJurisdiction,
  JURISDICTIONS,
} from "./jurisdiction";

describe("jurisdiction selection helpers", () => {
  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  it("exposes ALL as the first picker option and marks it live", () => {
    expect(JURISDICTIONS[0]?.code).toBe("ALL");
    expect(isAll("ALL")).toBe(true);
    expect(isLive("ALL")).toBe(true);
    expect(isReserved("ALL")).toBe(false);
  });

  it("treats GCC/UK/EU/SG as reserved", () => {
    expect(isReserved("GCC")).toBe(true);
    expect(isLive("GCC")).toBe(false);
  });

  it("maps ALL query param correctly", () => {
    expect(jurisdictionQueryParam("ALL")).toBe("ALL");
    expect(jurisdictionQueryParam("IN")).toBe("IN");
  });

  it("concreteJurisdiction picks a live code when ALL", () => {
    expect(concreteJurisdiction("ALL")).toBe("IN");
    expect(concreteJurisdiction("ALL", "US")).toBe("US");
    expect(concreteJurisdiction("US")).toBe("US");
  });

  it("matchesJurisdictionSelection unions live + GLOBAL for ALL", () => {
    expect(matchesJurisdictionSelection("ALL", { jurisdiction: "IN" })).toBe(true);
    expect(matchesJurisdictionSelection("ALL", { jurisdiction: "US" })).toBe(true);
    expect(matchesJurisdictionSelection("ALL", { jurisdiction: "GLOBAL" })).toBe(true);
    expect(matchesJurisdictionSelection("IN", { jurisdiction: "GLOBAL" })).toBe(true);
    expect(matchesJurisdictionSelection("IN", { jurisdiction: "US" })).toBe(false);
  });
});
