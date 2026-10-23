import { describe, it, expect } from "vitest";
import {
  normalizeDiary,
  validateDiary,
  parseCourtTypeHint,
  normalizeDiaryRaw,
} from "../lib/diaryNormalize";

describe("diaryNormalize", () => {
  it("parses canonical slash form", () => {
    const n = normalizeDiary("12345/2024");
    expect(n).toEqual({
      canonical: "12345/2024",
      number: "12345",
      year: 2024,
      variants: expect.arrayContaining(["12345/2024"]),
    });
  });

  it("parses Diary No prefix", () => {
    const n = normalizeDiary("Diary No. 9876/2023");
    expect(n?.canonical).toBe("9876/2023");
    expect(n?.year).toBe(2023);
  });

  it("parses hyphen separator", () => {
    expect(normalizeDiary("4567-2022")?.canonical).toBe("4567/2022");
  });

  it("parses 'of' separator", () => {
    expect(normalizeDiary("7890 of 2021")?.canonical).toBe("7890/2021");
  });

  it("expands two-digit year", () => {
    expect(normalizeDiary("100/24")?.year).toBe(2024);
    expect(normalizeDiary("100/99")?.year).toBe(1999);
  });

  it("rejects garbage", () => {
    expect(normalizeDiary("not-a-diary")).toBeNull();
    expect(validateDiary("").validation).toBe("invalid");
    expect(validateDiary("abc/def").validation).toBe("invalid");
  });

  it("strips decorative prefix via normalizeDiaryRaw", () => {
    expect(normalizeDiaryRaw("  Diary No: 12/2020  ")).toBe("12/2020");
  });

  it("parseCourtTypeHint", () => {
    expect(parseCourtTypeHint("sc")).toBe("sc");
    expect(parseCourtTypeHint("Supreme Court")).toBe("sc");
    expect(parseCourtTypeHint("hc")).toBe("hc");
    expect(parseCourtTypeHint("district")).toBe("dc");
    expect(parseCourtTypeHint("")).toBeNull();
  });
});
